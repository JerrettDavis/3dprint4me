// Billing is explicitly entered by the owner. Never pass an intake/request object here.
function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be an object.`);
  if (Object.keys(value).some(key => !fields.includes(key))) throw new TypeError(`Unexpected ${label} field.`);
  return value;
}
function text(value, max, label, optional = false) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max || /[<>\u0000-\u0008\u000b-\u001f\u007f]/u.test(result)) throw new TypeError(`${label} is invalid.`);
  return result;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}
function date(value, label) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${label} must be a real ISO date.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TypeError(`${label} must be a real ISO date.`);
  return value;
}
export function normalizeBilling(input) {
  const b = object(input, ['clientId', 'date', 'dueDate', 'receiptAddress', 'taxEvidence', 'priorPayment', 'lines'], 'billing');
  const clientId = text(b.clientId, 64, 'Client ID');
  if (!/^[A-Za-z0-9]{4,64}$/.test(clientId)) throw new TypeError('Client ID is invalid.');
  const invoiceDate = date(b.date, 'Invoice date'), dueDate = date(b.dueDate, 'Due date');
  if (dueDate < invoiceDate) throw new TypeError('Due date must not precede invoice date.');
  const a = object(b.receiptAddress, ['street', 'city', 'region', 'postalCode', 'country'], 'receipt address');
  const receiptAddress = Object.freeze(Object.fromEntries(Object.entries({ street: 200, city: 100, region: 100, postalCode: 20, country: 2 }).map(([key, max]) => [key, text(a[key], max, `Receipt ${key}`)])));
  if (receiptAddress.country !== 'US') throw new TypeError('Billing currently supports US receipt locations only.');
  const evidence = object(b.taxEvidence, ['jurisdiction', 'verifiedOn', 'reference'], 'tax evidence');
  const taxEvidence = Object.freeze({ jurisdiction: text(evidence.jurisdiction, 200, 'Tax jurisdiction'), verifiedOn: date(evidence.verifiedOn, 'Tax verification date'), reference: text(evidence.reference, 500, 'Tax evidence reference') });
  if (taxEvidence.verifiedOn > invoiceDate) throw new TypeError('Tax verification date cannot follow invoice date.');
  const prior = object(b.priorPayment, ['state', 'reference'], 'prior payment');
  if (!['none', 'reconciled'].includes(prior.state)) throw new TypeError('Resolve prior payments in Invoice Ninja before creating an invoice.');
  const reference = text(prior.reference, 300, 'Prior payment reference', prior.state === 'none');
  if (prior.state === 'none' && reference) throw new TypeError('A prior payment reference requires reconciliation.');
  if (!Array.isArray(b.lines) || b.lines.length < 1 || b.lines.length > 50) throw new TypeError('Billing requires 1 to 50 lines.');
  const lines = Object.freeze(b.lines.map(raw => {
    const line = object(raw, ['item', 'description', 'quantityMilli', 'unitCents', 'taxRateMilli', 'taxReason'], 'line');
    return Object.freeze({
      item: text(line.item, 100, 'Item'), description: text(line.description, 1000, 'Description', true),
      quantityMilli: integer(line.quantityMilli, 1, 10000000, 'Quantity'),
      unitCents: integer(line.unitCents, 0, 100000000, 'Unit price'),
      taxRateMilli: integer(line.taxRateMilli, 0, 100000, 'Tax rate'), taxReason: text(line.taxReason, 300, 'Tax reason')
    });
  }));
  const normalized = Object.freeze({ clientId, date: invoiceDate, dueDate, receiptAddress, taxEvidence, priorPayment: Object.freeze({ state: prior.state, reference }), lines });
  const totals = calculateBilling(normalized);
  if (totals.subtotalCents < 1 || totals.totalCents > 1000000000) throw new TypeError('Invoice total is outside the supported range.');
  return normalized;
}

const rounded = (value, divisor) => (value + divisor / 2n) / divisor;
export function calculateBilling(billing) {
  let subtotal = 0n, tax = 0n;
  for (const line of billing.lines) {
    const net = rounded(BigInt(line.unitCents) * BigInt(line.quantityMilli), 1000n);
    subtotal += net;
    tax += rounded(net * BigInt(line.taxRateMilli), 100000n);
  }
  if (subtotal + tax > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError('Invoice total is outside the supported range.');
  return { subtotalCents: Number(subtotal), taxCents: Number(tax), totalCents: Number(subtotal + tax) };
}
