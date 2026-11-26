// Read-only provider APIs. No provider response text, account IDs or credentials
// cross this boundary; callers persist only readings and fixed availability codes.
const MAX_BODY = 1024 * 1024;
const DAY = 86400000;
const IDS = ['blob-transfer', 'blob-storage', 'blob-simple', 'blob-advanced', 'vercel-transfer', 'vercel-functions', 'cf-requests', 'cf-do-reads', 'cf-do-writes', 'cf-do-storage', 'resend-daily', 'resend-monthly', 'resend-rate'];
const UNITS = { 'blob-transfer': 'bytes', 'blob-storage': 'bytes', 'blob-simple': 'operations', 'blob-advanced': 'operations', 'vercel-transfer': 'bytes', 'vercel-functions': 'GB-seconds', 'cf-requests': 'requests', 'cf-do-reads': 'rows', 'cf-do-writes': 'rows', 'cf-do-storage': 'bytes', 'resend-daily': 'emails', 'resend-monthly': 'emails', 'resend-rate': 'requests' };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const time = value => typeof value === 'string' && value.length <= 40 && /T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const resendKey = env => env.CAPACITY_RESEND_KEY || env.ALERT_RESEND_KEY;
const configured = env => ({ vercel: Boolean(env.CAPACITY_VERCEL_TOKEN && /^team_[\w-]{1,100}$/.test(env.CAPACITY_VERCEL_TEAM_ID || '')), cloudflare: Boolean(env.CAPACITY_CLOUDFLARE_TOKEN && /^[a-f0-9]{32}$/.test(env.CAPACITY_CLOUDFLARE_ACCOUNT_ID || '')), resend: Boolean(resendKey(env)) });

export function providerCoverage(env = {}) {
  const config = configured(env);
  return Object.entries(config).map(([provider, available]) => ({ provider, status: available ? 'configured' : 'unconfigured' }));
}

function reading(id, used, limit, now, periodStart = null, periodEnd = null) {
  return { id, used, limit, observedAt: now, periodStart, periodEnd, source: 'provider', scope: 'account' };
}

async function request(url, init, fetchImpl, now) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
    if (!response.ok || response.redirected) {
      if (response.status === 429) {
        const raw = response.headers.get('retry-after') || '';
        const delay = /^\d{1,8}$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
        return { status: 'rate-limited', retryAt: now + Math.max(3600000, Math.min(7 * DAY, Number.isFinite(delay) ? delay : 3600000)) };
      }
      return { status: 'unavailable', retryAt: null };
    }
    if (Number(response.headers.get('content-length')) > MAX_BODY) throw new Error('size');
    // Bound decoded bytes too (Content-Length can be absent, wrong or compressed).
    const reader = response.body?.getReader();
    if (!reader) throw new Error('body');
    let size = 0; const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error('size'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { status: 'ok', retryAt: null, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch { return { status: 'unavailable', retryAt: null }; }
  finally { clearTimeout(timeout); }
}

function parseResend(text, now) {
  const body = JSON.parse(text); if (body.object !== 'usage') throw new Error('schema');
  const result = [];
  for (const period of ['daily', 'monthly']) {
    const quota = body.emails?.[period]; const end = time(quota?.resets_at);
    if (!quota || !number(quota.used) || !(number(quota.limit) || (period === 'daily' && quota.limit === null)) || end === null || end <= now || end > now + 32 * DAY) continue;
    // Daily is a rolling quota. The API reports a reset but no start.
    const item = reading(`resend-${period}`, quota.used, quota.limit, now, null, end);
    if (quota.limit === null) item.unlimited = true;
    result.push(item);
  }
  const rate = body.rate_limit;
  if (number(rate?.limit) && typeof rate.duration === 'string' && /^\d{1,8}ms$/.test(rate.duration) && Number.parseInt(rate.duration, 10) > 0) {
    // A configured request ceiling is not a measurement of consumed requests.
    const rateWindowMs = Number.parseInt(rate.duration, 10);
    if (rateWindowMs <= DAY) result.push({ ...reading('resend-rate', null, rate.limit, now), rateWindowMs });
  }
  if (!result.length) throw new Error('schema');
  return result;
}

function skuMap(env) {
  try {
    const raw = env.CAPACITY_VERCEL_SKUS || '{}'; if (raw.length > 2048) return {};
    const input = JSON.parse(raw); const output = {};
    for (const [id, sku] of Object.entries(input)) if (IDS.slice(0, 6).includes(id) && typeof sku === 'string' && /^[\w.-]{1,120}$/.test(sku)) output[id] = sku;
    // One SKU may not be counted as two metrics.
    if (new Set(Object.values(output)).size !== Object.values(output).length) return {};
    return output;
  } catch { return {}; }
}

function parseVercel(text, env, now, start, end) {
  const map = skuMap(env); const totals = new Map(); const invalid = new Set();
  const lines = text.trim() ? text.trim().split('\n') : [];
  if (lines.length > 10000) throw new Error('size');
  for (const line of lines) {
    const row = JSON.parse(line); if (row.ChargeCategory !== 'Usage') continue;
    const id = Object.keys(map).find(key => map[key] === row.SkuId); if (!id) continue;
    const from = time(row.ChargePeriodStart); const to = time(row.ChargePeriodEnd);
    const quantity = typeof row.ConsumedQuantity === 'string' && /^\d+(?:\.\d+)?$/.test(row.ConsumedQuantity) ? Number(row.ConsumedQuantity) : row.ConsumedQuantity;
    const unit = row.ConsumedUnit;
    let factor = null;
    if (UNITS[id] === 'bytes') factor = ({ byte: 1, bytes: 1, GB: 1e9, GiB: 2 ** 30 })[unit] ?? null;
    if (UNITS[id] === 'operations' && ['operation', 'operations', 'request', 'requests'].includes(unit)) factor = 1;
    if (id === 'vercel-functions' && unit === 'GB-Seconds') factor = 1;
    if (row.SubAccountId !== env.CAPACITY_VERCEL_TEAM_ID || from === null || to === null || from < start || to > end || from >= to || !number(quantity) || factor === null || !number(quantity * factor)) { invalid.add(id); continue; }
    const value = totals.get(id) || 0; totals.set(id, value + quantity * factor);
  }
  const nextMonth = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);
  const result = [...totals].filter(([id, value]) => !invalid.has(id) && number(value)).map(([id, value]) => ({ ...reading(id, value, null, now, start, nextMonth), partial: true, coverageEnd: end }));
  if (!result.length && (invalid.size || totals.size)) throw new Error('schema');
  return result;
}

const CF_QUERY = `query Capacity($account: String!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $account}) {
    workers: workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end}) { sum { requests } }
    rows: durableObjectsPeriodicGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end}) { sum { rowsRead rowsWritten } }
  } }
}`;

function parseCloudflare(text, now, start) {
  const body = JSON.parse(text); if (body.errors?.length) throw new Error('schema');
  const accounts = body.data?.viewer?.accounts; if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error('schema');
  const account = accounts[0]; const output = [];
  for (const [key, field, id] of [['workers', 'requests', 'cf-requests'], ['rows', 'rowsRead', 'cf-do-reads'], ['rows', 'rowsWritten', 'cf-do-writes']]) {
    const groups = account[key];
    if (Array.isArray(groups) && groups.length === 1 && number(groups[0]?.sum?.[field])) output.push(reading(id, groups[0].sum[field], null, now, start, start + DAY));
  }
  if (!output.length && !(Array.isArray(account.workers) && account.workers.length === 0 && Array.isArray(account.rows) && account.rows.length === 0)) throw new Error('schema');
  return output;
}

function manualLimits(readings, env, now) {
  try {
    const raw = env.CAPACITY_PROVIDER_LIMITS_JSON || '{}'; if (raw.length > 8192) return readings;
    const limits = JSON.parse(raw);
    return readings.map(row => {
      const entry = limits[row.id];
      if (row.limit !== null || !entry || !number(entry.limit) || entry.unit !== UNITS[row.id] || !number(entry.periodStart) || !number(entry.periodEnd) || entry.periodStart !== row.periodStart || entry.periodEnd !== row.periodEnd || entry.periodStart > now || entry.periodEnd <= now) return row;
      if (entry.source === 'configured') return { ...row, limit: entry.limit, limitSource: 'configured' };
      if ((entry.source !== undefined && entry.source !== 'manual') || !number(entry.verifiedAt) || entry.verifiedAt > now + 30000) return row;
      return { ...row, limit: entry.limit, limitSource: 'manual', limitVerifiedAt: entry.verifiedAt };
    });
  } catch { return readings; }
}

export async function collectProviderCapacity({ env = {}, now = Date.now(), fetchImpl = fetch, onAvailability = () => {}, skipUntil = {} } = {}) {
  if (!number(now)) return [];
  const config = configured(env);
  const month = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
  const day = Math.floor(now / DAY) * DAY;
  const jobs = [];
  const add = (provider, url, init, parse) => {
    if (!config[provider] || (number(skipUntil[provider]) && skipUntil[provider] > now)) return;
    jobs.push((async () => {
      const response = await request(url, init, fetchImpl, now); let rows = [];
      if (response.status === 'ok') { try { rows = parse(response.text); } catch { response.status = 'unavailable'; } }
      try { onAvailability({ provider, status: response.status, retryAt: response.retryAt }); } catch { /* caller telemetry cannot fail collection */ }
      return rows;
    })());
  };
  if (day > month && Object.keys(skuMap(env)).length) {
    const url = new URL('https://api.vercel.com/v1/billing/charges');
    url.searchParams.set('teamId', env.CAPACITY_VERCEL_TEAM_ID);
    url.searchParams.set('from', new Date(month).toISOString()); url.searchParams.set('to', new Date(day).toISOString());
    // Completed UTC days only: this API promises one-day granularity.
    add('vercel', url.href, { method: 'GET', headers: { Authorization: `Bearer ${env.CAPACITY_VERCEL_TOKEN}` } }, text => parseVercel(text, env, now, month, day));
  }
  add('cloudflare', 'https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${env.CAPACITY_CLOUDFLARE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: CF_QUERY, variables: { account: env.CAPACITY_CLOUDFLARE_ACCOUNT_ID, start: new Date(day).toISOString(), end: new Date(now).toISOString() } }) }, text => parseCloudflare(text, now, day));
  add('resend', 'https://api.resend.com/usage', { method: 'GET', headers: { Authorization: `Bearer ${resendKey(env)}` } }, text => parseResend(text, now));
  return manualLimits((await Promise.all(jobs)).flat(), env, now);
}
