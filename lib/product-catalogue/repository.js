import { HttpError } from '../http.js';
import { randomUUID } from 'node:crypto';
import { leaseOptions, claimCatalogueJob, ownsLease, expiredCatalogueDraft, finishCatalogueJob } from './job-policy.js';

// The production adapter deliberately requires native PostgreSQL transactions.
// No network/geometry/provider operations belong in these atomic command callbacks.
export function createPostgresCatalogueRepository({ database }) {
  if (typeof database?.withTransaction !== 'function') throw new TypeError('Catalogue persistence requires native PostgreSQL transactions.');
  const normalize = row => row ? { draft: row.draft, sourceWorkId: row.source_work_item_id } : null;
  const saveDraft = (tx, draft) => tx.query`UPDATE product_catalogue_drafts SET revision = ${draft.revision}, draft = ${JSON.stringify(draft)}::jsonb, updated_at = now() WHERE id = ${draft.id}`;
  const saveJob = (tx, job) => tx.query`UPDATE product_catalogue_jobs SET status = ${job.status}, payload = ${JSON.stringify(job)}::jsonb,
    lease_until = ${job.leaseUntil ?? null}::timestamptz, available_at = ${job.availableAt ?? job.createdAt}::timestamptz, updated_at = now() WHERE id = ${job.id}`;
  return {
    get: async id => normalize((await database.query`SELECT draft, source_work_item_id FROM product_catalogue_drafts WHERE id = ${id}`)[0]),
    list: async () => (await database.query`SELECT draft, source_work_item_id FROM product_catalogue_drafts ORDER BY updated_at DESC, id LIMIT 500`).map(normalize),
    jobs: async () => (await database.query`SELECT payload FROM product_catalogue_jobs ORDER BY created_at, id LIMIT 500`).map(row => row.payload),
    claimJob: input => {
      leaseOptions(input);
      return database.withTransaction(async tx => {
        // Short claim transactions serialize release selection across workers.
        // The durable running/awaiting job then holds the release lane.
        await tx.query`SELECT pg_advisory_xact_lock(hashtext('catalogue-release-claims'))`;
        for (let sweep = 0; sweep < 20; sweep++) {
          const row = (await tx.query`SELECT j.payload FROM product_catalogue_jobs j
            WHERE ((j.status = 'queued' AND j.available_at <= ${input.now}::timestamptz) OR (j.status = 'running' AND j.lease_until <= ${input.now}::timestamptz))
            AND COALESCE(j.payload->>'kind', 'render') = ANY(${input.kinds ?? ['render']}::text[])
            AND (j.payload->>'kind' <> 'publish' OR NOT EXISTS (
              SELECT 1 FROM product_catalogue_jobs other WHERE other.id <> j.id AND other.payload->>'kind' = 'publish'
              AND ((other.status = 'running' AND other.lease_until > ${input.now}::timestamptz)
                OR (other.status = 'queued' AND other.payload->>'awaitingRelease' = 'true'))
            ))
            ORDER BY j.available_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)[0];
          if (!row) return null;
          const claimed = claimCatalogueJob(row.payload, { ...input, token: randomUUID() });
          await saveJob(tx, claimed);
          if (claimed.status === 'failed') {
            const record = (await tx.query`SELECT draft FROM product_catalogue_drafts WHERE id = ${claimed.productId} FOR UPDATE`)[0];
            const draft = expiredCatalogueDraft(row.payload, record?.draft, input.now);
            if (draft) await saveDraft(tx, draft);
            continue;
          }
          return claimed;
        }
        return null;
      });
    },
    renewJob: input => database.withTransaction(async tx => {
      const job = (await tx.query`SELECT payload FROM product_catalogue_jobs WHERE id = ${input.id} FOR UPDATE`)[0]?.payload;
      if (!ownsLease(job, input.leaseToken, input.now)) return false;
      leaseOptions({ workerId: job.workerId, now: input.now, leaseMs: input.leaseMs });
      await saveJob(tx, { ...job, leaseUntil: new Date(Date.parse(input.now) + input.leaseMs).toISOString(), updatedAt: input.now });
      return true;
    }),
    finishJob: input => database.withTransaction(async tx => {
      const job = (await tx.query`SELECT payload FROM product_catalogue_jobs WHERE id = ${input.id} FOR UPDATE`)[0]?.payload;
      if (!job) throw new HttpError(404, 'This catalogue job was not found.');
      const record = (await tx.query`SELECT draft FROM product_catalogue_drafts WHERE id = ${job.productId} FOR UPDATE`)[0];
      const changed = finishCatalogueJob(job, record?.draft, input);
      await saveJob(tx, changed.job);
      if (changed.draft) await saveDraft(tx, changed.draft);
      return changed.job;
    }),
    command: input => database.withTransaction(async tx => {
      // Lock the public ID, including its first creation, across separate API processes.
      await tx.query`SELECT pg_advisory_xact_lock(hashtext(${input.id}))`;
      const prior = (await tx.query`SELECT fingerprint, result FROM product_catalogue_commands WHERE product_id = ${input.id} AND command_id = ${input.commandId}`)[0];
      if (prior) {
        if (prior.fingerprint !== input.fingerprint) throw new HttpError(409, 'This command key was already used for another catalogue change.');
        return prior.result;
      }
      const record = normalize((await tx.query`SELECT draft, source_work_item_id FROM product_catalogue_drafts WHERE id = ${input.id} FOR UPDATE`)[0]);
      if ((record?.draft.revision ?? 0) !== input.revision) throw new HttpError(409, 'This product changed. Reload before saving.', { currentRevision: record?.draft.revision ?? 0 });
      const change = await input.apply(record);
      if (record) {
        await tx.query`UPDATE product_catalogue_drafts SET revision = ${change.draft.revision}, draft = ${JSON.stringify(change.draft)}::jsonb, updated_at = now() WHERE id = ${input.id}`;
      } else {
        await tx.query`INSERT INTO product_catalogue_drafts(id, revision, source_work_item_id, draft) VALUES (${input.id}, ${change.draft.revision}, ${change.sourceWorkId ?? null}, ${JSON.stringify(change.draft)}::jsonb)`;
      }
      if (change.job) await tx.query`INSERT INTO product_catalogue_jobs(id, product_id, status, payload) VALUES (${change.job.id}, ${input.id}, 'queued', ${JSON.stringify(change.job)}::jsonb)`;
      await tx.query`INSERT INTO product_catalogue_commands(product_id, command_id, fingerprint, result) VALUES (${input.id}, ${input.commandId}, ${input.fingerprint}, ${JSON.stringify(change.draft)}::jsonb)`;
      return change.draft;
    }),
  };
}
