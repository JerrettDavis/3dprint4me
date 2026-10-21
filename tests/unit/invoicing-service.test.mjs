import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalInvoiceRepository } from '../../lib/invoicing/local-repository.js';
import { createInvoicingService } from '../../lib/invoicing/service.js';
import { createInvoiceNinja } from '../../lib/invoicing/invoice-ninja.js';
import { billingFixture, ownerFixture, workFixture, invoiceFixture } from '../fixtures/billing.mjs';

async function context(provider) {
  const dir = await mkdtemp(join(tmpdir(), 'billing-service-'));
  const work = { getWork: async () => workFixture };
  const repository = createLocalInvoiceRepository({ path: join(dir, 'invoices.json'), getWork: work.getWork });
  return { service: createInvoicingService({ repository, workRepository: work, provider: { getClient: async () => ({ id: 'client123' }), ...provider }, makeId: () => 'operation123' }), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
const command = () => ({ workId: 'work_example123', revision: 1, idempotencyKey: 'click12345', billing: billingFixture() });

test('an inquiry cannot preview, create or inspect invoices through direct service calls',async()=>{
  const workRepository={getWork:async()=>({...workFixture,item:{...workFixture.item,kind:'inquiry'}})};
  const service=createInvoicingService({workRepository,repository:{get:()=>assert.fail('must not read billing')},provider:{getClient:()=>assert.fail('must not contact provider')}});
  for(const action of ['preview','create'])await assert.rejects(service[action](command(),ownerFixture),{status:409});
  await assert.rejects(service.get(command().workId,ownerFixture),{status:409});
});

test('real service and provider perform inherited client validation once before reservation', async () => {
  const calls = [];
  const provider = createInvoiceNinja({ token: 'private-token', groupId: 'group123', fetchImpl: async (url, init) => {
    calls.push(new URL(url).pathname);
    const data = url.includes('/clients/') ? { id: 'client123', group_settings_id: 'group123', settings: {} }
      : url.includes('/group_settings/') ? { id: 'group123', settings: {} }
      : url.endsWith('/companies/current') ? { settings: { currency_id: '1' } }
      : { id: 'invoice123', client_id: 'client123', number: '3DP-2026-operation123', status_id: '1', amount: 151.92, total_taxes: 11.92, balance: 151.92, paid_to_date: 0 };
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  } });
  const c = await context(provider);
  try {
    assert.equal((await c.service.create(command(), ownerFixture)).state, 'draft');
    assert.deepEqual(calls, ['/api/v1/clients/client123', '/api/v1/group_settings/group123', '/api/v1/companies/current', '/api/v1/invoices']);
  } finally { await c.cleanup(); }
});

test('concurrent owner clicks dispatch one draft and never send', async () => {
  let creates = 0;
  const c = await context({ createDraft: async () => { creates++; return invoiceFixture; } });
  try {
    const results = await Promise.all([c.service.create(command(), ownerFixture), c.service.create(command(), ownerFixture)]);
    assert.equal(creates, 1); assert.ok(results.some(r => r.state === 'draft'));
    assert.equal((await c.service.create(command(), ownerFixture)).state, 'draft'); assert.equal(creates, 1);
    await assert.rejects(c.service.create({ ...command(), billing: { ...billingFixture(), dueDate: '2026-12-01' } }, ownerFixture), { status: 409 });
  } finally { await c.cleanup(); }
});

test('accepts the existing authorization boundary owner shape after enabled approval', async () => {
  const c = await context({ createDraft: async () => invoiceFixture });
  try {
    const { enabled, ...authorizedOwner } = ownerFixture;
    assert.equal((await c.service.create(command(), authorizedOwner)).state, 'draft');
  } finally { await c.cleanup(); }
});

test('ambiguous creation persists recovery state; repeat clicks never POST again', async () => {
  let creates = 0, reads = 0;
  const c = await context({ createDraft: async () => { creates++; throw new Error('private provider error'); }, findByNumber: async () => { reads++; return [invoiceFixture]; } });
  try {
    assert.equal((await c.service.create(command(), ownerFixture)).state, 'needs_reconciliation');
    assert.equal((await c.service.create(command(), ownerFixture)).state, 'needs_reconciliation');
    assert.equal(creates, 1);
    assert.equal((await c.service.reconcile('work_example123', ownerFixture)).state, 'draft'); assert.equal(reads, 1);
  } finally { await c.cleanup(); }
});

test('client preflight failure creates no dispatched operation and is safe to correct', async () => {
  const c = await context({ getClient: async () => { throw new Error('client not ready'); }, createDraft: async () => { throw new Error('must not create'); } });
  try {
    await assert.rejects(c.service.create(command(), ownerFixture));
    assert.equal(await c.service.get('work_example123', ownerFixture), null);
  } finally { await c.cleanup(); }
});

test('owner-only access, stale revision and unknown send instructions never reach provider', async () => {
  let calls = 0; const c = await context({ createDraft: async () => { calls++; return invoiceFixture; } });
  try {
    for (const operator of [null, { ...ownerFixture, role: 'operator' }, { ...ownerFixture, enabled: false }]) await assert.rejects(c.service.create(command(), operator), { status: 403 });
    await assert.rejects(c.service.create({ ...command(), revision: 2 }, ownerFixture), { status: 409 });
    await assert.rejects(c.service.create({ ...command(), send: true }, ownerFixture), { status: 400 });
    assert.equal(calls, 0);
  } finally { await c.cleanup(); }
});

test('provider mismatch remains review-required and refresh never writes to provider', async () => {
  const mismatched = { ...invoiceFixture, totalCents: 16000 };
  const c = await context({ createDraft: async () => { throw Object.assign(new Error('mismatch'), { code: 'invoice_review_required', invoice: mismatched }); }, getInvoice: async () => ({ ...invoiceFixture, status: 'paid', balanceCents: 0, paidCents: 15192 }) });
  try {
    assert.equal((await c.service.create(command(), ownerFixture)).state, 'needs_review');
    const refreshed = await c.service.refresh('work_example123', ownerFixture);
    assert.equal(refreshed.provider.status, 'paid'); assert.equal(refreshed.provider.balanceCents, 0);
  } finally { await c.cleanup(); }
});
