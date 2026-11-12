import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueOperatorHandler } from '../../lib/product-catalogue/operator-api.js';

const origin = 'https://operator.example';
async function invoke(handler, options = {}) {
  const req = { method: 'GET', url: '/api/operator-work?resource=catalogue', headers: { origin, 'content-type': 'application/json' }, ...options };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; this.writableEnded = true; } };
  await handler(req, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

test('catalogue API enforces origin and owner authorization before reading private state', async () => {
  const application = { list: async () => { throw new Error('private database credential'); } };
  for (const role of ['partner', 'operator']) {
    const handler = createCatalogueOperatorHandler({ allowedOrigins: [origin], authorize: async () => ({ id: 'identity', role }), application });
    assert.equal((await invoke(handler)).status, 403);
  }
  const handler = createCatalogueOperatorHandler({ allowedOrigins: [origin], authorize: async () => ({ id: 'owner', role: 'owner' }), application });
  assert.equal((await invoke(handler, { headers: { origin: 'https://untrusted.example' } })).status, 403);
  const failed = await invoke(handler);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.body), /credential|database/);
});

test('unconfigured storage is truthful and preserves existing intake instead of pretending a product was saved', async () => {
  const handler = createCatalogueOperatorHandler({ allowedOrigins: [origin], authorize: async () => ({ id: 'owner', role: 'owner' }), getRuntime: () => ({ configured: false }) });
  const listed = await invoke(handler);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.configured, false);
  assert.equal((await invoke(handler, { method: 'POST', body: { action: 'promote' } })).status, 409);
});
