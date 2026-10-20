import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createLocalInvoiceRepository } from '../../lib/invoicing/local-repository.js';
import { createNeonInvoiceRepository } from '../../lib/invoicing/repository.js';
import { billingFixture, workFixture, invoiceFixture } from '../fixtures/billing.mjs';

for (const kind of ['local', 'postgres']) {
  test(`${kind}: durable exclusive claim, payload conflict, dispatch and reconciliation states`, async () => {
    let repo, reopen, cleanup, database;
    if (kind === 'local') {
      const dir = await mkdtemp(join(tmpdir(), '3dp-invoice-'));
      const options = { path: join(dir, 'billing.json'), getWork: async () => workFixture };
      repo = createLocalInvoiceRepository(options); reopen = () => createLocalInvoiceRepository(options);
      cleanup = () => rm(dir, { recursive: true, force: true });
    } else {
      const db = new PGlite();
      database = db;
      await db.exec("CREATE TABLE operators(id text PRIMARY KEY, enabled boolean, role text); CREATE TABLE work_items(id text PRIMARY KEY, revision integer); INSERT INTO operators VALUES ('operator123', true, 'owner'); INSERT INTO work_items VALUES ('work_example123', 1);");
      await db.exec(await readFile(new URL('../../neon/migrations/007_invoicing.sql', import.meta.url), 'utf8'));
      const query = async (parts, ...values) => (await db.query(parts.reduce((s, part, index) => s + (index ? `$${index}` : '') + part, ''), values)).rows;
      repo = createNeonInvoiceRepository({ query }); reopen = () => createNeonInvoiceRepository({ query }); cleanup = () => db.close();
    }
    try {
      const input = { workId: 'work_example123', revision: 1, operationId: 'operation123', actorId: 'operator123', payload: billingFixture(), payloadHash: 'a'.repeat(64) };
      assert.equal(await repo.get(input.workId), null);
      const claims = await Promise.all([repo.reserve(input), reopen().reserve(input)]);
      assert.equal(claims.filter(r => r.created).length, 1);
      assert.equal(claims[0].record.operationId, claims[1].record.operationId);
      await assert.rejects(repo.reserve({ ...input, payloadHash: 'b'.repeat(64) }), { status: 409 });
      const dispatches = await Promise.all([repo.begin(input.operationId), reopen().begin(input.operationId)]);
      assert.equal(dispatches.filter(Boolean).length, 1);
      assert.equal((await reopen().get(input.workId)).state, 'creating');
      await repo.finish(input.operationId, { state: 'needs_reconciliation', provider: null, errorCode: 'invoice_provider_unavailable' });
      assert.equal((await repo.get(input.workId)).state, 'needs_reconciliation');
      assert.equal(await repo.begin(input.operationId), false);
      await repo.finish(input.operationId, { state: 'draft', provider: invoiceFixture, errorCode: null });
      const saved = await reopen().get(input.workId);
      assert.equal(saved.provider.id, 'invoice123'); assert.deepEqual(saved.payload, billingFixture());
      assert.equal(saved.state, 'draft'); assert.ok(saved.updatedAt);
      if (database) {
        await assert.rejects(database.exec("UPDATE invoice_operations SET payload = '{}'::jsonb"), /immutable/);
        const rls = await database.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'invoice_operations'");
        assert.equal(rls.rows[0].relrowsecurity, true);
        await database.exec('CREATE ROLE invoice_browser; SET ROLE invoice_browser;');
        await assert.rejects(database.exec('SELECT * FROM invoice_operations'), /permission denied/);
        await database.exec('RESET ROLE;');
      }
    } finally { await cleanup(); }
  });
}
