import { createPostgresBookkeepingRepository } from './postgres-repository.js';
import { createInvoiceNinjaExpenses } from './invoice-ninja-expenses.js';
import { createInvoiceNinjaPayments } from './invoice-ninja-payments.js';
import { createSpoolmanKeyWriter } from './spoolman-key-writer.js';
import { createSupplySync } from './supply-sync.js';
import { reconcilePayments, DEFAULT_TIMING } from './expected-payments.js';

async function sendAlertEmail({ subject, lines, env, fetchImpl }) {
  if (!env.RESEND_API_KEY || !env.REQUEST_TO_EMAIL || !env.REQUEST_FROM_EMAIL) return false;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.REQUEST_FROM_EMAIL, to: [env.REQUEST_TO_EMAIL], subject, html: `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` })
  });
  return res.ok;
}

export function createBookkeepingScheduledTask({ query, env = process.env, fetchImpl = fetch, today = () => new Date().toISOString().slice(0, 10), provider, notify, keyWriter, payments } = {}) {
  const repository = createPostgresBookkeepingRepository(query);
  const send = notify ?? (a => sendAlertEmail({ ...a, env, fetchImpl }));
  const baseline = Number.parseInt(env.BOOKKEEPING_UNPRICED_BASELINE_SPOOL_ID ?? '0', 10) || 0;
  return async () => {
    const result = { claimed: 0 };
    // Supplies: only when Invoice Ninja expenses are explicitly enabled.
    if (env.INVOICE_NINJA_EXPENSES_ENABLED === '1' || provider) {
      const sync = createSupplySync({
        provider: provider ?? createInvoiceNinjaExpenses({ token: env.INVOICE_NINJA_TOKEN, categoryId: env.INVOICE_NINJA_SUPPLIES_CATEGORY_ID, fetchImpl }), repository, baselineSpoolId: baseline,
        keyWriter: keyWriter ?? (env.SPOOLMAN_WRITE_KEYS === '1' ? createSpoolmanKeyWriter({ baseUrl: env.SPOOLMAN_BASE_URL, hostHeader: env.SPOOLMAN_HOST_HEADER, fetchImpl }) : null),
        notify: ({ spools }) => send({ subject: `${spools.length} Spoolman spool(s) have no price`, lines: spools.map(s => `Spool #${s.spoolId}: ${s.label}`) })
      });
      const r = await sync(await repository.listSpoolItems());
      Object.assign(result, r, { claimed: 1 });
      if (r.failed) result.errors = r.failed;
    }
    // Mirror completed Invoice Ninja payments for the payer's client into the received log.
    if (payments || (env.INVOICE_NINJA_TOKEN && env.INVOICE_NINJA_PAYER_CLIENT_ID && env.EXPECTED_PAYMENT_PAYER)) {
      const source = payments ?? createInvoiceNinjaPayments({ token: env.INVOICE_NINJA_TOKEN, fetchImpl });
      for (const p of await source.listCompleted(env.INVOICE_NINJA_PAYER_CLIENT_ID)) {
        await repository.recordPayment({ payer: env.EXPECTED_PAYMENT_PAYER, receivedOn: p.date, amountCents: p.amountCents, paymentId: p.id });
      }
      result.claimed = 1;
    }
    // Payments: gap detection needs the first check date; absent means not configured.
    const anchor = env.EXPECTED_PAYMENT_ANCHOR;
    const cents = Number.parseInt(env.EXPECTED_PAYMENT_CENTS ?? '', 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(anchor ?? '') && env.EXPECTED_PAYMENT_PAYER && cents > 0) {
      const schedule = { ...DEFAULT_TIMING, payer: env.EXPECTED_PAYMENT_PAYER, amountCents: cents };
      const rec = reconcilePayments({ schedule, anchor, payments: await repository.listPayments(schedule.payer), today: today() });
      for (const a of rec.alerts) {
        const key = `payment:${schedule.payer}:${a.date}:${a.status}`;
        if (!await repository.claimAlert(key)) continue;
        let sent = false;
        try { sent = await send({ subject: `${schedule.payer} payment ${a.status === 'missing' ? 'not recorded' : 'amount differs'} for ${a.date}`, lines: [`Expected $${(a.expectedCents / 100).toFixed(2)} around ${a.date}.`, a.status === 'missing' ? 'No payment recorded within the grace period.' : `Recorded $${(a.amountCents / 100).toFixed(2)} on ${a.paid}.`] }); } catch { /* released below */ }
        if (!sent) await repository.releaseAlert(key);
      }
      result.paymentAlerts = rec.alerts.length;
    }
    return result;
  };
}
