import { normalizeBilling, calculateBilling } from './domain.js';

// This adapter intentionally has no send, bulk-action, payment or update method.
const HOST = 'https://invoicing.co/api/v1/';
const ID = /^[A-Za-z0-9]{4,64}$/;
export class InvoiceProviderError extends Error {
  constructor(code = 'invoice_provider_unavailable', invoice) {
    super(code === 'invoicing_unconfigured' ? 'Invoice integration is not configured.' : code === 'invoice_review_required' ? 'The provider invoice needs review in Invoice Ninja.' : code === 'invoice_client_invalid' ? 'Select an active USD client in the fabrication billing group.' : 'Invoice Ninja is temporarily unavailable. Review the billing operation before retrying.');
    this.name = 'InvoiceProviderError'; this.code = code;
    if (invoice) this.invoice = invoice;
  }
}
function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('A valid Invoice Ninja ID is required.');
  return value;
}
function cents(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100000000 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new InvoiceProviderError();
  return Math.round(n * 100);
}
function invoiceSummary(raw) {
  if (!raw || !ID.test(raw.id) || !ID.test(raw.client_id) || typeof raw.number !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.number)) throw new InvoiceProviderError();
  const states = { 1: 'draft', 2: 'sent', 3: 'partially_paid', 4: 'paid', 5: 'cancelled', 6: 'reversed' };
  return { id: raw.id, clientId: raw.client_id, number: raw.number, status: raw.is_deleted ? 'deleted' : states[String(raw.status_id)] ?? 'unknown',
    totalCents: cents(raw.amount), taxCents: cents(raw.total_taxes), balanceCents: cents(raw.balance), paidCents: cents(raw.paid_to_date),
    editorUrl: `https://app.invoicing.co/#/invoices/${raw.id}/edit` };
}
async function boundedJson(response) {
  if (!response.ok || !/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {}); throw new InvoiceProviderError();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new InvoiceProviderError();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 512000) throw new InvoiceProviderError();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await reader.cancel().catch(() => {}); }
}

export function createInvoiceNinja({ token = process.env.INVOICE_NINJA_TOKEN, groupId = process.env.INVOICE_NINJA_GROUP_ID, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    if (typeof token !== 'string' || !token.trim() || !ID.test(groupId ?? '')) throw new InvoiceProviderError('invoicing_unconfigured');
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => boundedJson(await fetchImpl(`${HOST}${path}`, {
          method, redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', 'X-API-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        })))(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new InvoiceProviderError()); }, Math.max(1, Math.min(20000, timeoutMs))); })
      ]);
    } catch { throw new InvoiceProviderError(); }
    finally { clearTimeout(timer); }
  }
  async function getClient(clientId) {
    const requested = id(clientId), { data } = await request(`clients/${requested}`);
    if (!data || data.id !== requested || data.is_deleted || data.archived_at || data.group_settings_id !== groupId) throw new InvoiceProviderError('invoice_client_invalid');
    const currencySetting = settings => String(settings?.currency_id ?? '').trim();
    let currency = currencySetting(data.settings);
    if (!currency) {
      const group = (await request(`group_settings/${groupId}`)).data;
      if (!group || group.id !== groupId || group.is_deleted || group.archived_at) throw new InvoiceProviderError('invoice_client_invalid');
      currency = currencySetting(group.settings);
    }
    if (!currency) {
      // Invoice Ninja's current-company endpoint is a read-only POST; GET /companies
      // lists other companies and cannot safely establish the token's defaults.
      currency = currencySetting((await request('companies/current', { method: 'POST', body: {} })).data?.settings);
    }
    if (currency !== '1') throw new InvoiceProviderError('invoice_client_invalid');
    return { id: requested, name: typeof data.name === 'string' ? data.name.slice(0, 200) : '', groupId, currency: 'USD' };
  }
  async function getInvoice(invoiceId) {
    const requested = id(invoiceId), { data } = await request(`invoices/${requested}`), summary = invoiceSummary(data);
    if (summary.id !== requested) throw new InvoiceProviderError();
    return summary;
  }
  async function findByNumber(number) {
    if (typeof number !== 'string' || !/^3DP-[A-Za-z0-9_-]{1,120}$/.test(number)) throw new TypeError('A fabrication invoice number is required.');
    const { data, meta } = await request(`invoices?${new URLSearchParams({ number, per_page: '100', status: 'active,archived,deleted' })}`);
    if (!Array.isArray(data) || data.length > 100 || Number(meta?.pagination?.total_pages ?? 1) > 1) throw new InvoiceProviderError();
    return data.filter(row => row.number === number).map(invoiceSummary);
  }
  async function createDraft({ billing: input, operationId }) {
    const billing = normalizeBilling(input), expected = calculateBilling(billing);
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(operationId)) throw new TypeError('A valid billing operation ID is required.');
    await getClient(billing.clientId);
    const number = `3DP-${billing.date.slice(0, 4)}-${operationId}`;
    const payload = {
      client_id: billing.clientId, number, idempotency_key: operationId,
      date: billing.date, due_date: billing.dueDate, status_id: '1', auto_bill_enabled: false,
      public_notes: `Receipt location: ${billing.receiptAddress.street}, ${billing.receiptAddress.city}, ${billing.receiptAddress.region} ${billing.receiptAddress.postalCode}, US`,
      uses_inclusive_taxes: false, tax_name1: '', tax_rate1: 0, tax_name2: '', tax_rate2: 0, tax_name3: '', tax_rate3: 0,
      discount: 0, is_amount_discount: true, exchange_rate: 1, partial: 0,
      terms: 'Please reference the invoice number with your payment. Contact hello@3dprint4.me with any questions about this invoice.',
      footer: '3dprint4.me | JDH Productions LLC | https://3dprint4.me | hello@3dprint4.me',
      line_items: billing.lines.map(line => ({ product_key: line.item, notes: line.description,
        quantity: line.quantityMilli / 1000, cost: line.unitCents / 100,
        tax_name1: line.taxRateMilli ? 'Sales Tax' : '', tax_rate1: line.taxRateMilli / 1000,
        tax_name2: '', tax_rate2: 0, tax_name3: '', tax_rate3: 0, discount: 0, type_id: '1' }))
    };
    const { data } = await request('invoices', { method: 'POST', body: payload });
    const invoice = invoiceSummary(data);
    if (invoice.status !== 'draft' || invoice.number !== number || invoice.clientId !== billing.clientId || invoice.totalCents !== expected.totalCents || invoice.taxCents !== expected.taxCents || invoice.balanceCents !== expected.totalCents || invoice.paidCents !== 0) throw new InvoiceProviderError('invoice_review_required', invoice);
    return invoice;
  }
  return { getClient, getInvoice, findByNumber, createDraft };
}
