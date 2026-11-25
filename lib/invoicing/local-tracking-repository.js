import { readFile, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { HttpError } from '../http.js';
import { createInvoiceTrackingRepository } from './tracking-repository.js';
// Loopback development only: uses the same SQL/transaction implementation as native
// production. The work projection is refreshed from the local work store per command.
export async function createLocalInvoiceTrackingRepository({ path, getWork, invoicePath } = {}) {
  if (!path || typeof getWork !== 'function') throw new TypeError('Private local billing storage and work lookup are required.');
  const target = resolve(path);
  for (const output of ['public', 'operator', 'partner', 'status']) {
    const rel = relative(resolve(output), target);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(':'))) throw new TypeError('Billing storage must remain outside browser output.');
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(target);
  await db.exec('CREATE TABLE IF NOT EXISTS work_items(id text PRIMARY KEY, revision integer); CREATE TABLE IF NOT EXISTS invoice_operations(work_item_id text, provider jsonb);');
  await db.exec(await readFile(new URL('../../neon/migrations/020_invoice_tracking.sql', import.meta.url), 'utf8'));
  const queryFor = connection => async (parts, ...values) => (await connection.query(parts.reduce((sql, part, i) => sql + (i ? `$${i}` : '') + part, ''), values)).rows;
  const database = { query: queryFor(db), withTransaction: operation => db.transaction(tx => operation({ query: queryFor(tx) })) };
  const repository = createInvoiceTrackingRepository({ database });
  return { ...repository,
    async linkedWorks() {
      if (!invoicePath) return [];
      try {
        const data = JSON.parse(await readFile(invoicePath, 'utf8'));
        return data.records.filter(row => row.provider?.id).map(row => ({ workId: row.workId, invoiceId: row.provider.id }));
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async command(input) {
      if (input.work) {
        const work = await getWork(input.work.id);
        if (work?.item?.revision !== input.work.revision) throw new HttpError(409, 'The project changed. Reload and review billing.');
        await db.query('INSERT INTO work_items(id,revision) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision', [input.work.id, input.work.revision]);
      }
      return repository.command(input);
    },
    close: () => db.close()
  };
}
