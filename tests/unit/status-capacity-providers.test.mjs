import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProviderCapacity, providerCoverage } from '../../status/lib/capacity-providers.js';

const now = Date.parse('2026-11-25T12:00:00Z');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const resend = { object: 'usage', emails: { daily: { used: 12, limit: 100, resets_at: '2026-11-26T00:00:00Z' }, monthly: { used: 40, limit: 3000, resets_at: '2026-12-01T00:00:00Z' } }, rate_limit: { limit: 2, duration: '1000ms' } };
test('unconfigured providers never make requests or expose configuration values', async () => {
  assert.deepEqual(await collectProviderCapacity({ env: {}, now, fetchImpl: () => assert.fail() }), []);
  assert.equal(JSON.stringify(providerCoverage({ CAPACITY_RESEND_KEY: 'secret' })).includes('secret'), false);
});
test('Resend uses documented account usage request and preserves rolling window uncertainty', async () => {
  const readings = await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 'secret' }, now, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.resend.com/usage'); assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.ok(init.signal); return json(resend);
  } });
  assert.equal(readings.length, 3); assert.equal(readings[0].scope, 'account');
  assert.equal(readings[0].periodStart, null); assert.equal(readings[0].used, 12);
  assert.equal(readings[2].used, null); assert.equal(readings[2].limit, 2);
  assert.equal(readings[2].rateWindowMs, 1000);
});
test('Resend unlimited daily is explicit; malformed entries do not fabricate zero usage', async () => {
  const payload = structuredClone(resend); payload.emails.daily.limit = null; payload.emails.monthly.used = '40';
  payload.rate_limit.duration = '1 day';
  const rows = await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's' }, now, fetchImpl: async () => json(payload) });
  assert.equal(rows.length, 1); assert.equal(rows[0].unlimited, true);
});
test('failure, oversized body, redirect and malformed JSON omit readings without leaking error', async () => {
  for (const response of [new Response('secret failure', { status: 403 }), new Response('{'), new Response('x'.repeat(1048577)), new Response('', { status: 302 })]) {
    assert.deepEqual(await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's' }, now, fetchImpl: async () => response }), []);
  }
});
test('429 Retry-After is sanitized and no retry is attempted', async () => {
  const events = []; let calls = 0;
  assert.deepEqual(await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's' }, now, onAvailability: e => events.push(e), fetchImpl: async () => { calls++; return new Response('secret', { status: 429, headers: { 'retry-after': '7200' } }); } }), []);
  assert.equal(calls, 1); assert.equal(events[0].retryAt, now + 7200000);
  await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's' }, now, skipUntil: { resend: now + 7200000 }, fetchImpl: () => assert.fail() });
});
test('Vercel FOCUS aggregates mapped usage only, validates unit/account/window, ignores charges', async () => {
  const row = { SkuId: 'real-sku', SubAccountId: 'team_a', ChargeCategory: 'Usage', ConsumedQuantity: '2', ConsumedUnit: 'GB', ChargePeriodStart: '2026-11-01T00:00:00Z', ChargePeriodEnd: '2026-11-02T00:00:00Z' };
  const env = { CAPACITY_VERCEL_TOKEN: 's', CAPACITY_VERCEL_TEAM_ID: 'team_a', CAPACITY_VERCEL_SKUS: JSON.stringify({ 'blob-transfer': 'real-sku' }) };
  const rows = await collectProviderCapacity({ env, now, fetchImpl: async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin + parsed.pathname, 'https://api.vercel.com/v1/billing/charges');
    assert.equal(parsed.searchParams.get('teamId'), 'team_a'); assert.equal(init.method, 'GET');
    return new Response([row, { ...row, ConsumedQuantity: '3' }, { ...row, ChargeCategory: 'Credit' }].map(JSON.stringify).join('\n'));
  } });
  assert.equal(rows.length, 1); assert.equal(rows[0].used, 5e9); assert.equal(rows[0].limit, null);
  assert.equal(rows[0].periodEnd, Date.parse('2026-12-01T00:00:00Z'));
  assert.equal(rows[0].coverageEnd, Date.parse('2026-11-25T00:00:00Z')); assert.equal(rows[0].partial, true);
  for (const bad of [{ ConsumedUnit: 'GB-month' }, { SubAccountId: 'other' }, { ChargePeriodEnd: '2027-01-01' }, { ConsumedQuantity: '-1' }]) {
    assert.deepEqual(await collectProviderCapacity({ env, now, fetchImpl: async () => new Response(JSON.stringify({ ...row, ...bad })) }), []);
  }
});
test('explicit operator budgets remain distinct from provider allowances', async () => {
  const env = { CAPACITY_CLOUDFLARE_TOKEN: 's', CAPACITY_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CAPACITY_PROVIDER_LIMITS_JSON: JSON.stringify({ 'cf-requests': { limit: 100, unit: 'requests', source: 'configured', periodStart: Date.parse('2026-11-25T00:00:00Z'), periodEnd: Date.parse('2026-11-26T00:00:00Z') } }) };
  const fetchImpl = async () => json({ data: { viewer: { accounts: [{ workers: [{ sum: { requests: 80 } }] }] } } });
  const rows = await collectProviderCapacity({ env, now, fetchImpl });
  assert.equal(rows[0].limitSource, 'configured'); assert.equal(rows[0].limit, 100);
  env.CAPACITY_PROVIDER_LIMITS_JSON = env.CAPACITY_PROVIDER_LIMITS_JSON.replace('configured', 'manual');
  assert.equal((await collectProviderCapacity({ env, now, fetchImpl }))[0].limit, null);
});
test('Cloudflare queries account analytics, returns only well formed present aggregates', async () => {
  const rows = await collectProviderCapacity({ env: { CAPACITY_CLOUDFLARE_TOKEN: 's', CAPACITY_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }, now, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql'); assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body); assert.equal(body.variables.account, 'a'.repeat(32));
    assert.match(body.query, /workersInvocationsAdaptive/);
    return json({ data: { viewer: { accounts: [{ workers: [{ sum: { requests: 80 } }], rows: [{ sum: { rowsRead: 20, rowsWritten: 3 } }] }] } } });
  } });
  assert.deepEqual(rows.map(r => [r.id, r.used]), [['cf-requests', 80], ['cf-do-reads', 20], ['cf-do-writes', 3]]);
});
test('GraphQL errors never produce fresh zero or leak provider messages', async () => {
  const rows = await collectProviderCapacity({ env: { CAPACITY_CLOUDFLARE_TOKEN: 's', CAPACITY_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }, now, fetchImpl: async () => json({ errors: [{ message: 'secret' }], data: { viewer: { accounts: [] } } }) });
  assert.deepEqual(rows, []);
});
test('a provider failure does not discard another provider success', async () => {
  const rows = await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's', CAPACITY_CLOUDFLARE_TOKEN: 's', CAPACITY_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }, now, fetchImpl: async url => {
    if (url.includes('cloudflare')) throw new Error('secret');
    return json(resend);
  } });
  assert.equal(rows.length, 3); assert.ok(rows.every(row => row.id.startsWith('resend-')));
});
test('invalid quota overlays cannot change unit or accounting window; dated manual quotas retain provenance', async () => {
  const base = { CAPACITY_CLOUDFLARE_TOKEN: 's', CAPACITY_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  const quota = { limit: 100, unit: 'requests', verifiedAt: now - 2 * 86400000, periodStart: Date.parse('2026-11-25T00:00:00Z'), periodEnd: Date.parse('2026-11-26T00:00:00Z') };
  const fetchImpl = async () => json({ data: { viewer: { accounts: [{ workers: [{ sum: { requests: 80 } }] }] } } });
  const rows = await collectProviderCapacity({ env: { ...base, CAPACITY_PROVIDER_LIMITS_JSON: JSON.stringify({ 'cf-requests': quota }) }, now, fetchImpl });
  assert.equal(rows[0].limitVerifiedAt, quota.verifiedAt); assert.equal(rows[0].limitSource, 'manual');
  for (const bad of [{ unit: 'bytes' }, { periodStart: 0 }, { verifiedAt: now + 60000 }]) {
    const output = await collectProviderCapacity({ env: { ...base, CAPACITY_PROVIDER_LIMITS_JSON: JSON.stringify({ 'cf-requests': { ...quota, ...bad } }) }, now, fetchImpl });
    assert.equal(output[0].limit, null);
  }
});
test('deadline aborts a pending provider request', { timeout: 10000 }, async () => {
  let aborted = false;
  const rows = await collectProviderCapacity({ env: { CAPACITY_RESEND_KEY: 's' }, now, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('secret timeout')); });
  }) });
  assert.equal(aborted, true); assert.deepEqual(rows, []);
});
