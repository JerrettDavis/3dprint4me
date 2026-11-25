import { normalizeTrackedInvoice, normalizePaymentAllocation } from './tracking-domain.js';

const HOST = 'https://invoicing.co/api/v1/';
const ID = /^[A-Za-z0-9]{4,64}$/;
const PAYMENT_STATES = { 1: 'pending', 2: 'cancelled', 3: 'failed', 4: 'completed', 5: 'partially_refunded', 6: 'refunded' };
const unavailable = () => new Error('Invoice tracking is temporarily unavailable.');
const requireValid = value => { if (!value) throw unavailable(); };

async function readJson(response, maxBytes) {
  if (!response.ok || !/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {}); throw unavailable();
  }
  const reader = response.body?.getReader();
  requireValid(reader);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValid(size <= maxBytes);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await reader.cancel().catch(() => {}); }
}

function invitationTimestamp(value) {
  if (value === '' || value == null || value === 0) return null;
  // The API invitation serializer emits SQL UTC dates. Never interpret them in
  // the host machine's local timezone; explicit-zone ISO values retain their zone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return `${value.replace(' ', 'T')}Z`;
  return value;
}

export function createInvoiceTrackingProvider({ token = process.env.INVOICE_NINJA_TOKEN,
  groupId = process.env.INVOICE_NINJA_GROUP_ID, fetchImpl = fetch, timeoutMs = 10000,
  budgetMs = 90000, maxPages = 20, maxRequests = 200, maxBytes = 4 * 1024 * 1024 } = {}) {
  return { async readSnapshot() {
    if (typeof token !== 'string' || !token.trim() || typeof groupId !== 'string' || !ID.test(groupId)) {
      throw new Error('Invoice tracking is not configured.');
    }
    const deadline = performance.now() + Math.max(1, Math.min(120000, budgetMs)); let requests = 0;
    async function request(path, method = 'GET') {
      requireValid(++requests <= maxRequests);
      const remaining = deadline - performance.now(); requireValid(remaining > 0);
      const controller = new AbortController(); let timer;
      try {
        return await Promise.race([
          (async () => readJson(await fetchImpl(`${HOST}${path}`, { method, redirect: 'error', signal: controller.signal,
            headers: { Accept: 'application/json', 'X-API-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest',
              ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
            ...(method === 'POST' ? { body: '{}' } : {}) }), maxBytes))(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); },
            Math.max(1, Math.min(20000, timeoutMs, remaining))); })
        ]);
      } finally { clearTimeout(timer); }
    }
    async function collection(path, params) {
      const result = []; const seen = new Set(); let expectedPages;
      for (let page = 1; page <= maxPages; page++) {
        const query = new URLSearchParams({ ...params, per_page: '100', page: String(page) });
        const body = await request(`${path}?${query}`), pagination = body?.meta?.pagination;
        requireValid(Array.isArray(body?.data) && body.data.length <= 100 && pagination);
        const pages = Number(pagination.total_pages), current = Number(pagination.current_page);
        // Some Fractal responses use zero total_pages for an empty collection.
        requireValid(Number.isSafeInteger(pages) && pages >= 0 && pages <= maxPages && current === page &&
          (pages > 0 || body.data.length === 0));
        if (expectedPages !== undefined) requireValid(expectedPages === pages);
        expectedPages = pages;
        for (const row of body.data) {
          requireValid(row && typeof row.id === 'string' && ID.test(row.id) && !seen.has(row.id));
          seen.add(row.id); result.push(row);
        }
        if (page >= pages) return result;
      }
      throw unavailable();
    }
    try {
      const statics = await request('statics');
      requireValid(Array.isArray(statics?.currencies) && statics.currencies.length > 0 && statics.currencies.length <= 1000);
      const currencies = new Map();
      for (const currency of statics.currencies) {
        requireValid(currency && /^\d{1,8}$/.test(String(currency.id)) && /^[A-Z]{3}$/.test(currency.code) && !currencies.has(String(currency.id)));
        currencies.set(String(currency.id), currency.code);
      }
      const company = (await request('companies/current', 'POST'))?.data;
      requireValid(typeof company?.id === 'string' && ID.test(company.id));
      const group = (await request(`group_settings/${groupId}`))?.data;
      requireValid(group?.id === groupId && !group.is_deleted && !group.archived_at);
      let fallbackCurrency = String(group.settings?.currency_id ?? '').trim();
      if (!fallbackCurrency) {
        // Official current-company lookup is a read-only POST, as in the draft adapter.
        fallbackCurrency = String(company.settings?.currency_id ?? '').trim();
      }
      const clients = await collection('clients', { group_settings_id: groupId, status: 'active,archived,deleted' });
      const invoices = [], allocations = []; const invoiceIds = new Set(), allocationIds = new Set();
      for (const client of clients) {
        if (client.group_settings_id !== groupId) continue;
        const currency = currencies.get(String(client.settings?.currency_id ?? '').trim() || fallbackCurrency);
        requireValid(currency);
        const rows = await collection('invoices', { client_id: client.id, status: 'active,archived,deleted', include: 'invitations' });
        const clientInvoiceIds = new Set();
        for (const row of rows) {
          requireValid(row.client_id === client.id && !invoiceIds.has(row.id) && Array.isArray(row.invitations ?? []));
          const normalized = normalizeTrackedInvoice({ ...row, currency, invitations: (row.invitations ?? []).map(invitation => ({
            viewed_date: invitationTimestamp(invitation.viewed_date), opened_date: invitationTimestamp(invitation.opened_date)
          })) });
          invoiceIds.add(row.id); clientInvoiceIds.add(row.id); invoices.push(normalized);
        }
        const payments = await collection('payments', { client_id: client.id, status: 'active,archived,deleted', include: 'paymentables' });
        for (const payment of payments) {
          requireValid(payment.client_id === client.id && Object.hasOwn(PAYMENT_STATES, payment.status_id) &&
            typeof payment.is_deleted === 'boolean' && Array.isArray(payment.paymentables));
          const paymentCurrency = currencies.get(String(payment.currency_id)); requireValid(paymentCurrency);
          requireValid(payment.paymentables.length <= 1000);
          for (const allocation of payment.paymentables) {
            requireValid(allocation && allocation.payment_id === payment.id);
            if (allocation.credit_id && !allocation.invoice_id) continue;
            requireValid(clientInvoiceIds.has(allocation.invoice_id) && !allocationIds.has(allocation.id));
            const normalized = normalizePaymentAllocation({ id: allocation.id, invoiceId: allocation.invoice_id,
              paymentId: payment.id, currency: paymentCurrency, amount: allocation.amount, refunded: allocation.refunded,
              updatedAt: allocation.updated_at, date: payment.date, status: PAYMENT_STATES[payment.status_id], deleted: payment.is_deleted });
            allocationIds.add(normalized.id); allocations.push(normalized);
          }
        }
      }
      return { source: { companyId: company.id, groupId }, invoices, allocations };
    } catch { throw unavailable(); }
  } };
}
