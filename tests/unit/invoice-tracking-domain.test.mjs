import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTrackedInvoice, presentInvoiceTracking, invoiceTrackingEvents } from '../../lib/invoicing/tracking-domain.js';

const raw = changes => ({ id: 'Invoice123', client_id: 'Client1234', number: '3DP-2026-0011', status_id: '2',
  currency: 'USD', amount: 54.26, total_taxes: 4.26, paid_to_date: 0, balance: 54.26,
  due_date: '2026-11-23', partial_due_date: '', is_deleted: false, archived_at: 0,
  invitations: [], ...changes });
const project = (rows, now = '2026-11-24T18:00:00Z', timeZone = 'America/Chicago') =>
  presentInvoiceTracking(rows.map(normalizeTrackedInvoice), { now: new Date(now), timeZone });

test('a zero-balance draft remains a draft and never counts as paid or overdue', () => {
  const result = project([raw({ status_id: '1', balance: 0 })]);
  assert.equal(result.counts.draft, 1);
  assert.equal(result.counts.paid, 0);
  assert.equal(result.counts.overdue, 0);
  assert.equal(result.rows[0].status, 'draft');
});

test('sent and partial collectible balances become overdue after their applicable due day', () => {
  const result = project([raw(), raw({ id: 'Invoice456', status_id: 3, paid_to_date: 20, balance: 34.26,
    due_date: '2026-12-01', partial_due_date: '2026-11-23' })]);
  assert.equal(result.counts.overdue, 2);
  assert.equal(result.counts.outstanding, 2);
  assert.deepEqual(result.totals, [{ currency: 'USD', outstandingCents: 8852, overdueCents: 8852, paidCents: 2000 }]);
});

test('due today stays current until the next calendar day in the business timezone', () => {
  assert.equal(project([raw()], '2026-11-24T05:59:59Z').counts.overdue, 0);
  assert.equal(project([raw()], '2026-11-24T06:00:00Z').counts.overdue, 1);
  assert.equal(project([raw({ due_date: '2026-03-08' })], '2026-03-09T04:59:59Z').counts.overdue, 0);
  assert.equal(project([raw({ due_date: '2026-03-08' })], '2026-03-09T05:00:00Z').counts.overdue, 1);
});

test('paid, cancelled, reversed, deleted, archived and undated invoices are not overdue', () => {
  for (const change of [{ status_id: 4, balance: 0, paid_to_date: 54.26 }, { status_id: 5 }, { status_id: 6 },
    { is_deleted: true }, { archived_at: 1795528800 }, { due_date: '' }]) {
    assert.equal(project([raw(change)]).counts.overdue, 0, JSON.stringify(change));
  }
});

test('totals do not combine currencies or count draft amounts as collected', () => {
  const result = project([raw({ status_id: 4, paid_to_date: 54.26, balance: 0 }),
    raw({ id: 'EuroInvoice', currency: 'EUR', amount: 10, total_taxes: 0, balance: 10 }),
    raw({ id: 'DraftInvoice', status_id: 1, amount: 151.92, paid_to_date: 0, balance: 0 })]);
  assert.deepEqual(result.totals, [
    { currency: 'EUR', outstandingCents: 1000, overdueCents: 1000, paidCents: 0 },
    { currency: 'USD', outstandingCents: 0, overdueCents: 0, paidCents: 5426 }
  ]);
  assert.equal(result.counts.paid, 1);
});

test('normalization excludes client contacts, notes, lines and invitation capability URLs', () => {
  const invoice = normalizeTrackedInvoice(raw({ client: { email: 'private@example.com' }, public_notes: 'private notes',
    line_items: [{ notes: 'private line' }], invitations: [{ id: 'Invite1234', email: 'private@example.com',
      link: 'https://billing.3dprint4.me/private-capability', viewed_date: '2026-11-12T18:00:00Z', opened_date: '2026-11-12T17:00:00Z' }] }));
  assert.equal(invoice.viewedAt, '2026-11-12T18:00:00.000Z');
  assert.equal(invoice.openedAt, '2026-11-12T17:00:00.000Z');
  assert.equal(invoice.totalCents, 5426);
  assert.doesNotMatch(JSON.stringify(invoice), /private|email|line_items|public_notes|Invite1234/);
});

test('invalid provider IDs, precision, states, dates and currencies fail closed', () => {
  for (const change of [{ id: '../secret' }, { amount: 54.261 }, { balance: -1 }, { amount: Infinity },
    { status_id: 999 }, { status_id: 'constructor' }, { currency: '' }, { due_date: '2026-02-30' }, { is_deleted: 'false' },
    { invitations: [{ viewed_date: 'yesterday' }] }, { invitations: [{ viewed_date: '2026-11-12T24:00:00Z' }] }]) {
    assert.throws(() => normalizeTrackedInvoice(raw(change)), TypeError, JSON.stringify(change));
  }
  assert.throws(() => project([raw()], '2026-11-24T18:00:00Z', 'invalid/timezone'), RangeError);
});

test('first provider-reported opens and views create separate stable events without guessing payments', () => {
  const previous = normalizeTrackedInvoice(raw());
  const current = normalizeTrackedInvoice(raw({ status_id: 4, paid_to_date: 54.26, balance: 0,
    invitations: [{ viewed_date: '2026-11-12T18:00:00Z', opened_date: '2026-11-12T17:00:00Z' }] }));
  const events = invoiceTrackingEvents(previous, current);
  assert.deepEqual(events.map(e => e.kind), ['invoice_opened', 'invoice_viewed']);
  assert.equal(new Set(events.map(e => e.id)).size, 2);
  assert.deepEqual(invoiceTrackingEvents(current, current), []);
  assert.deepEqual(invoiceTrackingEvents(null, current), [], 'historical import establishes a silent baseline');
  assert.ok(events.every(e => e.invoiceId === 'Invoice123'));
});
