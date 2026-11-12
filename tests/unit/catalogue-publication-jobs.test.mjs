import test from 'node:test';
import assert from 'node:assert/strict';
import { finishCatalogueJob, claimCatalogueJob } from '../../lib/product-catalogue/job-policy.js';
import { catalogueSnapshotHash } from '../../lib/product-catalogue/publication.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
const now = '2026-11-11T18:00:00.000Z';
function fixture() {
  const snapshot = PRODUCTS[0];
  const job = { id: 'publish-test', kind: 'publish', operation: 'publish', draftRevision: 4, status: 'running', attempts: 9,
    snapshot, snapshotSha256: catalogueSnapshotHash(snapshot), releaseId: 'release-test', leaseToken: 'token', leaseUntil: '2026-11-11T18:05:00.000Z' };
  const draft = { id: snapshot.id, revision: 4, status: 'publishing', publication: { jobId: job.id, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256 } };
  return { job, draft };
}
test('publication lease recovery does not exhaust a possibly delivered release', () => {
  const { job } = fixture();
  const claimed = claimCatalogueJob({ ...job, leaseUntil: now }, { workerId: 'worker', now, leaseMs: 300000, token: 'new' });
  assert.equal(claimed.status, 'running');
});
test('pending publication persists delivery and keeps product locked for reconciliation', () => {
  const { job, draft } = fixture();
  const result = { pending: true, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, commit: 'a'.repeat(40) };
  const changed = finishCatalogueJob(job, draft, { leaseToken: 'token', now, ok: true, result });
  assert.equal(changed.job.status, 'queued');
  assert.deepEqual(changed.job.delivery, result);
  assert.equal(changed.job.awaitingRelease, true);
  assert.equal(changed.draft.status, 'publishing');
});
test('only a verified publication completes the durable job and product', () => {
  const { job, draft } = fixture();
  const changed = finishCatalogueJob(job, draft, { leaseToken: 'token', now, ok: true, result: { verified: true, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, commit: 'a'.repeat(40) } });
  assert.equal(changed.job.status, 'ready');
  assert.equal(changed.draft.status, 'published');
});
test('an interrupted publisher remains recoverable without exposing its exception', () => {
  const { job, draft } = fixture();
  const changed = finishCatalogueJob(job, draft, { leaseToken: 'token', now, ok: false });
  assert.equal(changed.job.status, 'queued');
  assert.equal(changed.draft.status, 'publishing');
});
