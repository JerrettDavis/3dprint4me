import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createInvoiceTrackingRepository } from '../../lib/invoicing/tracking-repository.js';
import { createInvoiceTrackingService } from '../../lib/invoicing/tracking-service.js';
import { normalizeTrackedInvoice, normalizePaymentAllocation } from '../../lib/invoicing/tracking-domain.js';

const time = '2026-11-24T18:00:00.000Z';
const invoice = overrides => normalizeTrackedInvoice({ id: 'Invoice123', client_id: 'Client1234', number: '3DP-TEST-001',
  currency: 'USD', status_id: 4, amount: 54.26, total_taxes: 4.26, paid_to_date: 54.26, balance: 0,
  due_date: '2026-12-12', partial_due_date: '', is_deleted: false, archived_at: 0, invitations: [], ...overrides });
const allocation = overrides => normalizePaymentAllocation({ id: 'Allocation1', invoiceId: 'Invoice123', paymentId: 'Payment123',
  amount: 54.26, refunded: 0, currency: 'USD', status: 'completed', deleted: false, date: '2026-11-20', updatedAt: 1795197600, ...overrides });
const snapshot = (invoices = [invoice()], allocations = [allocation()]) => ({ source: { companyId: 'Company123', groupId: 'Group1234' }, invoices, allocations });

async function fixture() {
  const db = new PGlite();
  await db.exec('CREATE TABLE work_items(id text PRIMARY KEY, revision integer); CREATE TABLE invoice_operations(work_item_id text, state text, provider jsonb);');
  await db.exec(await readFile(new URL('../../neon/migrations/020_invoice_tracking.sql', import.meta.url), 'utf8'));
  const queryFor = connection => async (parts, ...values) =>
    (await connection.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values)).rows;
  const database = { query: queryFor(db), withTransaction: operation => db.transaction(tx => operation({ query: queryFor(tx) })) };
  return { db, repository: createInvoiceTrackingRepository({ database }) };
}

test('native sync claims are exclusive and an expired lease cannot overwrite a new run', async () => {
  const { db, repository } = await fixture();
  try {
    assert.ok(await repository.claimSync({ token: 'worker-one', now: time, leaseMs: 1000 }));
    assert.equal(await repository.claimSync({ token: 'worker-two', now: time, leaseMs: 1000 }), null);
    assert.ok(await repository.claimSync({ token: 'worker-two', now: '2026-11-24T18:00:02Z', leaseMs: 1000 }));
    assert.equal(await repository.commitSnapshot({ token: 'worker-one', now: '2026-11-24T18:00:02Z', snapshot: snapshot(), events: [] }), false);
    assert.equal((await repository.readTracking()).lastSuccessfulAt, null);
  } finally { await db.close(); }
});

test('first import is silent and complete subsequent imports retain multiple durable payment events', async () => {
  const { db, repository } = await fixture();
  try {
    let current = snapshot();
    const service = createInvoiceTrackingService({ repository, provider: { readSnapshot: async () => current }, now: () => new Date(time) });
    assert.equal((await service.sync()).status, 'synced');
    assert.equal((await repository.listEvents()).length, 0);
    current = snapshot([invoice({ invitations: [{ opened_date: '2026-11-24T17:00:00Z', viewed_date: '2026-11-24T17:05:00Z' }] })],
      [allocation(), allocation({ id: 'Allocation2', paymentId: 'Payment456', amount: 10 }), allocation({ id: 'Allocation3', paymentId: 'Payment789', amount: 20 })]);
    await service.sync(); await service.sync();
    const events = await repository.listEvents();
    assert.equal(events.length, 4);
    assert.equal(events.filter(e => e.payload.kind === 'invoice_payment').length, 2);
    assert.deepEqual(events.filter(e => e.payload.kind === 'invoice_payment').map(e => e.payload.amountCents).sort((a,b)=>a-b), [1000, 2000]);
    assert.equal(new Set(events.map(e => e.id)).size, 4);
    const state = await repository.readTracking();
    assert.equal(state.lastSuccessfulAt, time);
    assert.equal(state.snapshot.allocations.length, 3);
  } finally { await db.close(); }
});

test('failed provider reads preserve the last complete snapshot and expose sanitized stale state', async () => {
  const { db, repository } = await fixture();
  try {
    let fail = false;
    const service = createInvoiceTrackingService({ repository, provider: { readSnapshot: async () => {
      if (fail) throw new Error('PRIVATE PROVIDER TOKEN'); return snapshot();
    } }, now: () => new Date(time) });
    await service.sync(); fail = true;
    assert.equal((await service.sync()).status, 'unavailable');
    const state = await repository.readTracking();
    assert.equal(state.snapshot.invoices[0].status, 'paid');
    assert.equal(state.errorCategory, 'provider_unavailable');
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE PROVIDER TOKEN/);
  } finally { await db.close(); }
});

test('changing the provider account cannot silently replace or merge the stored billing source', async () => {
  const { db, repository } = await fixture();
  try {
    let current = snapshot();
    const service = createInvoiceTrackingService({ repository, provider: { readSnapshot: async () => current }, now: () => new Date(time) });
    await service.sync(); current = { ...snapshot(), source: { companyId: 'AnotherCompany', groupId: 'Group1234' } };
    assert.equal((await service.sync()).status, 'unavailable');
    assert.equal((await repository.readTracking()).snapshot.source.companyId, 'Company123');
    assert.equal((await repository.readTracking()).errorCategory, 'source_changed');
  } finally { await db.close(); }
});

test('event delivery leases survive restarts, retry and reject stale acknowledgements', async () => {
  const { db, repository } = await fixture();
  try {
    await db.query("UPDATE invoice_tracking_state SET settings = settings || '{\"notificationsEnabled\":true}'::jsonb");
    let current = snapshot();
    const service = createInvoiceTrackingService({ repository, provider: { readSnapshot: async () => current }, now: () => new Date(time) });
    await service.sync();
    current = snapshot([invoice()], [allocation(), allocation({ id: 'Allocation2', paymentId: 'Payment456', amount: 10 })]);
    await service.sync();
    const [first] = await repository.claimEvents({ token: 'delivery-one', now: time, leaseMs: 1000, limit: 10 });
    assert.equal(first.attempts, 1);
    assert.deepEqual(await repository.claimEvents({ token: 'delivery-two', now: time, leaseMs: 1000, limit: 10 }), []);
    const [retry] = await repository.claimEvents({ token: 'delivery-two', now: '2026-11-24T18:00:02Z', leaseMs: 1000, limit: 10 });
    assert.equal(retry.id, first.id);
    assert.equal(retry.attempts, 2);
    assert.equal(await repository.finishEvent({ id: first.id, token: 'delivery-one', now: '2026-11-24T18:00:02Z', delivered: true }), false);
    assert.equal(await repository.finishEvent({ id: retry.id, token: 'delivery-two', now: '2026-11-24T18:00:02Z', delivered: true }), true);
    assert.deepEqual(await repository.claimEvents({ token: 'delivery-three', now: '2026-11-24T18:00:04Z', leaseMs: 1000, limit: 10 }), []);
  } finally { await db.close(); }
});

test('tracking state, events and command receipts deny browser-role access', async () => {
  const { db } = await fixture();
  try {
    await db.exec('CREATE ROLE tracking_browser; SET ROLE tracking_browser;');
    for (const table of ['invoice_tracking_state', 'invoice_tracking_events', 'invoice_tracking_commands']) {
      await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
    }
    await db.exec('RESET ROLE;');
  } finally { await db.close(); }
});

test('billing settings commands replay by identity and reject stale or conflicting writes', async () => {
  const { db, repository } = await fixture();
  try {
    const command = { id: 'settings-command', actorId: 'owner-one', fingerprint: 'a'.repeat(64), revision: 1,
      mutate: settings => ({ ...settings, notificationsEnabled: true }) };
    const first = await repository.command(command);
    assert.equal(first.revision, 2);
    assert.equal(first.settings.notificationsEnabled, true);
    assert.deepEqual(await repository.command(command), first);
    await assert.rejects(repository.command({ ...command, fingerprint: 'b'.repeat(64) }), e => e.status === 409);
    await assert.rejects(repository.command({ ...command, actorId: 'owner-two' }), e => e.status === 409);
    await assert.rejects(repository.command({ ...command, id: 'stale-command' }), e => e.status === 409);
    assert.equal((await repository.readTracking()).revision, 2);
    const audit = (await db.query("SELECT command FROM invoice_tracking_commands WHERE id='settings-command'")).rows[0].command;
    assert.deepEqual(audit, {});
  } finally { await db.close(); }
});

test('an invalid event rolls back both earlier event inserts and the snapshot update', async () => {
  const { db, repository } = await fixture();
  try {
    await repository.claimSync({ token: 'worker-one', now: time, leaseMs: 1000 });
    await assert.rejects(repository.commitSnapshot({ token: 'worker-one', now: time, snapshot: snapshot(), events: [
      { id: 'valid-event', kind: 'invoice_viewed', invoiceId: 'Invoice123' },
      { id: 'invalid-event', padding: 'x'.repeat(10000) }
    ] }));
    assert.equal((await repository.readTracking()).lastSuccessfulAt, null);
    assert.deepEqual(await repository.listEvents(), []);
  } finally { await db.close(); }
});

test('project billing changes check the actual work revision inside the command transaction', async () => {
  const { db, repository } = await fixture();
  try {
    await db.query("INSERT INTO work_items VALUES ('work_project123', 6)");
    const command = { id: 'work-command', actorId: 'owner-one', fingerprint: 'a'.repeat(64), revision: 1,
      work: { id: 'work_project123', revision: 5 }, mutate: settings => ({ ...settings,
        workBilling: [{ workId: 'work_project123', state: 'needs_invoice' }] }) };
    await assert.rejects(repository.command(command), e => e.status === 409);
    assert.equal((await repository.readTracking()).settings.workBilling.length, 0);
    assert.equal((await repository.command({ ...command, work: { ...command.work, revision: 6 } })).settings.workBilling.length, 1);
    await db.query("INSERT INTO invoice_operations VALUES ('work_project123','draft','{\"id\":\"Invoice123\"}')");
    assert.deepEqual(await repository.linkedWorks(), [{ workId: 'work_project123', invoiceId: 'Invoice123' }]);
  } finally { await db.close(); }
});
