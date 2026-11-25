import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceTrackingService } from '../../lib/invoicing/tracking-service.js';
const raw = { revision: 1, snapshot: null, lastSuccessfulAt: null, errorCategory: null,
  settings: { timeZone: 'America/Chicago', notificationsEnabled: false, workBilling: [], taxPeriods: [], taxSchedule: null } };
test('service owner reads and machine reads share freshness but exclude private settings from machine', async () => {
  const service = createInvoiceTrackingService({ repository: { readTracking: async () => raw, linkedWorks: async () => [], listEvents: async () => [] }, now: () => new Date('2026-11-24T18:00:00Z') });
  await assert.rejects(service.read({ id: 'other', role: 'operator' }), { status: 403 });
  const owner = await service.read({ id: 'owner', role: 'owner' });
  const machine = await service.machineSnapshot();
  assert.equal(owner.sync.status, 'never_synced');
  assert.ok(owner.settings);
  assert.equal(machine.settings, undefined);
  assert.equal(machine.revision, undefined);
  assert.deepEqual(machine.counts, owner.counts);
});
