import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCatalogueRepository } from '../../lib/product-catalogue/local-repository.js';
import { createCatalogueApplication } from '../../lib/product-catalogue/application.js';
import { createCatalogueWorker } from '../../lib/product-catalogue/worker.js';

async function queue(t, publishConfigured = false) {
  const directory = await mkdtemp(join(tmpdir(), 'catalogue-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createLocalCatalogueRepository({ path: join(directory, 'private.json') });
  const application = createCatalogueApplication({ repository, renderConfigured: true, publishConfigured,
    workRepository: { getWork: async () => ({ request: { customization: { generatorId: 'name-plate', generatorVersion: 2, params: {} } } }) } });
  const actor = { id: 'owner', role: 'owner' };
  await application.execute({ action: 'promote', id: 'desk-sign', workId: 'work_sample123', commandId: 'create' }, actor);
  await application.execute({ action: 'save', id: 'desk-sign', revision: 1, commandId: 'save', edit: { title: 'Desk sign', summary: 'A sign for a desk.', category: 'Signs' } }, actor);
  await application.execute({ action: 'render', id: 'desk-sign', revision: 2, commandId: 'render' }, actor);
  return repository;
}
const result = job => ({ jobId: job.id, configurationSha256: job.configurationSha256, renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64),
  images: [{ src: '/assets/images/products/catalogue/desk-sign.webp', alt: 'Desk sign, studio render', kind: 'render' }] });

test('worker consumes a durable queue and exposes review-ready output without claiming publication', async t => {
  const repository = await queue(t);
  const worker = createCatalogueWorker({ repository, workerId: 'worker-a', render: async job => result(job) });
  assert.equal(await worker.tick(), 'ready');
  assert.equal((await repository.get('desk-sign')).draft.status, 'review_ready');
  assert.equal((await repository.get('desk-sign')).draft.published, null);
  assert.equal(await worker.tick(), 'idle');
});
test('admin publication and withdrawal use the durable publisher and stay locked until verified', async t => {
  const repository = await queue(t, true);
  const actor = { id: 'owner', role: 'owner' };
  const application = createCatalogueApplication({ repository, publishConfigured: true });
  const renderer = createCatalogueWorker({ repository, workerId: 'renderer', render: async job => result(job) });
  await renderer.tick();
  let draft = (await repository.get('desk-sign')).draft;
  draft = await application.execute({ action: 'save', id: draft.id, revision: draft.revision, commandId: 'rights', edit: { permissionNote: 'Generic house design.' } }, actor);
  // Editing invalidates old renders, so rebuild before review.
  const renderingApp = createCatalogueApplication({ repository, renderConfigured: true });
  await renderingApp.execute({ action: 'render', id: draft.id, revision: draft.revision, commandId: 'rerender' }, actor);
  await renderer.tick();
  draft = (await repository.get(draft.id)).draft;
  draft = await application.execute({ action: 'approve', id: draft.id, revision: draft.revision, commandId: 'approve' }, actor);
  draft = await application.execute({ action: 'publish', id: draft.id, revision: draft.revision, commandId: 'publish' }, actor);
  assert.equal(draft.status, 'publishing');
  assert.equal(await renderer.tick(), 'idle');
  let at = new Date().toISOString(); let verified = false;
  const publisher = createCatalogueWorker({ repository, workerId: 'publisher', now: () => at, publish: async job => ({
    ...(verified ? { verified: true } : { pending: true }), releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, commit: 'a'.repeat(40),
  }) });
  assert.equal(await publisher.tick(), 'queued');
  assert.equal((await repository.get(draft.id)).draft.status, 'publishing');
  at = new Date(Date.parse(at) + 61000).toISOString(); verified = true;
  assert.equal(await publisher.tick(), 'ready');
  draft = (await repository.get(draft.id)).draft;
  assert.equal(draft.status, 'published');
  await application.execute({ action: 'withdraw', id: draft.id, revision: draft.revision, commandId: 'withdraw' }, actor);
  assert.equal(await publisher.tick(), 'ready');
  assert.equal((await repository.get(draft.id)).draft.status, 'withdrawn');
});

test('renderer errors stay private and leave a durable retry instead of losing the draft', async t => {
  const repository = await queue(t);
  const worker = createCatalogueWorker({ repository, workerId: 'worker-a', render: async () => { throw new Error('PRIVATE CREDENTIAL /private/path'); } });
  assert.equal(await worker.tick(), 'queued');
  assert.equal((await repository.get('desk-sign')).draft.status, 'rendering');
  const jobs = await repository.jobs();
  assert.equal(jobs[0].errorCode, 'catalogue_render_failed');
  assert.doesNotMatch(JSON.stringify(jobs), /PRIVATE CREDENTIAL|private\/path/);
});

test('a busy worker does not claim an extra job while its renderer is still running', async t => {
  const repository = await queue(t);
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const worker = createCatalogueWorker({ repository, workerId: 'worker-a', render: async job => { await pending; return result(job); } });
  const first = worker.tick();
  assert.equal(await worker.tick(), 'busy');
  finish();
  assert.equal(await first, 'ready');
});
