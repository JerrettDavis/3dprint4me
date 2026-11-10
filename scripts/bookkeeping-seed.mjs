// Seeds the supply ledger from an owner-reviewed spool-to-expense match list so existing receipt
// expenses are never duplicated by the Spoolman sync. Dry run unless --apply is passed.
// Usage: node scripts/bookkeeping-seed.mjs <matches.json> [--instance <id>] [--confidence price+name] [--apply]
import { readFile } from 'node:fs/promises';
import { closeDatabase, queryDatabase as sql } from '../lib/database.js';
import { createPostgresBookkeepingRepository } from '../lib/bookkeeping/postgres-repository.js';
import { createSpoolmanKeyWriter } from '../lib/bookkeeping/spoolman-key-writer.js';
import { supplyKey } from '../lib/bookkeeping/supply-sync.js';

export function selectMatches(rows, { confidence } = {}) {
  const seenSpool = new Set(), seenExpense = new Set(), out = [];
  for (const r of rows) {
    if (!Number.isSafeInteger(r.spool) || !/^[A-Za-z0-9]{4,64}$/.test(r.expense ?? '')) continue;
    if (confidence && !confidence.includes(r.confidence)) continue;
    if (seenSpool.has(r.spool) || seenExpense.has(r.expense)) throw new Error(`Duplicate match for spool ${r.spool} or expense ${r.expense}.`);
    seenSpool.add(r.spool); seenExpense.add(r.expense); out.push(r);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
  const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  if (!file) throw new Error('A matches file is required.');
  const instance = opt('instance') ?? process.env.SPOOLMAN_INSTANCE_ID ?? 'default';
  const confidence = opt('confidence')?.split(',');
  const matches = selectMatches(JSON.parse(await readFile(file, 'utf8')), { confidence });
  console.log(`${matches.length} matches selected${confidence ? ` (${confidence.join(', ')})` : ''}.`);
  if (!args.includes('--apply')) { console.log('Dry run; pass --apply to write the ledger.'); return; }
  const repo = createPostgresBookkeepingRepository(sql);
  const writer = createSpoolmanKeyWriter({ baseUrl: process.env.SPOOLMAN_BASE_URL, hostHeader: process.env.SPOOLMAN_HOST_HEADER });
  let keyed = 0;
  for (const m of matches) {
    await repo.markSynced(supplyKey(instance, m.spool), m.expense);
    try { await writer.setExpenseId(m.spool, m.expense); keyed++; } catch { /* ledger is authoritative; retry later */ }
  }
  console.log(`Ledger seeded for ${matches.length} spools; ${keyed} Spoolman keys written.`);
}
if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('bookkeeping-seed.mjs')) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => closeDatabase());
}
