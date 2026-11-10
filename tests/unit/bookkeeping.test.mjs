import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePayments, expectedDates, DEFAULT_TIMING } from '../../lib/bookkeeping/expected-payments.js';
import { planSupplySync, createSupplySync, createMemorySupplyRepository } from '../../lib/bookkeeping/supply-sync.js';
import { createInvoiceNinjaExpenses } from '../../lib/bookkeeping/invoice-ninja-expenses.js';

test('biweekly dates', () => assert.deepEqual(expectedDates({ anchor: '2026-10-02' }, '2026-11-06'), ['2026-10-02', '2026-10-16', '2026-10-30']));

test('gap detector flags a missing check and an amount mismatch', () => {
  const schedule = { ...DEFAULT_TIMING, payer: 'Example Payer', amountCents: 250000 };
  const r = reconcilePayments({ schedule, anchor: '2026-10-02', today: '2026-11-09', payments: [{ date: '2026-10-02', amountCents: 250000 }, { date: '2026-10-30', amountCents: 200000 }] });
  assert.deepEqual(r.periods.map(p => p.status), ['received', 'missing', 'amount_mismatch', 'upcoming']);
  assert.equal(r.alerts.length, 2);
});

const item = (id, price, extra = {}) => ({ active: true, brandLine: 'Brand', color: 'PLA Blue', source: { instanceId: 'inst1', spoolId: id, price, currency: 'USD', rawMaterial: 'PLA', priceSource: 'spool', ...extra } });

test('creates priced spools, alerts unpriced once, respects baseline', async () => {
  const items = [item(1, 16.99), item(2, null), item(3, null)];
  const repo = createMemorySupplyRepository(), alerts = [], calls = [];
  const provider = { findByNumber: async () => null, createExpense: async p => (calls.push(p.number), { id: 'EXP' + p.spoolId + 'xx' }) };
  const run = createSupplySync({ provider, repository: repo, notify: a => alerts.push(a), baselineSpoolId: 2 });
  assert.equal((await run(items)).created, 1);
  assert.equal(alerts[0].spools.length, 1);
  await run(items);
  assert.equal(calls.length, 1);
  assert.equal(alerts.length, 1);
});

test('an ambiguous earlier create is adopted, not duplicated', async () => {
  const repo = createMemorySupplyRepository(); let creates = 0;
  const run = createSupplySync({ provider: { findByNumber: async () => ({ id: 'EXISTING1' }), createExpense: async () => creates++ }, repository: repo });
  const r = await run([item(5, 10)]);
  assert.equal(r.adopted, 1);
  assert.equal(creates, 0);
  assert.equal(repo.rows.get('spoolman:inst1:5').expenseId, 'EXISTING1');
});

test('non-USD is skipped and amounts are integer cents', () => {
  const p = planSupplySync({ items: [item(1, 16.99), item(2, 5, { currency: 'EUR' })], ledger: new Map() });
  assert.equal(p.create[0].amountCents, 1699);
  assert.equal(p.skipped.length, 1);
});

test('expense adapter sends the key, rejects redirects and mismatched responses', async () => {
  let seen;
  const ok = createInvoiceNinjaExpenses({ token: 't', fetchImpl: async (u, o) => (seen = o, { ok: true, json: async () => ({ data: { id: 'ABCD1', number: 'SPOOL-inst1-1' } }) }) });
  await ok.createExpense({ number: 'SPOOL-inst1-1', amountCents: 1699, key: 'spoolman:inst1:1', note: 'n' });
  assert.equal(seen.redirect, 'error');
  assert.equal(JSON.parse(seen.body).amount, 16.99);
  const bad = createInvoiceNinjaExpenses({ token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: 'ABCD1', number: 'other' } }) }) });
  await assert.rejects(bad.createExpense({ number: 'SPOOL-inst1-1', amountCents: 1, key: 'k', note: 'n' }));
});

import { createSpoolmanKeyWriter } from '../../lib/bookkeeping/spoolman-key-writer.js';
import { createInvoiceNinjaPayments } from '../../lib/bookkeeping/invoice-ninja-payments.js';

test('key writer defines the extra field once and patches only the extra', async () => {
  const calls = [];
  const fetchImpl = async (url, o) => (calls.push([o.method, new URL(url).pathname, o.body && JSON.parse(o.body)]), { ok: true, json: async () => [] });
  const w = createSpoolmanKeyWriter({ baseUrl: 'http://spoolman:8000', fetchImpl });
  await w.setExpenseId(7, 'EXPENSE1'); await w.setExpenseId(8, 'EXPENSE2');
  assert.deepEqual(calls.map(c => c[0] + ' ' + c[1]), ['GET /api/v1/field/spool', 'POST /api/v1/field/spool/invoice_ninja_expense', 'PATCH /api/v1/spool/7', 'PATCH /api/v1/spool/8']);
  assert.deepEqual(calls[2][2], { extra: { invoice_ninja_expense: '"EXPENSE1"' } });
  await assert.rejects(w.setExpenseId(0, 'EXPENSE1'));
});

test('a key-writer failure does not fail or undo the sync', async () => {
  const repo = createMemorySupplyRepository();
  const run = createSupplySync({ provider: { findByNumber: async () => null, createExpense: async () => ({ id: 'EXPENSE9' }) }, repository: repo, keyWriter: { setExpenseId: async () => { throw new Error('down'); } } });
  assert.equal((await run([item(9, 5)])).created, 1);
  assert.equal(repo.rows.get('spoolman:inst1:9').status, 'synced');
});

test('payment reader keeps only completed, undeleted, unrefunded payments for the client', async () => {
  const rows = [
    { id: 'PAY00001', client_id: 'CLIENT1', status_id: '4', date: '2026-10-02', amount: 2500, is_deleted: false },
    { id: 'PAY00002', client_id: 'CLIENT1', status_id: '1', date: '2026-10-16', amount: 2500 },
    { id: 'PAY00003', client_id: 'CLIENT1', status_id: '4', date: '2026-10-30', amount: 2500, refunded: 100 },
    { id: 'PAY00004', client_id: 'OTHER99', status_id: '4', date: '2026-10-30', amount: 2500 }
  ];
  const p = createInvoiceNinjaPayments({ token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({ data: rows }) }) });
  assert.deepEqual(await p.listCompleted('CLIENT1'), [{ id: 'PAY00001', date: '2026-10-02', amountCents: 250000 }]);
});

import { selectMatches } from '../../scripts/bookkeeping-seed.mjs';
test('seed selection filters by confidence and rejects double assignment', () => {
  const rows = [{ spool: 1, expense: 'EXP00001', confidence: 'price+name' }, { spool: 2, expense: 'EXP00002', confidence: 'name only' }, { spool: 3, expense: null, confidence: 'x' }];
  assert.deepEqual(selectMatches(rows, { confidence: ['price+name'] }).map(r => r.spool), [1]);
  assert.equal(selectMatches(rows).length, 2);
  assert.throws(() => selectMatches([...rows, { spool: 4, expense: 'EXP00001', confidence: 'name only' }]));
});
