import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresCatalogueRepository } from '../../lib/product-catalogue/repository.js';
import { catalogueSnapshotHash } from '../../lib/product-catalogue/publication.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
test('native publication claims filter worker capabilities and serialize public releases across products', async () => {
  const db = new PGlite();
  const queryFor = connection => async (parts, ...values) => (await connection.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values)).rows;
  try {
    await db.exec('CREATE TABLE work_items(id text PRIMARY KEY);');
    await db.exec(await readFile(new URL('../../neon/migrations/019_product_catalogue.sql', import.meta.url), 'utf8'));
    const repository = createPostgresCatalogueRepository({ database: { query: queryFor(db), withTransaction: operation => db.transaction(tx => operation({ query: queryFor(tx) })) } });
    const now = '2030-01-01T00:00:00.000Z';
    for (const id of ['first', 'second']) {
      const snapshot = { ...PRODUCTS[0], id };
      const job = { id: `publish-${id}`, productId: id, kind: 'publish', operation: 'publish', draftRevision: 1, status: 'queued', attempts: 0, snapshot,
        snapshotSha256: catalogueSnapshotHash(snapshot), releaseId: `release-${id}`, createdAt: now };
      const draft = { id, revision: 1, status: 'publishing', publication: { jobId: job.id, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256 } };
      await repository.command({ id, commandId: 'create', fingerprint: 'a'.repeat(64), revision: 0, apply: async () => ({ draft, job }) });
    }
    const input = { workerId: 'worker', now, leaseMs: 60000 };
    assert.equal(await repository.claimJob({ ...input, kinds: ['render'] }), null);
    const first = await repository.claimJob({ ...input, kinds: ['publish'] });
    assert.equal(first.productId, 'first');
    assert.equal(await repository.claimJob({ ...input, kinds: ['publish'] }), null);
    const receipt = { releaseId: first.releaseId, snapshotSha256: first.snapshotSha256, commit: 'a'.repeat(40) };
    await repository.finishJob({ id: first.id, leaseToken: first.leaseToken, now, ok: true, result: { pending: true, ...receipt } });
    assert.equal(await repository.claimJob({ ...input, kinds: ['publish'] }), null);
    const later = { ...input, now: '2030-01-01T00:01:01.000Z', kinds: ['publish'] };
    const resumed = await repository.claimJob(later);
    assert.equal(resumed.id, first.id);
    await repository.finishJob({ id: first.id, leaseToken: resumed.leaseToken, now: later.now, ok: true, result: { verified: true, ...receipt } });
    assert.equal((await repository.claimJob(later)).productId, 'second');
  } finally { await db.close(); }
});
