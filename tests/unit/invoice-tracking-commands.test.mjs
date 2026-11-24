import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceTrackingCommands, presentBillingTracking } from '../../lib/invoicing/tracking-commands.js';

const owner = { id: 'owner-one', role: 'owner' };
const now = () => new Date('2026-11-24T18:00:00Z');
const settings = { timeZone: 'America/Chicago', notificationsEnabled: false, taxSchedule: null, taxPeriods: [], workBilling: [] };
const command = overrides => ({ action: 'settings', commandId: 'settings-command', revision: 1,
  settings: { timeZone: 'America/Chicago', notificationsEnabled: true, taxSchedule: null }, ...overrides });

test('non-owners and malformed actions fail before any repository mutation', async () => {
  let writes = 0;
  const app = createInvoiceTrackingCommands({ repository: { command: async () => writes++ }, now });
  for (const actor of [null, { id: 'operator-one', role: 'operator' }, { ...owner, enabled: false }]) {
    await assert.rejects(app.execute(command(), actor), e => e.status === 403);
  }
  await assert.rejects(app.execute(command({ settings: { ...command().settings, apiToken: 'secret' } }), owner), e => e.status === 400);
  await assert.rejects(app.execute(command({ action: 'mark-paid' }), owner), e => e.status === 400);
  assert.equal(writes, 0);
});

test('settings commands normalize a confirmed schedule and preserve existing filing acknowledgements', async () => {
  let saved;
  const existing = { ...settings, taxPeriods: [{ id: 'ok-sales-2026-10', startsOn: '2026-10-01', endsOn: '2026-10-31', dueDate: '2026-11-20',
    submitted: { date: '2026-11-20', reference: 'existing filed record' }, paid: null }] };
  const app = createInvoiceTrackingCommands({ repository: { command: async c => {
    saved = c; return { revision: 2, settings: c.mutate(structuredClone(existing)) };
  } }, now });
  const result = await app.execute(command({ settings: { ...command().settings, taxSchedule: { confirmed: true, frequency: 'monthly',
    effectiveFrom: '2026-10-01', dueDay: 20, nextBusinessDay: true, holidayDates: [], timeZone: 'America/Chicago', reference: 'Owner verified account instructions' } } }), owner);
  assert.equal(result.settings.taxSchedule.confirmedBy, 'owner-one');
  assert.equal(result.settings.taxPeriods.length, 2);
  assert.equal(result.settings.taxPeriods[0].submitted.reference, 'existing filed record');
  assert.equal(result.settings.notificationsEnabled, true);
  assert.equal(saved.actorId, 'owner-one');
  assert.match(saved.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /apiToken/);
});

test('billing dispositions require a confirmed project revision and validate linked invoice identity', async () => {
  let kind = 'inquiry', state = 'needs_invoice'; let saved;
  const app = createInvoiceTrackingCommands({ repository: { readTracking: async () => ({ snapshot: { invoices: [{ id: 'Invoice123' }] } }),
    linkedWorks: async () => [], command: async c => { saved = c; return { revision: 2, settings: c.mutate(structuredClone(settings)) }; } },
    workRepository: { getWork: async () => ({ item: { id: 'work_project123', kind, revision: 5 } }) }, now });
  const input = () => ({ action: 'work-disposition', commandId: 'work-command', revision: 1, workId: 'work_project123', workRevision: 5, state });
  await assert.rejects(app.execute(input(), owner), e => e.status === 409);
  kind = 'project';
  const result = await app.execute(input(), owner);
  assert.equal(result.settings.workBilling[0].state, 'needs_invoice');
  assert.deepEqual(saved.work, { id: 'work_project123', revision: 5 });
  state = 'linked';
  await assert.rejects(app.execute({ ...input(), invoiceId: 'Unknown123' }, owner), e => e.status === 400);
  assert.equal((await app.execute({ ...input(), invoiceId: 'Invoice123' }, owner)).settings.workBilling[0].invoiceId, 'Invoice123');
});

test('freshness is explicit and the Home Assistant projection excludes private provider client IDs', () => {
  const raw = { revision: 1, settings, lastSuccessfulAt: '2026-11-24T17:00:00Z', errorCategory: null,
    snapshot: { source: { companyId: 'Company123', groupId: 'Group1234' }, invoices: [{ id: 'Invoice123', clientId: 'PRIVATE CLIENT',
      number: '3DP-TEST-001', status: 'paid', currency: 'USD', totalCents: 5426, paidCents: 5426, balanceCents: 0,
      taxCents: 426, dueDate: '2026-12-12', partialDueDate: null, deleted: false, archived: false, viewedAt: null, openedAt: null }], allocations: [] } };
  const result = presentBillingTracking(raw, { now: now(), machine: true, linkedWorks: [] });
  assert.equal(result.sync.status, 'stale');
  assert.equal(result.counts.paid, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE CLIENT|Company123|Group1234|taxSchedule|settings/);
  assert.equal(result.items[0].number, '3DP-TEST-001');
  assert.equal(presentBillingTracking({ ...raw, errorCategory: 'provider_unavailable' }, { now: now() }).sync.status, 'unavailable');
});

test('an existing linked draft suppresses a conflicting needs-invoicing marker', () => {
  const result = presentBillingTracking({ revision: 1, settings: { ...settings, workBilling: [{ workId: 'work_project123', state: 'needs_invoice' }] },
    snapshot: null, lastSuccessfulAt: null, errorCategory: null }, { now: now(), linkedWorks: [{ workId: 'work_project123', invoiceId: 'Invoice123' }] });
  assert.equal(result.counts.needsInvoicing, 0);
  assert.equal(result.sync.status, 'never_synced');
});

test('filing acknowledgement commands persist only the chosen action and require explicit correction', async () => {
  let lastAudit;
  let current = { ...settings, taxPeriods: [{ id: 'ok-sales-2026-10', startsOn: '2026-10-01', endsOn: '2026-10-31', dueDate: '2026-11-20', submitted: null, paid: null }] };
  const app = createInvoiceTrackingCommands({ repository: { command: async c => {
    lastAudit = c.audit;
    current = c.mutate(structuredClone(current)); return { revision: 2, settings: current };
  } }, now });
  const input = { action: 'tax-acknowledge', commandId: 'tax-command', revision: 1, periodId: 'ok-sales-2026-10',
    kind: 'submitted', date: '2026-11-20', reference: 'OKTAP receipt confirmed' };
  const result = await app.execute(input, owner);
  assert.equal(result.settings.taxPeriods[0].submitted.date, '2026-11-20');
  assert.equal(result.settings.taxPeriods[0].paid, null);
  await assert.rejects(app.execute({ ...input, commandId: 'second-tax-command' }, owner), e => e.status === 409);
  await app.execute({ action: 'tax-correct', commandId: 'correction-command', revision: 1,
    periodId: 'ok-sales-2026-10', kind: 'submitted', reference: 'Correcting mistaken acknowledgement' }, owner);
  assert.equal(current.taxPeriods[0].submitted, null);
  assert.equal(lastAudit.action, 'tax-correct');
  assert.equal(lastAudit.details.reference, 'Correcting mistaken acknowledgement');
});
