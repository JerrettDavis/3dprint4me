import { randomUUID } from 'node:crypto';
const titles = { invoice_opened: 'Invoice email opened', invoice_viewed: 'Invoice viewed', invoice_payment: 'Invoice payment received', invoice_overdue: 'Invoice overdue',
  invoice_refund: 'Invoice refund recorded', invoice_payment_adjusted: 'Invoice payment adjusted', tax_filing_due: 'OKTAP filing reminder', tax_payment_due: 'OKTAP payment reminder' };
const unavailable = () => new Error('Billing notification delivery is temporarily unavailable.');
export function createHomeAssistantBillingDelivery({ origin, token, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!origin || !token) return { configured: false };
  let url;
  try { url = new URL(origin); } catch { throw new TypeError('A valid HTTPS Home Assistant origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('A valid HTTPS Home Assistant origin and private delivery credential are required.');
  }
  const endpoint = `${url.origin}/api/services/persistent_notification/create`;
  return { configured: true, async send(event) {
    if (!/^[a-f0-9]{64}$/.test(event?.id) || !titles[event?.payload?.kind]) throw unavailable();
    const title = `3dprint4.me: ${titles[event.payload.kind]}`;
    const message = event.payload.kind.startsWith('tax_')
      ? 'Review the reporting period and acknowledge filing and payment separately in [Billing](https://work.3dprint4.me/?view=billing).'
      : 'Review the latest invoice activity in [Billing](https://work.3dprint4.me/?view=billing).';
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: `3dprint4me_billing_${event.id}`, title, message }) });
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw unavailable();
    } catch { throw unavailable(); }
  } };
}
export async function drainBillingEvents({ repository, delivery, now = () => new Date() }) {
  if (!delivery?.configured) return { status: 'unconfigured', delivered: 0 };
  const token = randomUUID();
  const events = await repository.claimEvents({ token, now: now().toISOString(), leaseMs: 180000, limit: 10 });
  let delivered = 0, failed = 0, retrying = 0;
  for (const event of events) {
    let succeeded = false;
    try { await delivery.send(event); succeeded = true; } catch { /* Private provider errors never enter the outbox. */ }
    const at = now();
    const retryAt = succeeded || event.attempts >= 8 ? null : new Date(at.getTime() + Math.min(3600000, 15000 * 2 ** (event.attempts - 1))).toISOString();
    const saved = await repository.finishEvent({ id: event.id, token, now: at.toISOString(), delivered: succeeded, retryAt });
    if (saved && succeeded) delivered++;
    if (saved && !succeeded) { if (retryAt) retrying++; else failed++; }
  }
  return { status: 'processed', claimed: events.length, delivered, failed, retrying };
}
