import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubstitutionEmailDelivery, substitutionMessage } from '../../lib/filament-matching/adapters/substitution-email.js';
test('email provider URL, headers, safe payload, idempotency and failure behavior', async () => {
  const env = { RESEND_API_KEY: 'private-test', REQUEST_FROM_EMAIL: 'hello@example.com', REQUEST_TO_EMAIL: 'owner@example.com' };
  const message = substitutionMessage({ requestId: '3DP-TEST', recipient: 'customer@example.com', proposal: { id: 'sub_test', requested: { material: 'pla', color: '<blue>', colorHex: '#0000ff' }, offered: { material: 'pla', color: 'Purple', colorHex: '#1000ff' } } });
  let call;
  const send = createSubstitutionEmailDelivery({ env, fetchImpl: async (url, options) => { call = { url, options }; return { ok: true }; } });
  assert.equal((await send(message, 'substitution/sub_test')).state, 'sent');
  assert.equal(call.url, 'https://api.resend.com/emails'); assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers.Authorization, 'Bearer private-test'); assert.equal(call.options.headers['Idempotency-Key'], 'substitution/sub_test');
  const body = JSON.parse(call.options.body); assert.deepEqual(body.to, ['customer@example.com']);
  assert.match(body.html, /&lt;blue&gt;/); assert.equal(body.reply_to, 'owner@example.com');
  assert.equal(body.html.includes('private-test'), false); assert.ok(call.options.signal);
  assert.equal((await createSubstitutionEmailDelivery({ env: {} })(message, 'key')).state, 'unconfigured');
  assert.equal((await createSubstitutionEmailDelivery({ env, fetchImpl: async () => ({ ok: false, status: 500 }) })(message, 'key')).state, 'uncertain');
  assert.equal((await createSubstitutionEmailDelivery({ env, fetchImpl: async () => { throw new Error('SECRET'); } })(message, 'key')).state, 'uncertain');
});
