// PostgreSQL adapter for the supply ledger, received payments and alert de-duplication.
export function createPostgresBookkeepingRepository(query) {
  return {
    async loadLedger() {
      const rows = await query`SELECT key, status, expense_id, alerted_at FROM supply_ledger`;
      return new Map(rows.map(r => [r.key, { status: r.status, expenseId: r.expense_id, alertedAt: r.alerted_at }]));
    },
    async markSynced(key, expenseId) {
      await query`INSERT INTO supply_ledger(key,status,expense_id) VALUES(${key},'synced',${expenseId})
        ON CONFLICT(key) DO UPDATE SET status='synced', expense_id=EXCLUDED.expense_id, updated_at=now()`;
    },
    async markAlerted(key) {
      await query`INSERT INTO supply_ledger(key,status,alerted_at) VALUES(${key},'pending',now())
        ON CONFLICT(key) DO UPDATE SET alerted_at=COALESCE(supply_ledger.alerted_at, now()), updated_at=now()`;
    },
    /** Imported, active Spoolman rows in the normalized shape planSupplySync expects. */
    async listSpoolItems() {
      const rows = await query`SELECT brand_line, color, active, source FROM filament_inventory WHERE source IS NOT NULL LIMIT 5001`;
      if (rows.length > 5000) throw new Error('Inventory too large.');
      return rows.map(r => ({ brandLine: r.brand_line, color: r.color, active: r.active, source: r.source }));
    },
    async listPayments(payer) {
      const rows = await query`SELECT to_char(received_on,'YYYY-MM-DD') AS date, amount_cents FROM expected_payment_receipts WHERE payer=${payer} ORDER BY received_on DESC LIMIT 200`;
      return rows.map(r => ({ date: r.date, amountCents: r.amount_cents }));
    },
    async recordPayment({ payer, receivedOn, amountCents, paymentId = null }) {
      await query`INSERT INTO expected_payment_receipts(payer,received_on,amount_cents,invoice_ninja_payment_id) VALUES(${payer},${receivedOn},${amountCents},${paymentId})
        ON CONFLICT(payer,received_on) DO UPDATE SET amount_cents=EXCLUDED.amount_cents, invoice_ninja_payment_id=COALESCE(EXCLUDED.invoice_ninja_payment_id, expected_payment_receipts.invoice_ninja_payment_id)`;
    },
    /** True only the first time a key is claimed, so each alert is delivered once. */
    async claimAlert(key) {
      const rows = await query`INSERT INTO bookkeeping_alerts(key) VALUES(${key}) ON CONFLICT DO NOTHING RETURNING key`;
      return rows.length === 1;
    },
    async releaseAlert(key) { await query`DELETE FROM bookkeeping_alerts WHERE key=${key}`; }
  };
}
