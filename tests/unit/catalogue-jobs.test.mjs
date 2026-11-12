import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCatalogueRepository } from '../../lib/product-catalogue/local-repository.js';
import { createCatalogueApplication } from '../../lib/product-catalogue/application.js';

const actor = { id: 'owner', role: 'owner' };
const firstTime = '2026-11-11T18:00:00.000Z';
const later = seconds => new Date(Date.parse(firstTime) + seconds * 1000).toISOString();
const outcome = job => ({ ok: true, result: { jobId: job.id, configurationSha256: job.configurationSha256,
  images: [{ src: '/assets/images/products/catalogue/sample.webp', alt: 'Sample sign, studio render', kind: 'render' }],
  renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64) } });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'catalogue-jobs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { path: join(directory, 'private.json') };
  const repository = createLocalCatalogueRepository(options);
  const app = createCatalogueApplication({ repository, renderConfigured: true, now: () => firstTime,
    workRepository: { getWork: async () => ({ request: { customization: { generatorId: 'name-plate', generatorVersion: 2, params: {} } } }) } });
  await app.execute({ action: 'promote', id: 'sample', workId: 'work_sample123', commandId: 'create' }, actor);
  await app.execute({ action: 'save', id: 'sample', revision: 1, commandId: 'save', edit: { title: 'Sample', category: 'Signs', summary: 'A sample sign.', permissionNote: 'House design' } }, actor);
  await app.execute({ action: 'render', id: 'sample', revision: 2, commandId: 'render' }, actor);
  return { repository, app, reopen: () => createLocalCatalogueRepository(options) };
}

test('only one worker claims a durable job, and successful completion unlocks private review', async t => {
  const { repository, reopen } = await fixture(t);
  const claims = await Promise.all([repository.claimJob({ workerId: 'worker-a', now: firstTime, leaseMs: 60000 }), reopen().claimJob({ workerId: 'worker-b', now: firstTime, leaseMs: 60000 })]);
  assert.equal(claims.filter(Boolean).length, 1);
  const job = claims.find(Boolean);
  assert.equal(job.attempts, 1);
  assert.equal((await reopen().jobs())[0].status, 'running');
  const completed = await repository.finishJob({ id: job.id, leaseToken: job.leaseToken, now: later(10), ...outcome(job) });
  assert.equal(completed.status, 'ready');
  assert.equal((await reopen().get('sample')).draft.status, 'review_ready');
});

test('expired leases can be reclaimed and old workers cannot heartbeat or overwrite the new result', async t => {
  const { repository } = await fixture(t);
  const first = await repository.claimJob({ workerId: 'worker-a', now: firstTime, leaseMs: 60000 });
  const renewed = await repository.renewJob({ id: first.id, leaseToken: first.leaseToken, now: later(30), leaseMs: 60000 });
  assert.equal(renewed, true);
  assert.equal(await repository.claimJob({ workerId: 'worker-b', now: later(70), leaseMs: 60000 }), null);
  const second = await repository.claimJob({ workerId: 'worker-b', now: later(91), leaseMs: 60000 });
  assert.equal(second.id, first.id);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(second.attempts, 2);
  assert.equal(await repository.renewJob({ id: first.id, leaseToken: first.leaseToken, now: later(92), leaseMs: 60000 }), false);
  await assert.rejects(repository.finishJob({ id: first.id, leaseToken: first.leaseToken, now: later(93), ...outcome(first) }), e => e.status === 409);
  await repository.finishJob({ id: second.id, leaseToken: second.leaseToken, now: later(94), ...outcome(second) });
  assert.equal((await repository.get('sample')).draft.status, 'review_ready');
});

test('editing while a render runs cancels its stale result without altering the new draft', async t => {
  const { repository, app } = await fixture(t);
  const job = await repository.claimJob({ workerId: 'worker-a', now: firstTime, leaseMs: 60000 });
  await app.execute({ action: 'save', id: 'sample', revision: 3, commandId: 'edit-again', edit: { title: 'New title' } }, actor);
  assert.equal((await repository.finishJob({ id: job.id, leaseToken: job.leaseToken, now: later(10), ...outcome(job) })).status, 'cancelled');
  const current = (await repository.get('sample')).draft;
  assert.equal(current.title, 'New title');
  assert.equal(current.status, 'draft');
  assert.equal(current.render, null);
});

test('failed jobs retry at bounded intervals and finish with a recoverable safe failure', async t => {
  const { repository } = await fixture(t);
  let now = firstTime;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await repository.claimJob({ workerId: 'worker-a', now, leaseMs: 60000 });
    assert.equal(job.attempts, attempt);
    await repository.finishJob({ id: job.id, leaseToken: job.leaseToken, now, ok: false, error: 'PRIVATE CREDENTIAL' });
    if (attempt < 3) {
      assert.equal(await repository.claimJob({ workerId: 'worker-b', now, leaseMs: 60000 }), null);
      now = later(attempt * 120);
    }
  }
  const draft = (await repository.get('sample')).draft;
  assert.equal(draft.status, 'failed');
  assert.equal((await repository.jobs())[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(draft) + JSON.stringify(await repository.jobs()), /PRIVATE CREDENTIAL/);
  assert.equal(await repository.claimJob({ workerId: 'worker-a', now: later(1000), leaseMs: 60000 }), null);
});
