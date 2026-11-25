import { randomUUID } from 'node:crypto';
import { invoiceTrackingEvents, paymentTrackingEvents, presentInvoiceTracking } from './tracking-domain.js';
import { createInvoiceTrackingCommands, presentBillingTracking } from './tracking-commands.js';
import { HttpError } from '../http.js';

export function createInvoiceTrackingService({ repository, provider, workRepository, now = () => new Date() }) {
  const commands = createInvoiceTrackingCommands({ repository, workRepository, now });
  async function present(machine) {
    const [raw, links] = await Promise.all([repository.readTracking(), repository.linkedWorks()]);
    return presentBillingTracking(raw, { now: now(), machine, linkedWorks: links });
  }
  return {
    async read(actor) {
      if (!actor?.id || actor.role !== 'owner' || actor.enabled === false) throw new HttpError(403, 'Only an enabled owner can manage billing.');
      const [model, events] = await Promise.all([present(false), repository.listEvents({ pendingOnly: true })]);
      return { ...model, delivery: events.filter(event => ['failed', 'pending', 'leased'].includes(event.deliveryState))
        .map(event => ({ id: event.id, kind: event.payload.kind, state: event.deliveryState, attempts: event.attempts })) };
    },
    machineSnapshot: () => present(true),
    execute: (input, actor) => commands.execute(input, actor),
    async advanceTax() {
      return repository.advanceTax({ now: now().toISOString() });
    },
    async sync() {
      const token = randomUUID();
      const claim = await repository.claimSync({ token, now: now().toISOString(), leaseMs: 180000 });
      if (!claim) return { status: 'busy' };
      let category = 'provider_unavailable';
      try {
        const snapshot = await provider.readSnapshot();
        if (!snapshot?.source || !Array.isArray(snapshot.invoices) || !Array.isArray(snapshot.allocations)) throw new TypeError('Invalid billing snapshot.');
        const previous = claim.snapshot;
        if (previous && (previous.source.companyId !== snapshot.source.companyId || previous.source.groupId !== snapshot.source.groupId)) {
          category = 'source_changed'; throw new TypeError('Billing source changed.');
        }
        const events = [];
        if (previous) {
          const invoices = new Map(previous.invoices.map(row => [row.id, row]));
          const allocations = new Map(previous.allocations.map(row => [row.id, row]));
          const priorRows = new Map(presentInvoiceTracking(previous.invoices, { now: new Date(claim.lastSuccessfulAt), timeZone: claim.settings.timeZone }).rows.map(row => [row.id, row]));
          const currentRows = presentInvoiceTracking(snapshot.invoices, { now: now(), timeZone: claim.settings.timeZone }).rows;
          for (const invoice of currentRows) {
            if (invoice.overdue && !priorRows.get(invoice.id)?.overdue) {
              const dueDate = invoice.status === 'partially_paid' ? invoice.partialDueDate ?? invoice.dueDate : invoice.dueDate;
              events.push({ id: `${invoice.id}:invoice_overdue:${dueDate}`, kind: 'invoice_overdue', invoiceId: invoice.id, dueDate, occurredAt: now().toISOString() });
            }
          }
          for (const invoice of snapshot.invoices) {
            // A new invoice arriving after the initial baseline can already be opened.
            events.push(...invoiceTrackingEvents(invoices.get(invoice.id) ?? { id: invoice.id, viewedAt: null, openedAt: null }, invoice));
          }
          for (const allocation of snapshot.allocations) events.push(...paymentTrackingEvents(allocations.get(allocation.id) ?? null, allocation));
        }
        const saved = await repository.commitSnapshot({ token, now: now().toISOString(), snapshot, events });
        return { status: saved ? 'synced' : 'superseded' };
      } catch {
        await repository.recordSyncFailure({ token, now: now().toISOString(), category });
        return { status: 'unavailable' };
      }
    }
  };
}
