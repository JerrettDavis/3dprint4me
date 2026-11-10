// Pure expected-payment schedule and gap detection. Independent of how payments are ingested
// (manual entry, bank CSV, email), so a missing biweekly check is detected whatever the source.
const DAY = 86400000;
const iso = /^\d{4}-\d{2}-\d{2}$/;
const toMs = d => { if (!iso.test(d)) throw new TypeError('Dates must be YYYY-MM-DD.'); return Date.parse(`${d}T00:00:00Z`); };
const fmt = ms => new Date(ms).toISOString().slice(0, 10);

/** Timing defaults only. The payer name and amount are private configuration (see runtime.js). */
export const DEFAULT_TIMING = Object.freeze({ everyDays: 14, graceDays: 5 });

/** Expected dates from anchor through `through`, inclusive. */
export function expectedDates({ anchor, everyDays = 14 }, through) {
  if (!Number.isInteger(everyDays) || everyDays < 1) throw new TypeError('everyDays must be a positive integer.');
  const start = toMs(anchor), end = toMs(through), out = [];
  for (let t = start; t <= end; t += everyDays * DAY) out.push(fmt(t));
  return out;
}

/**
 * Match recorded payments ({date, amountCents}) to expected dates. A payment matches the nearest
 * unmatched expectation within +/- grace days. A period is "missing" only after date + grace has
 * passed; otherwise it is "upcoming" (only the next period within grace is listed).
 */
export function reconcilePayments({ schedule, anchor, payments, today }) {
  const grace = schedule.graceDays * DAY, now = toMs(today);
  const periods = expectedDates({ anchor, everyDays: schedule.everyDays }, fmt(now + schedule.everyDays * DAY)).filter(d => toMs(d) - grace <= now);
  const pool = payments.map((p, i) => ({ ...p, i, ms: toMs(p.date) })).sort((a, b) => a.ms - b.ms), used = new Set();
  const rows = periods.map(date => {
    const ms = toMs(date);
    const hit = pool.filter(p => !used.has(p.i) && Math.abs(p.ms - ms) <= grace)
      .sort((a, b) => Math.abs(a.ms - ms) - Math.abs(b.ms - ms))[0];
    if (hit) {
      used.add(hit.i);
      return { date, status: hit.amountCents === schedule.amountCents ? 'received' : 'amount_mismatch', paid: hit.date, amountCents: hit.amountCents, expectedCents: schedule.amountCents };
    }
    return { date, status: now > ms + grace ? 'missing' : 'upcoming', expectedCents: schedule.amountCents };
  });
  return { payer: schedule.payer, periods: rows, unexpected: pool.filter(p => !used.has(p.i)).map(({ date, amountCents }) => ({ date, amountCents })), alerts: rows.filter(r => r.status === 'missing' || r.status === 'amount_mismatch') };
}
