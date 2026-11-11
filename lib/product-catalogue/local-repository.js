// Single-process private development adapter. Production uses transactional PostgreSQL.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { leaseOptions, jobDue, claimCatalogueJob, ownsLease, expiredCatalogueDraft, finishCatalogueJob } from './job-policy.js';

const queues = new Map();
export function createLocalCatalogueRepository({ path }) {
  const target = resolve(path);
  const publicRoot = fileURLToPath(new URL('../../public/', import.meta.url));
  if (target.toLowerCase().startsWith(publicRoot.toLowerCase().replace(/[\\/]$/, '') + sep)) throw new TypeError('Catalogue storage must be private.');
  const key = process.platform === 'win32' ? target.toLowerCase() : target;
  const exclusive = fn => {
    const result = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const pending = result.catch(() => {}); queues.set(key, pending);
    pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
    return result;
  };
  async function read() {
    try { const data = JSON.parse(await readFile(target, 'utf8')); if (data.version !== 1) throw new Error('Unsupported catalogue storage.'); return data; }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, records: [], commands: [], jobs: [] }; throw error; }
  }
  async function write(data) {
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  }
  return {
    get: id => exclusive(async () => structuredClone((await read()).records.find(r => r.draft.id === id) ?? null)),
    list: () => exclusive(async () => structuredClone((await read()).records)),
    jobs: () => exclusive(async () => structuredClone((await read()).jobs)),
    claimJob: input => exclusive(async () => {
      leaseOptions(input);
      const data = await read(); let changed = false;
      for (let index = 0; index < data.jobs.length; index++) {
        const job = data.jobs[index];
        if (!(input.kinds ?? ['render']).includes(job.kind ?? 'render')) continue;
        if (job.kind === 'publish' && data.jobs.some(other => other.id !== job.id && other.kind === 'publish'
          && (other.status === 'running' && Date.parse(other.leaseUntil) > Date.parse(input.now)
            || other.status === 'queued' && other.awaitingRelease))) continue;
        if (!jobDue(job, input.now)) continue;
        const claimed = claimCatalogueJob(job, { ...input, token: randomUUID() });
        data.jobs[index] = claimed; changed = true;
        if (claimed.status === 'failed') {
          const record = data.records.find(r => r.draft.id === job.productId);
          const draft = expiredCatalogueDraft(job, record?.draft, input.now);
          if (draft) record.draft = draft;
          continue;
        }
        await write(data); return structuredClone(claimed);
      }
      if (changed) await write(data);
      return null;
    }),
    renewJob: input => exclusive(async () => {
      const data = await read(); const job = data.jobs.find(j => j.id === input.id);
      if (!ownsLease(job, input.leaseToken, input.now)) return false;
      leaseOptions({ workerId: job.workerId, now: input.now, leaseMs: input.leaseMs });
      job.leaseUntil = new Date(Date.parse(input.now) + input.leaseMs).toISOString(); job.updatedAt = input.now;
      await write(data); return true;
    }),
    finishJob: input => exclusive(async () => {
      const data = await read(); const index = data.jobs.findIndex(j => j.id === input.id);
      const job = data.jobs[index]; const record = data.records.find(r => r.draft.id === job?.productId);
      const changed = finishCatalogueJob(job, record?.draft, input);
      data.jobs[index] = changed.job;
      if (changed.draft) record.draft = changed.draft;
      await write(data); return structuredClone(changed.job);
    }),
    command: input => exclusive(async () => {
      const data = await read();
      const prior = data.commands.find(c => c.id === input.id && c.commandId === input.commandId);
      if (prior) {
        if (prior.fingerprint !== input.fingerprint) throw new HttpError(409, 'This command key was already used for another catalogue change.');
        return structuredClone(prior.result);
      }
      const index = data.records.findIndex(r => r.draft.id === input.id);
      const record = data.records[index] ?? null;
      if ((record?.draft.revision ?? 0) !== input.revision) throw new HttpError(409, 'This product changed. Reload before saving.', { currentRevision: record?.draft.revision ?? 0 });
      const change = await input.apply(structuredClone(record));
      const saved = { draft: structuredClone(change.draft), sourceWorkId: change.sourceWorkId ?? record?.sourceWorkId ?? null };
      if (index === -1) data.records.push(saved); else data.records[index] = saved;
      if (change.job) data.jobs.push(structuredClone(change.job));
      data.commands.push({ id: input.id, commandId: input.commandId, fingerprint: input.fingerprint, result: structuredClone(change.draft) });
      await write(data);
      return structuredClone(change.draft);
    }),
  };
}
