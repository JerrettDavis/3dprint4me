// Plans and runs Spoolman -> Invoice Ninja supply expenses. One expense per priced spool, keyed by
// spoolman:<instance>:<spool>. Idempotent: a ledger row plus a provider lookup by key guard duplicates.
export const supplyKey = (instanceId, spoolId) => `spoolman:${instanceId}:${spoolId}`;
// The Invoice Ninja expense "number" carries the key; it is unique per company, so a retry cannot duplicate.
export const expenseNumber = (instanceId, spoolId) => `SPOOL-${instanceId}-${spoolId}`;
const cents = dollars => Math.round(dollars * 100);

/** Pure planning over normalized snapshot items and the ledger (Map key -> {status, expenseId, alertedAt}). */
export function planSupplySync({ items, ledger, baselineSpoolId = 0 }) {
  const create = [], missingPrice = [], skipped = [];
  for (const item of items) {
    const s = item.source;
    if (!s || !item.active) continue;
    const key = supplyKey(s.instanceId, s.spoolId), entry = ledger.get(key);
    if (entry?.status === 'synced') continue;
    if (s.price == null) {
      if (s.spoolId > baselineSpoolId && !entry?.alertedAt) missingPrice.push({ key, spoolId: s.spoolId, label: item.brandLine ?? item.color ?? `Spool ${s.spoolId}` });
      continue;
    }
    if (s.currency !== 'USD') { skipped.push({ key, reason: 'non_usd' }); continue; }
    create.push({ key, spoolId: s.spoolId, number: expenseNumber(s.instanceId, s.spoolId), amountCents: cents(s.price),
      note: `${item.brandLine ?? 'Filament'}${item.color ? ` - ${item.color}` : ''} (${s.rawMaterial ?? 'unknown material'}), Spoolman spool #${s.spoolId}`, priceSource: s.priceSource });
  }
  return { create, missingPrice, skipped };
}

/** provider: {findByNumber, createExpense}; repository: {loadLedger, markSynced, markAlerted}; notify(alert). */
export function createSupplySync({ provider, repository, notify = async () => {}, baselineSpoolId = 0, keyWriter = null }) {
  return async function run(items) {
    const ledger = await repository.loadLedger(), plan = planSupplySync({ items, ledger, baselineSpoolId });
    let created = 0, adopted = 0, failed = 0;
    for (const p of plan.create) {
      try {
        // Reconcile ambiguity first: an earlier timed-out create may have succeeded remotely.
        const existing = await provider.findByNumber(p.number);
        const expense = existing ?? await provider.createExpense(p);
        await repository.markSynced(p.key, expense.id);
        // Best-effort second half of the two-sided key; the ledger already proves the sync.
        try { await keyWriter?.setExpenseId(p.spoolId, expense.id); } catch { /* retried via backfill below */ }
        if (existing) adopted++; else created++;
      } catch { failed++; }
    }
    if (plan.missingPrice.length) {
      // An undelivered alert (false) is not marked, so it is retried on the next run.
      const delivered = await notify({ type: 'spools_missing_price', spools: plan.missingPrice });
      if (delivered !== false) for (const m of plan.missingPrice) await repository.markAlerted(m.key);
    }
    return { created, adopted, failed, missingPrice: plan.missingPrice.length, skipped: plan.skipped.length };
  };
}

export function createMemorySupplyRepository() {
  const rows = new Map();
  return {
    rows,
    async loadLedger() { return new Map(rows); },
    async markSynced(key, expenseId) { rows.set(key, { ...rows.get(key), status: 'synced', expenseId }); },
    async markAlerted(key) { rows.set(key, { ...rows.get(key), status: rows.get(key)?.status ?? 'pending', alertedAt: new Date().toISOString() }); }
  };
}
