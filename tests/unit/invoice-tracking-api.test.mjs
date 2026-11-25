import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkHandler } from '../../api/operator-work.js';
import { createHomeAssistantWorkHandler } from '../../api/home-assistant-work.js';
const origin = 'https://work.example.test';
const token = 'machine-read-credential-with-more-than-32-characters';
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } }; }
test('billing resource is owner-only and uses shared authenticated mutation boundary', async () => {
  const calls = [];
  const tracking = { service: { read: async () => ({ version: 1 }), execute: async (...args) => { calls.push(args); return { revision: 2 }; } } };
  const setup = role => createWorkHandler({ store: {}, printEstimates: null, authorize: async () => ({ id: 'owner-one', role }), allowedOrigins: [origin], tracking });
  const req = { url: '/api/operator-work?resource=billing', method: 'GET', headers: { origin } };
  const read = response(); await setup('owner')(req, read); assert.equal(read.statusCode, 200); assert.equal(read.headers['Cache-Control'], 'no-store');
  const denied = response(); await setup('operator')(req, denied); assert.equal(denied.statusCode, 403);
  const command = { action: 'settings' };
  const write = response(); await setup('owner')({ ...req, method: 'POST', body: command, headers: { origin, 'content-type': 'application/json' } }, write);
  assert.equal(write.statusCode, 200); assert.deepEqual(calls[0][0], command);
  const cross = response(); await setup('owner')({ ...req, headers: { origin: 'https://evil.test' } }, cross); assert.equal(cross.statusCode, 403);
});
test('machine billing resource requires bearer authorization and never calls general work snapshot', async () => {
  let calls = 0;
  const handler = createHomeAssistantWorkHandler({ token, tracking: { service: { machineSnapshot: async () => { calls++; return { version: 1, counts: {} }; } } } });
  const req = { url: '/api/home-assistant-work?resource=billing', method: 'GET', headers: { authorization: `Bearer ${token}` } };
  const res = response(); await handler(req, res); assert.equal(res.statusCode, 200); assert.equal(calls, 1);
  const bad = response(); await handler({ ...req, headers: {} }, bad); assert.equal(bad.statusCode, 401); assert.equal(calls, 1);
});
