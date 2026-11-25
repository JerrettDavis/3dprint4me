import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantBillingDelivery, drainBillingEvents } from '../../lib/invoicing/home-assistant-delivery.js';
const id = 'a'.repeat(64), token = 'private-outbound-credential';
const event = { id, payload: { kind: 'invoice_viewed', invoiceId: 'Invoice123', occurredAt: '2026-11-24T18:00:00Z', privateField: 'must not send' }, attempts: 1 };
test('delivery pins HTTPS service URL and sends minimized stable persistent notifications', async () => {
  const requests = [];
  const delivery = createHomeAssistantBillingDelivery({ origin: 'https://ha.example.test', token, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return new Response('[]', { status: 200 });
  } });
  await delivery.send(event); await delivery.send(event);
  assert.equal(requests[0].url, 'https://ha.example.test/api/services/persistent_notification/create');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(requests[0].options.redirect, 'error');
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.notification_id, `3dprint4me_billing_${id}`);
  assert.deepEqual(body, JSON.parse(requests[1].options.body));
  assert.ok(!JSON.stringify(body).includes('must not send'));
  for (const origin of ['http://ha.example.test', 'https://user:pass@ha.example.test', 'https://ha.example.test/path', 'https://ha.example.test/?key=secret']) {
    assert.throws(() => createHomeAssistantBillingDelivery({ origin, token }), TypeError);
  }
});
test('failed delivery remains retryable and only a successful remote call is acknowledged', async () => {
  const finishes = [];
  const repository = { claimEvents: async () => [event], finishEvent: async input => { finishes.push(input); return true; } };
  await drainBillingEvents({ repository, delivery: { configured: true, send: async () => { throw Error(token); } }, now: () => new Date('2026-11-24T18:00:00Z') });
  assert.equal(finishes[0].delivered, false);
  assert.ok(finishes[0].retryAt > finishes[0].now);
  await drainBillingEvents({ repository, delivery: { configured: true, send: async () => {} }, now: () => new Date('2026-11-24T18:01:00Z') });
  assert.equal(finishes[1].delivered, true);
  assert.ok(!JSON.stringify(finishes).includes(token));
});
test('unconfigured delivery does not claim events and provider errors are sanitized', async () => {
  const delivery = createHomeAssistantBillingDelivery({});
  assert.equal(delivery.configured, false);
  await drainBillingEvents({ repository: { claimEvents: () => assert.fail('unconfigured claimed events') }, delivery });
  const failed = createHomeAssistantBillingDelivery({ origin: 'https://ha.example.test', token, fetchImpl: async () => { throw Error(token); } });
  await assert.rejects(failed.send(event), error => !error.message.includes(token));
});
