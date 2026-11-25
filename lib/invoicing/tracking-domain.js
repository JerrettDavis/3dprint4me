// Provider facts only: no customer payloads, credentials or network access.
const ID = /^[A-Za-z0-9]{4,64}$/;
const STATES = { 1: 'draft', 2: 'sent', 3: 'partially_paid', 4: 'paid', 5: 'cancelled', 6: 'reversed' };
const invalid = () => { throw new TypeError('Invalid invoice tracking data.'); };

function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value)) invalid();
  return value;
}

function money(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100000000 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) invalid();
  return Math.round(n * 100);
}

function date(value) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}

function instant(value) {
  if (value === '' || value == null || value === 0) return null;
  // Ambiguous local provider timestamps must be resolved in its adapter.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  date(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function firstActivity(invitations, field) {
  const values = invitations.map(invitation => {
    if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation)) invalid();
    return instant(invitation[field]);
  }).filter(Boolean);
  return values.sort()[0] ?? null;
}

export function normalizeTrackedInvoice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  if (typeof raw.number !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.number)) invalid();
  if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) invalid();
  if (!['number', 'string'].includes(typeof raw.status_id) || !Object.hasOwn(STATES, raw.status_id)) invalid();
  const status = STATES[String(raw.status_id)];
  if (raw.is_deleted !== undefined && typeof raw.is_deleted !== 'boolean') invalid();
  if (raw.archived_at !== undefined && raw.archived_at !== null &&
      (!Number.isSafeInteger(raw.archived_at) || raw.archived_at < 0)) invalid();
  const invitations = raw.invitations ?? [];
  if (!Array.isArray(invitations) || invitations.length > 100) invalid();
  return {
    id: identifier(raw.id), clientId: identifier(raw.client_id), number: raw.number,
    status, currency: raw.currency,
    totalCents: money(raw.amount), taxCents: money(raw.total_taxes),
    paidCents: money(raw.paid_to_date), balanceCents: money(raw.balance),
    dueDate: date(raw.due_date), partialDueDate: date(raw.partial_due_date),
    deleted: raw.is_deleted === true, archived: Boolean(raw.archived_at),
    viewedAt: firstActivity(invitations, 'viewed_date'), openedAt: firstActivity(invitations, 'opened_date')
  };
}

export function presentInvoiceTracking(invoices, { now = new Date(), timeZone = 'America/Chicago' } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Array.isArray(invoices)) invalid();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const counts = { draft: 0, sent: 0, partially_paid: 0, paid: 0, cancelled: 0, reversed: 0,
    outstanding: 0, overdue: 0, viewed: 0, opened: 0 };
  const totals = new Map();
  const rows = invoices.map(invoice => {
    const active = !invoice.deleted && !invoice.archived;
    const collectible = active && ['sent', 'partially_paid'].includes(invoice.status) && invoice.balanceCents > 0;
    const dueDate = invoice.status === 'partially_paid' ? invoice.partialDueDate ?? invoice.dueDate : invoice.dueDate;
    const overdue = collectible && dueDate !== null && dueDate < today;
    if (active) {
      counts[invoice.status]++;
      if (invoice.viewedAt) counts.viewed++;
      if (invoice.openedAt) counts.opened++;
      if (collectible) counts.outstanding++;
      if (overdue) counts.overdue++;
      const total = totals.get(invoice.currency) ?? { currency: invoice.currency, outstandingCents: 0, overdueCents: 0, paidCents: 0 };
      if (collectible) total.outstandingCents += invoice.balanceCents;
      if (overdue) total.overdueCents += invoice.balanceCents;
      if (['paid', 'partially_paid', 'sent'].includes(invoice.status)) total.paidCents += invoice.paidCents;
      for (const amount of [total.outstandingCents, total.overdueCents, total.paidCents]) if (!Number.isSafeInteger(amount)) invalid();
      totals.set(invoice.currency, total);
    }
    return { ...invoice, overdue, viewed: Boolean(invoice.viewedAt), opened: Boolean(invoice.openedAt),
      editorUrl: `https://app.invoicing.co/#/invoices/${invoice.id}/edit` };
  });
  return { counts, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), rows };
}

export function invoiceTrackingEvents(previous, current) {
  if (!previous || current.deleted || current.archived) return [];
  if (previous.id !== current.id) invalid();
  return [['openedAt', 'invoice_opened'], ['viewedAt', 'invoice_viewed']]
    .filter(([field]) => !previous[field] && current[field])
    .map(([field, kind]) => ({ id: `${current.id}:${kind}:${current[field]}`, kind,
      invoiceId: current.id, occurredAt: current[field] }));
}

export function normalizePaymentAllocation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !['pending', 'cancelled', 'failed', 'completed', 'partially_refunded', 'refunded'].includes(raw.status) ||
      typeof raw.deleted !== 'boolean' || typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency) ||
      !Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0 || raw.updatedAt > 253402300799) invalid();
  const amountCents = money(raw.amount), refundedCents = money(raw.refunded);
  if (refundedCents > amountCents) invalid();
  const paymentDate = date(raw.date);
  if (!paymentDate) invalid();
  return { id: identifier(raw.id), invoiceId: identifier(raw.invoiceId), paymentId: identifier(raw.paymentId),
    currency: raw.currency, amountCents, refundedCents, status: raw.status, deleted: raw.deleted,
    date: paymentDate, updatedAt: new Date(raw.updatedAt * 1000).toISOString() };
}

export function paymentEvidenceWarnings({ invoices, allocations }) {
  if (!Array.isArray(invoices) || !Array.isArray(allocations)) invalid();
  const totals = new Map();
  for (const row of allocations) {
    if (row.deleted || !['completed', 'partially_refunded', 'refunded'].includes(row.status)) continue;
    const key = `${row.invoiceId}:${row.currency}`;
    const total = (totals.get(key) ?? 0) + row.amountCents - row.refundedCents;
    if (!Number.isSafeInteger(total)) invalid(); totals.set(key, total);
  }
  return invoices.filter(row => !row.deleted && !row.archived && ['paid', 'sent', 'partially_paid'].includes(row.status) &&
    row.paidCents !== (totals.get(`${row.id}:${row.currency}`) ?? 0))
    .map(row => ({ invoiceId: row.id, reason: 'payment_evidence_mismatch' }));
}
export function paymentTrackingEvents(previous, current, { baseline = false } = {}) {
  if (baseline) return [];
  if (previous && (previous.id !== current.id || previous.invoiceId !== current.invoiceId ||
      previous.paymentId !== current.paymentId || previous.currency !== current.currency)) invalid();
  const settled = row => row && !row.deleted && ['completed', 'partially_refunded', 'refunded'].includes(row.status);
  const beforeAmount = settled(previous) ? previous.amountCents : 0;
  const beforeRefund = settled(previous) ? previous.refundedCents : 0;
  const afterAmount = settled(current) ? current.amountCents : 0;
  const afterRefund = settled(current) ? current.refundedCents : 0;
  const events = [];
  const add = (kind, amountCents) => events.push({
    id: `${current.id}:${kind}:${afterAmount}:${afterRefund}:${current.deleted ? 1 : 0}:${current.updatedAt}`,
    kind, amountCents, currency: current.currency, invoiceId: current.invoiceId,
    paymentId: current.paymentId, allocationId: current.id, occurredAt: current.updatedAt
  });
  if (afterAmount > beforeAmount) add('invoice_payment', afterAmount - beforeAmount);
  if (afterRefund > beforeRefund) add('invoice_refund', afterRefund - beforeRefund);
  if (afterAmount < beforeAmount || afterRefund < beforeRefund) add('invoice_payment_adjusted',
    Math.abs((afterAmount - afterRefund) - (beforeAmount - beforeRefund)));
  return events;
}
