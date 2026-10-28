import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { normalizeBilling, calculateBilling } from './domain.js';

const hash = value => createHash('sha256').update(value).digest('hex');
// authorizeOperator has already checked enabled in private storage and omits it
// from its returned identity. Explicitly disabled injected identities still fail.
function owner(operator) { if (!operator?.id || operator.enabled === false || operator.role !== 'owner') throw new HttpError(403, 'Only an enabled owner can manage invoices.'); }
function workId(value) { if (typeof value !== 'string' || !/^work_[A-Za-z0-9_-]{8,123}$/.test(value)) throw new HttpError(400, 'A valid work ID is required.'); return value; }
function normalizeCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['workId', 'revision', 'idempotencyKey', 'billing'].includes(k))) throw new HttpError(400, 'A billing confirmation object is required.');
  workId(input.workId);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new HttpError(400, 'A work revision and idempotency key are required.');
  try { return { ...input, billing: normalizeBilling(input.billing) }; } catch (error) { throw new HttpError(400, error.message); }
}
function matches(record, invoice) {
  const totals = calculateBilling(record.payload);
  return invoice.clientId === record.payload.clientId && invoice.number === `3DP-${record.payload.date.slice(0, 4)}-${record.operationId}` && invoice.totalCents === totals.totalCents && invoice.taxCents === totals.taxCents;
}
function projectOnly(detail) {
  if(detail.item.kind==='inquiry')throw new HttpError(409,'Convert this inquiry to a project before managing invoices.');
  if(detail.item.projectDraft)throw new HttpError(409,'Complete customer details and consent before managing invoices.');
  return detail;
}
export function createInvoicingService({ repository, workRepository, provider, makeId = (operator, key) => `inv_${hash(`${operator.id}:${key}`).slice(0, 32)}` }) {
  async function load(id, operator) {
    owner(operator); workId(id); projectOnly(await workRepository.getWork(id, operator)); return repository.get(id);
  }
  async function persistInvoice(record, invoice) {
    const consistent = matches(record, invoice);
    return repository.finish(record.operationId, { state: consistent ? invoice.status === 'draft' ? 'draft' : 'linked' : 'needs_review', provider: invoice, errorCode: consistent ? null : 'invoice_review_required' });
  }
  return {
    get: load,
    async preview(input, operator) {
      owner(operator); const command = normalizeCommand(input), detail = projectOnly(await workRepository.getWork(command.workId, operator));
      if (detail.item.revision !== command.revision) throw new HttpError(409, 'Work changed. Reload and review confirmed billing.');
      await provider.getClient(command.billing.clientId);
      return { billing: command.billing, totals: calculateBilling(command.billing), dispatch: 'manual' };
    },
    async create(input, operator) {
      owner(operator); const command = normalizeCommand(input), detail = projectOnly(await workRepository.getWork(command.workId, operator));
      const existing = await repository.get(command.workId);
      if (!existing && detail.item.revision !== command.revision) throw new HttpError(409, 'Work changed. Reload and review confirmed billing.');
      const validatedClient = !existing ? await provider.getClient(command.billing.clientId) : undefined;
      const { record } = await repository.reserve({ workId: command.workId, revision: command.revision, actorId: operator.id,
        operationId: makeId(operator, command.idempotencyKey), payload: command.billing, payloadHash: hash(JSON.stringify(command.billing)) });
      if (!await repository.begin(record.operationId)) return repository.get(command.workId);
      let invoice;
      try { invoice = await provider.createDraft({ billing: record.payload, operationId: record.operationId, validatedClient }); }
      catch (error) {
        return repository.finish(record.operationId, { state: error.code === 'invoice_review_required' && error.invoice ? 'needs_review' : 'needs_reconciliation', provider: error.code === 'invoice_review_required' ? error.invoice ?? null : null,
          errorCode: ['invoice_client_invalid', 'invoicing_unconfigured', 'invoice_review_required'].includes(error.code) ? error.code : 'invoice_provider_unavailable' });
      }
      // A persistence failure here deliberately leaves 'creating'; subsequent requests never POST again.
      return persistInvoice(record, invoice);
    },
    async refresh(id, operator) {
      const record = await load(id, operator);
      if (!record?.provider?.id) throw new HttpError(409, 'Reconcile the invoice before refreshing payment status.');
      const invoice = await provider.getInvoice(record.provider.id);
      return persistInvoice(record, invoice);
    },
    async reconcile(id, operator) {
      const record = await load(id, operator);
      if (!record) throw new HttpError(404, 'No billing operation exists for this job.');
      if (record.provider?.id) return persistInvoice(record, await provider.getInvoice(record.provider.id));
      const matches = await provider.findByNumber(`3DP-${record.payload.date.slice(0, 4)}-${record.operationId}`);
      if (matches.length !== 1) return repository.finish(record.operationId, { state: 'needs_reconciliation', provider: null, errorCode: 'invoice_review_required' });
      return persistInvoice(record, matches[0]);
    }
  };
}
