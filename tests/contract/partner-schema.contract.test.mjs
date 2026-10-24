import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements, assertMigrationTarget } from '../../scripts/migrate-neon.mjs';

const program = '10000000-0000-4000-8000-000000000001';
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const campaign = '30000000-0000-4000-8000-000000000001';
const gig = '40000000-0000-4000-8000-000000000001';

test('partner migration is repeatable, private, ownership-linked and preserves financial/legal evidence', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE platform_backend NOLOGIN; CREATE ROLE partner_visitor NOLOGIN');
    const sql = await readFile(new URL('../../neon/migrations/012_partner_outreach.sql', import.meta.url), 'utf8');
    for (let n = 0; n < 2; n++) for (const statement of splitStatements(sql)) await db.query(statement);
    await db.query('INSERT INTO partner_programs(id,label,starts_on) VALUES ($1,$2,$3)', [program,'Synthetic','2026-10-01']);
    const defaults = (await db.query('SELECT enabled, default_weekly_cap_cents, max_weekly_cap_cents FROM partner_programs')).rows[0];
    assert.deepEqual(defaults, { enabled: false, default_weekly_cap_cents: 20000, max_weekly_cap_cents: 40000 });
    await assert.rejects(db.query('UPDATE partner_programs SET default_weekly_cap_cents=40001'), e => e.code === '23514');
    for (const id of [a,b]) await db.query('INSERT INTO partner_accounts(id,program_id,display_name) VALUES ($1,$2,$3)',[id,program,'Synthetic']);
    await db.query('INSERT INTO partner_campaigns(id,program_id,title,terms) VALUES ($1,$2,$3,$4)',[campaign,program,'Campaign','{}']);
    await db.query('INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot) VALUES ($1,$2,$3,$4,$5)',[gig,program,a,campaign,'{}']);
    await assert.rejects(db.query('INSERT INTO partner_visits(id,gig_id,partner_id,client_created_id,business_name,business_key,outcome,visited_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',['50000000-0000-4000-8000-000000000001',gig,b,'60000000-0000-4000-8000-000000000001','Business','business','introduction']), e => e.code === '23503');
    const payable = '70000000-0000-4000-8000-000000000001';
    await db.query('INSERT INTO partner_payables(id,partner_id,gig_id,amount_cents) VALUES ($1,$2,$3,$4)',[payable,a,gig,5000]);
    await assert.rejects(db.query('UPDATE partner_payables SET amount_cents=0'), /immutable/i);
    await assert.rejects(db.query('DELETE FROM partner_payables'), /immutable/i);
    await db.query('INSERT INTO partner_legal_documents(id,template_key,title) VALUES ($1,$2,$3)',['80000000-0000-4000-8000-000000000001','work-order','Work order']);
    await db.query('INSERT INTO partner_legal_versions(id,document_id,version_no,markdown,variables_schema,content_sha256,authored_by) VALUES ($1,$2,1,$3,$4,$5,$6)',['90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','DRAFT','{}','a'.repeat(64),'owner']);
    await assert.rejects(db.query("UPDATE partner_legal_versions SET markdown='changed'"), /immutable/i);
    await db.exec('SET ROLE platform_backend');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_accounts')).rows[0].n,2);
    await assert.rejects(db.query('DELETE FROM partner_accounts'), e => e.code === '42501');
    await db.exec('RESET ROLE; SET ROLE partner_visitor');
    for (const table of ['partner_accounts','partner_sessions','partner_leads','partner_payables','partner_legal_versions','partner_audit_events']) await assert.rejects(db.query('SELECT * FROM '+table), e => e.code === '42501');
  } finally { await db.close(); }
});

test('partner migration refuses retired or non-native targets',()=>{
 assert.throws(()=>assertMigrationTarget('012_partner_outreach.sql',{driver:'neon',url:'https://old.neon.tech'}),/native PostgreSQL/);
 assert.throws(()=>assertMigrationTarget('012_partner_outreach.sql',{driver:'postgres',url:'postgresql://role@old.neon.tech/db'}),/native PostgreSQL/);
 assert.doesNotThrow(()=>assertMigrationTarget('012_partner_outreach.sql',{driver:'postgres',url:'postgresql://role@localhost/db'}));
});
