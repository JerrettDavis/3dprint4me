import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceNinja } from '../../lib/invoicing/invoice-ninja.js';

const billing = () => ({
  clientId: 'client123', date: '2026-10-20', dueDate: '2026-11-19',
  receiptAddress: { street: '123 Example St', city: 'Tulsa', region: 'OK', postalCode: '74110', country: 'US' },
  taxEvidence: { jurisdiction: 'Tulsa', verifiedOn: '2026-10-20', reference: 'City schedule' },
  priorPayment: { state: 'none', reference: '' },
  lines: [{ item: 'Sign', description: 'With base', quantityMilli: 1000, unitCents: 14000, taxRateMilli: 8517, taxReason: 'Taxable goods' }]
});
const remote = (extra = {}) => ({ id: 'invoice123', client_id: 'client123', number: '3DP-2026-operation123', status_id: '1', amount: 151.92, balance: 151.92, total_taxes: 11.92, paid_to_date: 0, is_deleted: false, ...extra });
const client = (extra = {}) => ({ id: 'client123', name: 'Example business', group_settings_id: 'group123', is_deleted: false, settings: { currency_id: '1' }, ...extra });
const json = value => new Response(JSON.stringify({ data: value }), { headers: { 'content-type': 'application/json' } });
function setup(responder) {
  const calls = [];
  const api = createInvoiceNinja({ token: 'private-token', groupId: 'group123', fetchImpl: async (url, init) => { calls.push({ url: String(url), ...init }); return responder(String(url), init); } });
  return { api, calls };
}

test('only the fixed hosted API creates drafts; no send, paid or mark-sent actions exist', async () => {
  const { api, calls } = setup((url, init) => init.method === 'GET' ? json(client()) : json(remote()));
  const result = await api.createDraft({ billing: billing(), operationId: 'operation123' });
  assert.equal(result.totalCents, 15192); assert.equal(result.status, 'draft');
  assert.equal(result.editorUrl, 'https://app.invoicing.co/#/invoices/invoice123/edit');
  assert.deepEqual(Object.keys(api).sort(), ['createDraft', 'findByNumber', 'getClient', 'getInvoice']);
  assert.equal(calls[0].url, 'https://invoicing.co/api/v1/clients/client123');
  const post = calls[1]; assert.equal(post.url, 'https://invoicing.co/api/v1/invoices');
  assert.equal(post.method, 'POST'); assert.equal(post.redirect, 'error');
  assert.equal(post.headers['X-API-TOKEN'], 'private-token'); assert.equal(post.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(post.headers['Content-Type'], 'application/json');
  const body = JSON.parse(post.body);
  assert.equal(body.auto_bill_enabled, false); assert.equal(body.status_id, '1');
  assert.equal(body.number, '3DP-2026-operation123'); assert.equal(body.idempotency_key, 'operation123');
  assert.equal(body.tax_rate1, 0); assert.equal(body.line_items[0].tax_rate1, 8.517);
  assert.equal(body.line_items[0].cost, 140); assert.equal(body.line_items[0].quantity, 1);
  assert.equal(body.uses_inclusive_taxes, false);
  assert.match(body.public_notes, /Receipt location: 123 Example St, Tulsa, OK 74110, US/);
  for (const key of ['send_email', 'mark_sent', 'paid', 'amount_paid', 'invitations', 'documents']) assert.equal(key in body, false);
  assert.equal(JSON.stringify(body).includes('City schedule'), false);
});

test('wrong group, currency, deleted client and invalid IDs fail before POST', async () => {
  for (const bad of [client({ group_settings_id: 'other123' }), client({ settings: { currency_id: '2' } }), client({ is_deleted: true }), client({ id: 'another123' })]) {
    const { api, calls } = setup(() => json(bad));
    await assert.rejects(api.createDraft({ billing: billing(), operationId: 'operation123' }));
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  }
  const { api, calls } = setup(() => json(client()));
  await assert.rejects(api.getInvoice('../../tokens')); assert.equal(calls.length, 0);
});

test('currency resolves client then group then the token current company', async () => {
  for (const inherited of ['group-usd', 'company-usd', 'company-other']) {
    const { api, calls } = setup(url => {
      if (url.endsWith('/clients/client123')) return json(client({ settings: {} }));
      if (url.endsWith('/group_settings/group123')) return json({ id: 'group123', settings: inherited === 'group-usd' ? { currency_id: '1' } : {} });
      if (url.endsWith('/companies/current')) return json({ id: 'company123', settings: { currency_id: inherited === 'company-other' ? '2' : '1' } });
      throw new Error('unexpected request');
    });
    if (inherited === 'company-other') await assert.rejects(api.getClient('client123'), { code: 'invoice_client_invalid' });
    else assert.equal((await api.getClient('client123')).currency, 'USD');
    assert.equal(calls.length, inherited === 'group-usd' ? 2 : 3);
    if (calls.length === 3) { assert.equal(calls[2].method, 'POST'); assert.equal(calls[2].url, 'https://invoicing.co/api/v1/companies/current'); assert.equal(calls[2].body, '{}'); }
    assert.equal(calls.some(c => c.url.endsWith('/invoices')), false);
  }
});

test('post-create mismatches preserve remote identity for reconciliation', async () => {
  for (const changed of [{ amount: 160 }, { status_id: '2' }, { client_id: 'other123' }, { total_taxes: 12 }]) {
    const { api } = setup((url, init) => init.method === 'GET' ? json(client()) : json(remote(changed)));
    await assert.rejects(api.createDraft({ billing: billing(), operationId: 'operation123' }), error => {
      assert.equal(error.code, 'invoice_review_required'); assert.equal(error.invoice.id, 'invoice123'); return true;
    });
  }
});

test('provider failures and response bodies never expose raw data or credentials', async () => {
  for (const response of [new Response('private-token provider traceback', { status: 500 }), new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } }), json({ ...remote(), id: '../../admin' })]) {
    const { api } = setup(() => response);
    await assert.rejects(api.getInvoice('invoice123'), error => { assert.doesNotMatch(String(error), /private-token|traceback|secret|html/); return true; });
  }
});

test('timeout covers an unresponsive fetch and never retries a create', async () => {
  let posts = 0;
  const api = createInvoiceNinja({ token: 'private-token', groupId: 'group123', timeoutMs: 20, fetchImpl: async (url, init) => {
    if (init.method === 'GET') return json(client()); posts++; return new Promise(() => {});
  } });
  await assert.rejects(api.createDraft({ billing: billing(), operationId: 'operation123' }), { code: 'invoice_provider_unavailable' });
  assert.equal(posts, 1);
});

test('oversized bodies are cancelled and exact reconciliation excludes fuzzy matches', async () => {
  const { api, calls } = setup(() => json([remote({ number: '3DP-2026-operation123-extra' }), remote()]));
  const result = await api.findByNumber('3DP-2026-operation123');
  assert.equal(result.length, 1); assert.equal(result[0].id, 'invoice123');
  assert.equal(calls[0].url, 'https://invoicing.co/api/v1/invoices?number=3DP-2026-operation123&per_page=100&status=active%2Carchived%2Cdeleted');
  const huge = setup(() => json({ content: 'x'.repeat(600000) }));
  await assert.rejects(huge.api.getInvoice('invoice123'), { code: 'invoice_provider_unavailable' });
});

test('unconfigured credentials never make a request', async () => {
  let calls = 0;
  const api = createInvoiceNinja({ token: '', groupId: '', fetchImpl: () => { calls++; } });
  await assert.rejects(api.getInvoice('invoice123'), { code: 'invoicing_unconfigured' }); assert.equal(calls, 0);
});

test('only the same adapter can reuse its opaque client validation before draft creation', async () => {
  const responder = (url, init) => init.method === 'GET' ? json(client()) : json(remote());
  const { api, calls } = setup(responder);
  const validatedClient = await api.getClient('client123');
  await api.createDraft({ billing: billing(), operationId: 'operation123', validatedClient });
  assert.equal(calls.filter(call => call.method === 'GET').length, 1);
  for (const proof of [{ ...validatedClient }, (await setup(responder).api.getClient('client123'))]) {
    const guarded = setup(() => json(client({ group_settings_id: 'other123' })));
    await assert.rejects(guarded.api.createDraft({ billing: billing(), operationId: 'operation123', validatedClient: proof }), { code: 'invoice_client_invalid' });
    assert.equal(guarded.calls.some(call => call.method === 'POST'), false);
  }
  const other = setup(url => json(client({ id: url.endsWith('/other123') ? 'other123' : 'client123', group_settings_id: url.endsWith('/other123') ? 'group123' : 'other123' })));
  const otherClientProof = await other.api.getClient('other123');
  await assert.rejects(other.api.createDraft({ billing: billing(), operationId: 'operation123', validatedClient: otherClientProof }), { code: 'invoice_client_invalid' });
  assert.equal(other.calls.some(call => call.method === 'POST'), false);
});

test('the whole provider budget stops cumulative slow lookups before any invoice POST', async () => {
  let posts = 0;
  const api = createInvoiceNinja({ token: 'private-token', groupId: 'group123', timeoutMs: 100, budgetMs: 25, fetchImpl: async (url, init) => {
    if (init.method === 'POST') posts++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return url.includes('/clients/') ? json(client({ settings: {} })) : json({ id: 'group123', settings: { currency_id: '1' } });
  } });
  await assert.rejects(api.createDraft({ billing: billing(), operationId: 'operation123' }), { code: 'invoice_provider_unavailable' });
  assert.equal(posts, 0);
});

test('an expired provider budget cannot dispatch even with valid client preflight', async () => {
  let posts = 0;
  const api = createInvoiceNinja({ token: 'private-token', groupId: 'group123', budgetMs: 25, fetchImpl: async (url, init) => {
    if (init.method === 'POST') posts++;
    return json(client());
  } });
  const validatedClient = await api.getClient('client123');
  await new Promise(resolve => setTimeout(resolve, 35));
  await assert.rejects(api.createDraft({ billing: billing(), operationId: 'operation123', validatedClient }), { code: 'invoice_provider_unavailable' });
  assert.equal(posts, 0);
});
