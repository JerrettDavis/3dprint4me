import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';

const queues = new Map();
const outcomes = new Set(['draft', 'linked', 'needs_review', 'needs_reconciliation']);
// Single-process loopback development adapter. Production uses atomic Postgres claims.
export function createLocalInvoiceRepository({ path, getWork }) {
  if (!path || typeof getWork !== 'function') throw new TypeError('Local billing requires a private path and work lookup.');
  const target = resolve(path), key = process.platform === 'win32' ? target.toLowerCase() : target;
  const exclusive = operation => {
    const result = (queues.get(key) ?? Promise.resolve()).then(operation, operation);
    const pending = result.catch(() => {}); queues.set(key, pending);
    pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
    return result;
  };
  async function read() {
    try { const data = JSON.parse(await readFile(target, 'utf8')); if (data.version !== 1 || !Array.isArray(data.records)) throw new Error('Unsupported private billing storage.'); return data; }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, records: [] }; throw error; }
  }
  async function write(data) {
    await mkdir(dirname(target), { recursive: true }); const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, target);
  }
  return {
    get: workId => exclusive(async () => structuredClone((await read()).records.find(r => r.workId === workId) ?? null)),
    reserve: input => exclusive(async () => {
      const data = await read(), existing = data.records.find(r => r.workId === input.workId);
      if (existing) {
        if (existing.payloadHash !== input.payloadHash) throw new HttpError(409, 'This job already has a different confirmed billing operation. Review it in Invoice Ninja.');
        return { created: false, record: structuredClone(existing) };
      }
      if (data.records.some(r => r.operationId === input.operationId) || (await getWork(input.workId)).item.revision !== input.revision) throw new HttpError(409, 'Work changed or another billing operation already exists. Reload and review.');
      const now = new Date().toISOString();
      const record = { ...structuredClone(input), state: 'prepared', provider: null, errorCode: null, createdAt: now, updatedAt: now };
      data.records.push(record); await write(data); return { created: true, record: structuredClone(record) };
    }),
    begin: operationId => exclusive(async () => {
      const data = await read(), record = data.records.find(r => r.operationId === operationId);
      if (!record || record.state !== 'prepared') return false;
      record.state = 'creating'; record.updatedAt = new Date().toISOString(); await write(data); return true;
    }),
    finish: (operationId, { state, provider, errorCode }) => exclusive(async () => {
      if (!outcomes.has(state)) throw new TypeError('Unsupported billing outcome.');
      const data = await read(), record = data.records.find(r => r.operationId === operationId);
      if (!record || record.state === 'prepared') throw new HttpError(409, 'Billing operation is not ready for this outcome.');
      Object.assign(record, { state, provider: structuredClone(provider), errorCode: errorCode ?? null, updatedAt: new Date().toISOString() });
      await write(data); return structuredClone(record);
    })
  };
}
