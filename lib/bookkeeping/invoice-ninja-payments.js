// Read-only: completed Invoice Ninja payments for one client, mirrored into the received-check log.
const HOST = 'https://invoicing.co/api/v1/';
const ID = /^[A-Za-z0-9]{4,64}$/;
export class PaymentProviderError extends Error {
  constructor() { super('Invoice Ninja payment read failed.'); this.name = 'PaymentProviderError'; }
}

export function createInvoiceNinjaPayments({ token = process.env.INVOICE_NINJA_TOKEN, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  return {
    async listCompleted(clientId) {
      if (!token?.trim() || !ID.test(clientId ?? '')) throw new PaymentProviderError();
      let body;
      try {
        const res = await fetchImpl(`${HOST}payments?${new URLSearchParams({ client_id: clientId, per_page: '50', sort: 'date|desc' })}`, {
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'application/json', 'X-API-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) throw new PaymentProviderError();
        body = await res.json();
      } catch { throw new PaymentProviderError(); }
      if (!Array.isArray(body?.data)) throw new PaymentProviderError();
      // status 4 = completed; deleted, pending, failed and refunded rows do not count as received.
      return body.data
        .filter(p => ID.test(p.id) && p.client_id === clientId && !p.is_deleted && !p.archived_at && Number(p.status_id) === 4 && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number(p.amount) > 0 && Number(p.refunded ?? 0) === 0)
        .map(p => ({ id: p.id, date: p.date, amountCents: Math.round(Number(p.amount) * 100) }));
    }
  };
}
