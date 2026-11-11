import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresCatalogueRepository } from '../../lib/product-catalogue/repository.js';
import { createCatalogueApplication } from '../../lib/product-catalogue/application.js';

test('PostgreSQL catalogue commands, render jobs, replay and RLS remain private and transactional', async () => {
  const db = new PGlite();
  const queryFor = connection => async (parts, ...values) => (await connection.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values)).rows;
  try {
    await db.exec("CREATE TABLE work_items(id text PRIMARY KEY); INSERT INTO work_items VALUES ('work_gallery123');");
    await db.exec(await readFile(new URL('../../neon/migrations/019_product_catalogue.sql', import.meta.url), 'utf8'));
    const repository = createPostgresCatalogueRepository({ database: { query: queryFor(db), withTransaction: operation => db.transaction(tx => operation({ query: queryFor(tx) })) } });
    const app = createCatalogueApplication({ repository, renderConfigured: true, workRepository: { getWork: async () => ({ request: { customization: { generatorId: 'name-plate', generatorVersion: 2, params: { name: 'PRIVATE NAME' } } } }) } });
    const actor = { id: 'owner-1', role: 'owner' };
    const promote = { action: 'promote', id: 'office-sign', workId: 'work_gallery123', commandId: 'create-command' };
    assert.equal((await app.execute(promote, actor)).revision, 1);
    assert.equal((await app.execute(promote, actor)).revision, 1);
    await app.execute({ action: 'save', id: promote.id, revision: 1, commandId: 'save-command', edit: { title: 'Office sign', category: 'Signs', summary: 'Your name on your desk.', params: { name: 'Alex' } } }, actor);
    await assert.rejects(app.execute({ action: 'save', id: promote.id, revision: 1, commandId: 'stale-command', edit: { title: 'Lost change' } }, actor), e => e.status === 409);
    const rendering = await app.execute({ action: 'render', id: promote.id, revision: 2, commandId: 'render-command' }, actor);
    assert.equal(rendering.status, 'rendering');
    assert.equal((await repository.jobs()).length, 1);
    const claim = await repository.claimJob({ workerId: 'worker-one', now: '2030-01-01T00:00:00.000Z', leaseMs: 60000 });
    assert.equal(claim.attempts, 1);
    assert.equal(await repository.claimJob({ workerId: 'worker-two', now: '2030-01-01T00:00:01.000Z', leaseMs: 60000 }), null);
    assert.equal(await repository.renewJob({ id: claim.id, leaseToken: claim.leaseToken, now: '2030-01-01T00:00:20.000Z', leaseMs: 60000 }), true);
    await repository.finishJob({ id: claim.id, leaseToken: claim.leaseToken, now: '2030-01-01T00:00:30.000Z', ok: true,
      result: { jobId: claim.id, configurationSha256: claim.configurationSha256, renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64),
        images: [{ src: '/assets/images/products/catalogue/office-sign.webp', alt: 'Sample sign', kind: 'render' }] } });
    assert.equal((await repository.get(promote.id)).draft.status, 'review_ready');
    assert.equal((await repository.jobs())[0].status, 'ready');
    assert.equal((await repository.get(promote.id)).sourceWorkId, 'work_gallery123');
    assert.doesNotMatch(JSON.stringify(await repository.list()), /PRIVATE NAME/);
    await db.exec('CREATE ROLE catalogue_browser; SET ROLE catalogue_browser;');
    for (const table of ['product_catalogue_drafts', 'product_catalogue_commands', 'product_catalogue_jobs']) {
      await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
    }
    await db.exec('RESET ROLE;');
  } finally { await db.close(); }
});
