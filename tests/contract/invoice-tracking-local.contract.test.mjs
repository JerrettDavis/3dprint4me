import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalInvoiceTrackingRepository } from '../../lib/invoicing/local-tracking-repository.js';
test('private development adapter persists native tracking settings across reopen and checks work revisions', async () => {
  const path = await mkdtemp(join(tmpdir(), '3dp-billing-local-'));
  let repository;
  try {
    repository = await createLocalInvoiceTrackingRepository({ path, getWork: async () => ({ item: { revision: 2 } }) });
    await assert.rejects(repository.command({ id: 'local-command-one', actorId: 'owner', fingerprint: 'a'.repeat(64), revision: 1,
      work: { id: 'work_localtest123', revision: 1 }, mutate: settings => settings }), { status: 409 });
    await repository.command({ id: 'local-command-two', actorId: 'owner', fingerprint: 'b'.repeat(64), revision: 1,
      work: { id: 'work_localtest123', revision: 2 }, mutate: settings => ({ ...settings, notificationsEnabled: true }) });
    await repository.close();
    repository = await createLocalInvoiceTrackingRepository({ path, getWork: async () => ({ item: { revision: 2 } }) });
    assert.equal((await repository.readTracking()).settings.notificationsEnabled, true);
    assert.equal((await repository.readTracking()).revision, 2);
  } finally { await repository?.close(); await rm(path, { recursive: true, force: true }); }
});
