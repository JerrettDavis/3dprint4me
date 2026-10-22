import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDatabase } from '../support/pglite-neon.mjs';
import { createLocalPrintRepository } from '../../lib/print-estimation/adapters/local-print-repository.js';
import { createNeonPrintRepository } from '../../lib/print-estimation/adapters/neon-print-repository.js';
import { normalizeFilamentInput } from '../../lib/print-estimation/inventory.js';

for (const mode of ['local', 'postgres']) test(`${mode}: filament hex, inventory/settings/work revisions and legacy cost basis`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-contract-'));
  const db = mode === 'postgres' ? await createMigratedDatabase() : null;
  const repo = db ? createNeonPrintRepository({ query: db.query }) : createLocalPrintRepository({ path: join(dir, 'print.json') });
  try {
    const input = normalizeFilamentInput({ material: 'pla', color: 'Blue', colorHex: '#00f', spoolNominalGrams: 1000, purchaseCostCents: 2000, onHandGrams: 500 });
    const row = await repo.saveFilament(input);
    assert.equal(row.colorHex, '#0000ff'); assert.equal(row.revision, 1);
    const updated = await repo.saveFilament({ ...input, id: row.id, revision: row.revision, onHandGrams: 400 });
    assert.equal(updated.revision, 2);
    await assert.rejects(repo.saveFilament({ ...input, id: row.id, revision: 1 }), { status: 409 });
    assert.equal((await repo.listFilament())[0].onHandGrams, 400);
    const empty = await repo.getMatchingSettings(); assert.equal(empty.revision, 0);
    const settings = await repo.saveMatchingSettings({ revision: 0, settings: { mode: 'rgb' } });
    assert.equal(settings.revision, 1);
    await assert.rejects(repo.saveMatchingSettings({ revision: 0, settings: {} }), { status: 409 });
    const workId = 'work_aaaaaaaa';
    if (db) {
      await db.query`INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload) VALUES ('3DP-TEST-12345678', 'draft', 'print', 'Test', 'Taylor', 't@example.com', '{}'::jsonb)`;
      await db.query`INSERT INTO work_items (id, request_id) VALUES (${workId}, '3DP-TEST-12345678')`;
    }
    assert.equal((await repo.getWorkMatching(workId)).revision, 0);
    const state = await repo.saveWorkMatching({ workId, revision: 0, document: { requirementsOverride: null, proposals: [], history: [{ type: 'test' }] } });
    assert.equal(state.revision, 1);
    assert.equal(state.history[0].type, 'test');
    await assert.rejects(repo.saveWorkMatching({ workId, revision: 0, document: {} }), { status: 409 });
    assert.equal((await repo.getWorkMatching('work_bbbbbbbb')).revision, 0);
  } finally { await db?.close(); await rm(dir, { recursive: true, force: true }); }
});
