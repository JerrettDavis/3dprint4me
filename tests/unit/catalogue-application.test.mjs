import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCatalogueRepository } from '../../lib/product-catalogue/local-repository.js';
import { createCatalogueApplication } from '../../lib/product-catalogue/application.js';

const actor = { id: 'owner-1', role: 'owner' };
const workId = 'work_gallery123';
const source = { item: { id: workId }, request: { customization: { generatorId: 'name-plate', generatorVersion: 2,
  params: { name: 'CUSTOMER PRIVATE', style: 'raised', plate: 'rect' } } } };
const promote = { action: 'promote', id: 'office-name-sign', workId, commandId: 'command-create' };
const edit = { title: 'Office sign', category: 'Signs', summary: 'A personal sign for a desk.', permissionNote: 'House design; sample text is generic.', params: { name: 'Alex' } };

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'catalogue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'catalogue.json');
  const repository = createLocalCatalogueRepository({ path });
  const app = createCatalogueApplication({ repository, workRepository: { getWork: async id => { assert.equal(id, workId); return source; } },
    renderConfigured: true, now: () => '2026-11-11T18:00:00.000Z', ...options });
  return { path, repository, app };
}

test('real private repository persists safe promotions and idempotent command replay across restarts', async t => {
  const { path, app } = await fixture(t);
  const first = await app.execute(promote, actor);
  assert.equal(first.params.name, 'Alex');
  const saved = await app.execute({ action: 'save', id: first.id, revision: 1, commandId: 'command-edit', edit }, actor);
  assert.equal(saved.revision, 2);
  const replay = await app.execute(promote, actor);
  assert.equal(replay.revision, 1, 'replay returns the original result without rewinding current state');
  const reopened = createLocalCatalogueRepository({ path });
  assert.equal((await reopened.get(first.id)).draft.revision, 2);
  const detail = await app.get(first.id, actor);
  assert.equal(detail.fields.find(f => f.key === 'name').type, 'text');
  assert.ok(detail.fields.every(f => f.key !== 'password'));
  assert.doesNotMatch(await readFile(path, 'utf8'), /CUSTOMER PRIVATE/);
  assert.equal((await reopened.get(first.id)).sourceWorkId, workId);
});

test('concurrent stale edits cannot overwrite settings, and key reuse cannot change a prior command', async t => {
  const { app } = await fixture(t);
  const draft = await app.execute(promote, actor);
  const results = await Promise.allSettled([
    app.execute({ action: 'save', id: draft.id, revision: 1, commandId: 'save-a', edit }, actor),
    app.execute({ action: 'save', id: draft.id, revision: 1, commandId: 'save-b', edit: { ...edit, title: 'Other title' } }, actor),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  await assert.rejects(app.execute({ ...promote, workId: 'work_other123' }, actor), e => e.status === 409);
});

test('render queue is durable and records exactly the reviewed safe settings', async t => {
  const { repository, app } = await fixture(t);
  await app.execute(promote, actor);
  await app.execute({ action: 'save', id: promote.id, revision: 1, commandId: 'command-edit', edit }, actor);
  const rendering = await app.execute({ action: 'render', id: promote.id, revision: 2, commandId: 'render-once' }, actor);
  assert.equal(rendering.status, 'rendering');
  const jobs = await repository.jobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].configurationSha256, rendering.render.configurationSha256);
  assert.equal(jobs[0].status, 'queued');
  assert.equal(jobs[0].productId, promote.id);
  assert.equal(jobs[0].draftRevision, rendering.revision);
  await app.execute({ action: 'render', id: promote.id, revision: 2, commandId: 'render-once' }, actor);
  assert.equal((await repository.jobs()).length, 1);
});

test('unconfigured render service preserves draft saving and never claims a preview is built', async t => {
  const { app, repository } = await fixture(t, { renderConfigured: false });
  await app.execute(promote, actor);
  const saved = await app.execute({ action: 'save', id: promote.id, revision: 1, commandId: 'command-edit', edit }, actor);
  await assert.rejects(app.execute({ action: 'render', id: promote.id, revision: saved.revision, commandId: 'render-once' }, actor), e => e.status === 409);
  assert.equal((await repository.get(promote.id)).draft.status, 'draft');
  assert.equal((await repository.jobs()).length, 0);
});

test('unauthorized roles and malformed commands cannot enumerate or mutate catalogue drafts', async t => {
  const { app } = await fixture(t);
  for (const bad of [null, { id: 'partner-1', role: 'partner' }]) {
    await assert.rejects(app.list(bad), e => e.status === 403);
    await assert.rejects(app.execute(promote, bad), e => e.status === 403);
  }
  await assert.rejects(app.execute({ ...promote, injected: 'private' }, actor), e => e.status === 400);
  await assert.rejects(app.execute({ ...promote, id: '../../public' }, actor), e => e.status === 400);
});
