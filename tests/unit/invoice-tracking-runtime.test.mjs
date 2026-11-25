import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceTrackingTasks } from '../../lib/invoicing/tracking-runtime.js';
test('tracking activation is independent of the existing draft-creation switch', async () => {
  let calls = 0;
  const runtime = { service: { sync: async () => { calls++; return { status: 'synced' }; } } };
  await createInvoiceTrackingTasks({ runtime, env: { INVOICE_NINJA_ENABLED: '1' } }).reconcile();
  assert.equal(calls, 0);
  await createInvoiceTrackingTasks({ runtime, env: { INVOICE_NINJA_ENABLED: '0', INVOICE_TRACKING_ENABLED: '1' } }).reconcile();
  assert.equal(calls, 1);
});
