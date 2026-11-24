import assert from 'node:assert/strict';
import test from 'node:test';
import { createInvoiceTrackingProvider } from '../../lib/invoicing/tracking-provider.js';
import { normalizePaymentAllocation, paymentTrackingEvents } from '../../lib/invoicing/tracking-domain.js';

const HOST = 'https://invoicing.co/api/v1/';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const list = (data, page = 1, pages = 1) => json({ data, meta: { pagination: { current_page: page, total_pages: pages, per_page: 100 } } });
const invoice = (change = {}) => ({ id: 'Invoice123', client_id: 'Client1234', number: '3DP-TEST-001', status_id: '4',
  amount: 54.26, total_taxes: 4.26, paid_to_date: 54.26, balance: 0, due_date: '2026-12-12', partial_due_date: '',
  is_deleted: false, archived_at: 0, invitations: [{ viewed_date: '2026-11-12 18:00:00', opened_date: '2026-11-12 17:00:00' }], ...change });
const payment = (change = {}) => ({ id: 'Payment123', client_id: 'Client1234', amount: 54.26, refunded: 0, currency_id: '1',
  status_id: '4', date: '2026-11-20', updated_at: 1795197600, is_deleted: false, archived_at: 0,
  paymentables: [{ id: 'Allocation1', invoice_id: 'Invoice123', payment_id: 'Payment123', amount: 54.26, refunded: 0, updated_at: 1795197600 }], ...change });

function provider(fetchImpl, options = {}) {
  return createInvoiceTrackingProvider({ token: 'secret-sentinel', groupId: 'Group1234', fetchImpl, ...options });
}
function fixture(overrides = {}) {
  return async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/api/v1/', '');
    assert.equal(parsed.origin, 'https://invoicing.co');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-API-TOKEN'], 'secret-sentinel');
    assert.equal(options.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(options.headers.Accept, 'application/json');
    if (overrides[path]) return overrides[path](parsed, options);
    if (path === 'statics') { assert.equal(options.method, 'GET'); return json({ currencies: [{ id: '1', code: 'USD' }, { id: '3', code: 'EUR' }] }); }
    if (path === 'companies/current') { assert.equal(options.method, 'POST'); return json({ data: { id: 'Company123', settings: { currency_id: '1' } } }); }
    if (path === 'group_settings/Group1234') return json({ data: { id: 'Group1234', settings: { currency_id: '1' } } });
    if (path === 'clients') {
      assert.equal(parsed.searchParams.get('group_settings_id'), 'Group1234');
      return list([{ id: 'Client1234', group_settings_id: 'Group1234', settings: {} },
        { id: 'OtherClient', group_settings_id: 'OtherGroup', settings: { currency_id: '1' } }]);
    }
    assert.equal(parsed.searchParams.get('client_id'), 'Client1234');
    assert.equal(parsed.searchParams.get('status'), 'active,archived,deleted');
    assert.equal(parsed.searchParams.get('per_page'), '100');
    assert.equal(options.method, 'GET');
    if (path === 'invoices') return list([invoice()]);
    if (path === 'payments') return list([payment()]);
    throw new Error('Unexpected provider request');
  };
}

test('scoped provider reads normalize manual invoices, activity and allocation evidence without retaining private fields', async () => {
  const result = await provider(fixture()).readSnapshot();
  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].currency, 'USD');
  assert.equal(result.invoices[0].openedAt, '2026-11-12T17:00:00.000Z');
  assert.equal(result.allocations[0].amountCents, 5426);
  assert.deepEqual(result.source, { companyId: 'Company123', groupId: 'Group1234' });
  assert.doesNotMatch(JSON.stringify(result), /secret-sentinel|transaction_reference|invitations|contacts|settings/);
});

test('all invoice pages are read using locally constructed URLs, ignoring external pagination links', async () => {
  const seen = [];
  const result = await provider(fixture({ invoices: (url) => {
    const page = Number(url.searchParams.get('page')); seen.push(page);
    const response = { data: [invoice({ id: page === 1 ? 'Invoice123' : 'Invoice456' })],
      meta: { pagination: { current_page: page, total_pages: 2 } }, links: { next: 'https://attacker.invalid/secret' } };
    return json(response);
  } })).readSnapshot();
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.invoices.length, 2);
});

test('incomplete, duplicated, mismatched-client or malformed collection reads fail the whole snapshot', async () => {
  for (const overrides of [
    { invoices: () => list([invoice()], 1, 2) },
    { invoices: () => list([invoice(), invoice()]) },
    { invoices: () => list([invoice({ client_id: 'OtherClient' })]) },
    { invoices: () => json({ data: [invoice()] }) },
    { payments: () => list([payment({ paymentables: [{ id: 'Allocation1', invoice_id: 'Invoice123', payment_id: 'WrongPayment', amount: 54.26, refunded: 0, updated_at: 1795197600 }] })]) }
  ]) {
    await assert.rejects(provider(fixture(overrides), { maxPages: 1 }).readSnapshot(), /Invoice tracking is temporarily unavailable/);
  }
});

test('client, group and company currency inheritance resolves through official statics', async () => {
  const result = await provider(fixture({
    'group_settings/Group1234': () => json({ data: { id: 'Group1234', settings: {} } }),
    'companies/current': (_url, options) => { assert.equal(options.method, 'POST'); assert.equal(options.body, '{}'); return json({ data: { id: 'Company123', settings: { currency_id: '3' } } }); },
    payments: () => list([payment({ currency_id: '3' })])
  })).readSnapshot();
  assert.equal(result.invoices[0].currency, 'EUR');
  assert.equal(result.allocations[0].currency, 'EUR');
});

test('provider errors, redirects, oversized bodies and unresolved currencies expose no raw details', async () => {
  for (const operation of [
    () => { throw new Error('secret-sentinel raw stack'); },
    () => new Response('secret-sentinel', { status: 302, headers: { Location: 'https://attacker.invalid' } }),
    () => new Response('secret-sentinel', { status: 500 }),
    () => json({ currencies: [] }),
    () => json({ huge: 'x'.repeat(10000) })
  ]) {
    await assert.rejects(provider(operation, { maxBytes: 1000 }).readSnapshot(), error =>
      error.message === 'Invoice tracking is temporarily unavailable.' && !JSON.stringify(error).includes('secret-sentinel'));
  }
});

test('timeout also bounds a fetch that ignores AbortSignal and unconfigured mode sends nothing', async () => {
  await assert.rejects(provider(() => new Promise(() => {}), { timeoutMs: 10 }).readSnapshot(), /temporarily unavailable/);
  let calls = 0;
  await assert.rejects(createInvoiceTrackingProvider({ token: '', groupId: 'Group1234', fetchImpl: () => calls++ }).readSnapshot(), /not configured/);
  assert.equal(calls, 0);
});

test('allocation changes distinguish new payments and refunds from invoice corrections', () => {
  const first = normalizePaymentAllocation({ id: 'Allocation1', invoiceId: 'Invoice123', paymentId: 'Payment123', currency: 'USD',
    amount: 54.26, refunded: 0, updatedAt: 1795197600, date: '2026-11-20', status: 'completed', deleted: false });
  const refunded = normalizePaymentAllocation({ id: 'Allocation1', invoiceId: 'Invoice123', paymentId: 'Payment123', currency: 'USD',
    amount: 54.26, refunded: 10, updatedAt: 1795284000, date: '2026-11-20', status: 'completed', deleted: false });
  assert.equal(paymentTrackingEvents(null, first, { baseline: false })[0].kind, 'invoice_payment');
  assert.deepEqual(paymentTrackingEvents(null, first, { baseline: true }), []);
  assert.deepEqual(paymentTrackingEvents(first, first), []);
  assert.equal(paymentTrackingEvents(first, refunded)[0].kind, 'invoice_refund');
  assert.equal(paymentTrackingEvents(first, refunded)[0].amountCents, 1000);
  assert.throws(() => normalizePaymentAllocation({}), TypeError);
});

test('a later repeated refund after reversal is a new event while rereading the same revision is silent', () => {
  const allocation = (refunded, updatedAt) => normalizePaymentAllocation({ id: 'Allocation1', invoiceId: 'Invoice123',
    paymentId: 'Payment123', currency: 'USD', amount: 54.26, refunded, updatedAt, date: '2026-11-20', status: 'completed', deleted: false });
  const paid = allocation(0, 1795197600), refund = allocation(10, 1795284000),
    reversal = allocation(0, 1795370400), secondRefund = allocation(10, 1795456800);
  const firstEvent = paymentTrackingEvents(paid, refund)[0];
  const secondEvent = paymentTrackingEvents(reversal, secondRefund)[0];
  assert.notEqual(firstEvent.id, secondEvent.id);
  assert.equal(paymentTrackingEvents(refund, reversal)[0].kind, 'invoice_payment_adjusted');
  assert.deepEqual(paymentTrackingEvents(secondRefund, secondRefund), []);
});

test('pending and failed payments never emit received-money events', () => {
  for (const status of ['pending', 'failed', 'cancelled']) {
    const allocation = normalizePaymentAllocation({ id: 'Allocation1', invoiceId: 'Invoice123', paymentId: 'Payment123',
      currency: 'USD', amount: 54.26, refunded: 0, updatedAt: 1795197600, date: '2026-11-20', status, deleted: false });
    assert.deepEqual(paymentTrackingEvents(null, allocation), []);
  }
});
