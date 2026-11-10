import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMigratedDatabase } from '../support/pglite-neon.mjs';
import { splitStatements } from '../../scripts/migrate-neon.mjs';
import { createPostgresBookkeepingRepository } from '../../lib/bookkeeping/postgres-repository.js';
import { createBookkeepingScheduledTask } from '../../lib/bookkeeping/runtime.js';

test('PostgreSQL ledger, payments and alert de-duplication', async () => {
  const db = await createMigratedDatabase();
  try {
    for (const file of ['011_spoolman_inventory.sql', '018_supply_ledger.sql']) {
      for (const statement of splitStatements(await readFile(new URL(`../../neon/migrations/${file}`, import.meta.url), 'utf8'))) await db.db.query(statement);
    }
    const repo = createPostgresBookkeepingRepository(db.query);
    await repo.markAlerted('spoolman:inst1:7');
    await repo.markSynced('spoolman:inst1:7', 'EXPENSE1');
    const ledger = await repo.loadLedger();
    assert.equal(ledger.get('spoolman:inst1:7').status, 'synced');
    assert.ok(ledger.get('spoolman:inst1:7').alertedAt);
    await assert.rejects(repo.markSynced('not-a-key', 'EXPENSE1'));
    await repo.recordPayment({ payer: 'Example Payer', receivedOn: '2026-10-02', amountCents: 250000 });
    await repo.recordPayment({ payer: 'Example Payer', receivedOn: '2026-10-02', amountCents: 250000 });
    assert.equal((await repo.listPayments('Example Payer')).length, 1);
    assert.equal(await repo.claimAlert('k'), true);
    assert.equal(await repo.claimAlert('k'), false);

    // End to end: the scheduled task alerts once for a missing check and retries after a failed send.
    const sent = []; let fail = true;
    const run = createBookkeepingScheduledTask({
      query: db.query, today: () => '2026-11-09', env: { EXPECTED_PAYMENT_ANCHOR: '2026-10-02', EXPECTED_PAYMENT_PAYER: 'Example Payer', EXPECTED_PAYMENT_CENTS: '250000' },
      notify: async a => { if (fail) return false; sent.push(a.subject); return true; }
    });
    await run();
    assert.equal(sent.length, 0);
    fail = false;
    await run(); await run();
    assert.ok(sent.length >= 1);
    assert.equal(new Set(sent).size, sent.length);
    assert.ok(sent.some(s => s.includes('2026-10-16')));
  } finally { await db.close?.(); }
});

test('scheduled task mirrors Invoice Ninja payments, clearing the missing-check alert', async () => {
  const db = await createMigratedDatabase();
  try {
    for (const statement of splitStatements(await readFile(new URL('../../neon/migrations/018_supply_ledger.sql', import.meta.url), 'utf8'))) await db.db.query(statement);
    const sent = [];
    const run = createBookkeepingScheduledTask({
      query: db.query, today: () => '2026-10-20', env: { EXPECTED_PAYMENT_ANCHOR: '2026-10-02', INVOICE_NINJA_PAYER_CLIENT_ID: 'CLIENT1', EXPECTED_PAYMENT_PAYER: 'Example Payer', EXPECTED_PAYMENT_CENTS: '250000' },
      notify: async a => (sent.push(a), true),
      payments: { listCompleted: async () => [{ id: 'PAY00001', date: '2026-10-02', amountCents: 250000 }, { id: 'PAY00002', date: '2026-10-16', amountCents: 250000 }] }
    });
    await run();
    assert.equal(sent.length, 0);
    assert.equal((await createPostgresBookkeepingRepository(db.query).listPayments('Example Payer')).length, 2);
  } finally { await db.close?.(); }
});
