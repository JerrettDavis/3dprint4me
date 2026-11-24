import { randomUUID } from 'node:crypto';
import { invoiceTrackingEvents, paymentTrackingEvents } from './tracking-domain.js';

export function createInvoiceTrackingService({ repository, provider, now = () => new Date() }) {
  return {
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
