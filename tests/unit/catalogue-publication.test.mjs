import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueDraft, editCatalogueDraft, queueCatalogueRender, finishCatalogueRender, approveCatalogueDraft } from '../../lib/product-catalogue/domain.js';
import { queueCataloguePublication, finishCataloguePublication, failCataloguePublication, mergeCatalogueSnapshot, catalogueSnapshotHash } from '../../lib/product-catalogue/publication.js';

const actor = { id: 'owner', role: 'owner' };
const now = '2026-11-11T18:00:00.000Z';
function approved() {
  const created = createCatalogueDraft({ id: 'office-sign', customization: { generatorId: 'name-plate', generatorVersion: 2, params: {} }, actor, now });
  const edited = editCatalogueDraft(created, { title: 'Office sign', category: 'Signs', summary: 'A sign for a desk.', permissionNote: 'House design with generic text.' }, { actor, now });
  const queued = queueCatalogueRender(edited, { jobId: 'render-sample', actor, now });
  const ready = finishCatalogueRender(queued, { jobId: 'render-sample', configurationSha256: queued.render.configurationSha256,
    renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64),
    images: [{ src: '/assets/images/products/catalogue/office-sign.webp', alt: 'Office sign, studio render', kind: 'render' }] }, { now });
  return approveCatalogueDraft(ready, { actor, now });
}
const verified = job => ({ verified: true, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, commit: 'd'.repeat(40) });

test('publication reserves an immutable revision and blocks editing until a verified release', () => {
  const draft = approved();
  assert.throws(() => queueCataloguePublication(draft, { jobId: 'publish-sample', actor: { id: 'partner', role: 'partner' }, now }), e => e.status === 403);
  const publication = queueCataloguePublication(draft, { jobId: 'publish-sample', actor, now });
  assert.equal(publication.draft.status, 'publishing');
  assert.equal(publication.job.snapshot.revision, 1);
  assert.equal(publication.job.snapshotSha256, catalogueSnapshotHash(publication.job.snapshot));
  assert.equal(publication.job.renderJobId, 'render-sample');
  assert.equal(publication.draft.published, null);
  assert.throws(() => editCatalogueDraft(publication.draft, { title: 'Changed while deploying' }, { actor, now }), e => e.status === 409);
  assert.doesNotMatch(JSON.stringify(publication.job.snapshot), /permissionNote|owner|render-sample|review|source/);
});

test('a return from the deploy adapter is insufficient unless release and snapshot are verified', () => {
  const { draft, job } = queueCataloguePublication(approved(), { jobId: 'publish-sample', actor, now });
  for (const result of [{ verified: false }, { ...verified(job), releaseId: 'wrong' }, { ...verified(job), snapshotSha256: 'f'.repeat(64) }, { ...verified(job), commit: 'not-a-commit' }]) {
    assert.throws(() => finishCataloguePublication(draft, job, result, { now }), e => e.status === 409);
  }
  const published = finishCataloguePublication(draft, job, verified(job), { now });
  assert.equal(published.status, 'published');
  assert.equal(published.published.revision, 1);
  assert.equal(published.published.snapshot.params.name, 'Alex');
  assert.equal(published.publication.phase, 'live');
});

test('withdrawal uses the last published snapshot rather than unreviewed edited values', () => {
  const first = queueCataloguePublication(approved(), { jobId: 'publish-first', actor, now });
  const published = finishCataloguePublication(first.draft, first.job, verified(first.job), { now });
  const edited = editCatalogueDraft(published, { params: { name: 'UNREVIEWED' }, title: 'Unreviewed title' }, { actor, now });
  const withdrawal = queueCataloguePublication(edited, { operation: 'withdraw', jobId: 'publish-withdrawal', actor, now });
  assert.equal(withdrawal.job.snapshot.revision, 2);
  assert.equal(withdrawal.job.snapshot.status, 'withdrawn');
  assert.equal(withdrawal.job.snapshot.params.name, 'Alex');
  assert.equal(withdrawal.job.snapshot.title, 'Office sign');
  assert.equal(withdrawal.job.renderJobId, null);
  const complete = finishCataloguePublication(withdrawal.draft, withdrawal.job, verified(withdrawal.job), { now });
  assert.equal(complete.status, 'withdrawn');
});

test('failed publication preserves the previous live product and never reuses an allocated revision', () => {
  const first = queueCataloguePublication(approved(), { jobId: 'publish-first', actor, now });
  assert.throws(() => failCataloguePublication(first.draft, first.job, { uncertain: true, now }), e => e.status === 409);
  const failed = failCataloguePublication(first.draft, first.job, { uncertain: false, now });
  assert.equal(failed.published, null);
  assert.equal(failed.status, 'review_ready');
  const reviewed = approveCatalogueDraft(failed, { actor, now });
  const retry = queueCataloguePublication(reviewed, { jobId: 'publish-retry', actor, now });
  assert.equal(retry.job.snapshot.revision, 2);
});

test('public projection merges preserve history and reject changes to existing immutable revisions', () => {
  const first = queueCataloguePublication(approved(), { jobId: 'publish-first', actor, now }).job.snapshot;
  const second = { ...first, revision: 2, params: { ...first.params, name: 'NEW' } };
  const merged = mergeCatalogueSnapshot([first], second);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].params.name, 'Alex');
  assert.equal(merged[1].params.name, 'NEW');
  assert.equal(mergeCatalogueSnapshot(merged, second).length, 2, 'an identical retry is idempotent');
  assert.throws(() => mergeCatalogueSnapshot(merged, { ...first, params: second.params }), e => e.status === 409);
  assert.throws(() => mergeCatalogueSnapshot(merged, { ...second, sourceWorkId: 'private' }));
});
