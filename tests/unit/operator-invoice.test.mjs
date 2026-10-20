import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkHandler } from '../../api/operator-work.js';
import { ownerFixture, billingFixture } from '../fixtures/billing.mjs';

const origin = 'https://operator.example.com';
function response() { return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body ?? '{}'); } }; }
function setup({ role = 'owner', configured = true } = {}) {
  const calls = [];
  const service = Object.fromEntries(['get', 'preview', 'create', 'refresh', 'reconcile'].map(action => [action, async (...args) => { calls.push({ action, args }); return { state: 'draft' }; }]));
  const handler = createWorkHandler({ store: {}, printEstimates: null, authorize: async () => ({ ...ownerFixture, role }), allowedOrigins: [origin], invoicing: { configured, service } });
  const run = async (body, opts = {}) => { const res = response(); await handler({ url: '/api/operator-work?resource=invoices&workId=work_example123', method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...opts.headers }, body, ...opts }, res); return res; };
  return { run, calls };
}
test('owner can load private billing and create a draft; response is no-store', async () => {
  const { run, calls } = setup();
  assert.equal((await run()).body.configured, true);
  const command = { workId: 'work_example123', revision: 1, idempotencyKey: 'click12345', billing: billingFixture() };
  const result = await run({ action: 'create', command });
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(calls[1].action, 'create'); assert.deepEqual(calls[1].args[0], command);
});
test('non-owner and forbidden origins cannot read billing or invoke provider', async () => {
  const nonowner = setup({ role: 'operator' }); assert.equal((await nonowner.run()).statusCode, 403); assert.equal(nonowner.calls.length, 0);
  const denied = setup(); assert.equal((await denied.run(null, { headers: { origin: 'https://evil.example' } })).statusCode, 403); assert.equal(denied.calls.length, 0);
});
test('send actions, unknown fields and malformed bodies are rejected', async () => {
  const { run, calls } = setup();
  for (const body of [{ action: 'send', workId: 'work_example123' }, { action: 'create', command: {}, send: true }, ['create'], { action: 'refresh', workId: 'work_example123', url: 'https://evil.example' }]) assert.equal((await run(body)).statusCode, 400);
  assert.equal(calls.length, 0);
});
test('unconfigured mode is explicit and cannot create', async () => {
  const { run, calls } = setup({ configured: false });
  const status = await run(); assert.equal(status.statusCode, 200); assert.equal(status.body.configured, false);
  assert.equal((await run({ action: 'create', command: {} })).statusCode, 409); assert.equal(calls.length, 0);
});
