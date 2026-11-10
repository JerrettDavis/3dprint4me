// Rehearsal against real data with no writes: reads Invoice Ninja payments (GET) and a saved Spoolman
// spool list, runs the scheduled task in an in-memory PostgreSQL, and reports what it WOULD do.
// Usage: node scripts/bookkeeping-rehearse.mjs <spools.json> <matches.json> [YYYY-MM-DD today]
// All configuration comes from the environment (INVOICE_NINJA_TOKEN or INVOICE_NINJA_TOKEN_FILE,
// INVOICE_NINJA_PAYER_CLIENT_ID, EXPECTED_PAYMENT_*, BOOKKEEPING_UNPRICED_BASELINE_SPOOL_ID, SPOOLMAN_INSTANCE_ID).
import { readFile } from 'node:fs/promises';
import { createMigratedDatabase } from '../tests/support/pglite-neon.mjs';
import { splitStatements } from './migrate-neon.mjs';
import { normalizeSpoolmanSnapshot } from '../lib/spoolman/domain.js';
import { createBookkeepingScheduledTask } from '../lib/bookkeeping/runtime.js';
import { createPostgresBookkeepingRepository } from '../lib/bookkeeping/postgres-repository.js';
import { selectMatches } from './bookkeeping-seed.mjs';
import { supplyKey } from '../lib/bookkeeping/supply-sync.js';

const [spoolFile, matchFile, today = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
const instance = process.env.SPOOLMAN_INSTANCE_ID ?? 'default';
const spools = JSON.parse(await readFile(spoolFile, 'utf8'));
const snapshot = normalizeSpoolmanSnapshot({ instanceId: instance, currency: 'USD', spools });
const db = await createMigratedDatabase();
try {
  for (const s of splitStatements(await readFile(new URL('../neon/migrations/018_supply_ledger.sql', import.meta.url), 'utf8'))) await db.db.query(s);
  for (const item of snapshot.items) {
    await db.query`INSERT INTO filament_inventory(material,brand_line,color,active,source) VALUES(${item.material},${item.brandLine},${item.color},${item.active},${JSON.stringify(item.source)}::jsonb)`;
  }
  const repo = createPostgresBookkeepingRepository(db.query);
  for (const m of selectMatches(JSON.parse(await readFile(matchFile, 'utf8')), { confidence: ['price+name'] })) await repo.markSynced(supplyKey(instance, m.spool), m.expense);
  const created = [], alerts = [];
  const run = createBookkeepingScheduledTask({
    query: db.query, today: () => today, notify: async a => (alerts.push(a), true),
    env: { ...process.env, INVOICE_NINJA_TOKEN: process.env.INVOICE_NINJA_TOKEN ?? (process.env.INVOICE_NINJA_TOKEN_FILE ? (await readFile(process.env.INVOICE_NINJA_TOKEN_FILE, 'utf8')).trim() : undefined) },
    provider: { findByNumber: async () => null, createExpense: async p => (created.push(`${p.number} $${p.amountCents / 100} ${p.note}`), { id: 'DRYRUN' + p.spoolId }) }
  });
  console.log('result', JSON.stringify(await run()));
  console.log('payments mirrored from live Invoice Ninja:', (await repo.listPayments(process.env.EXPECTED_PAYMENT_PAYER)).map(p => `${p.date} $${p.amountCents / 100}`).join(', '));
  console.log('supply expenses it would create:', created.length); created.forEach(c => console.log('  ', c));
  console.log('alerts:', JSON.stringify(alerts.map(a => a.subject ?? a.type)));
} finally { await db.close?.(); }
