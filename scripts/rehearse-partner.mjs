// Deployment rehearsal is restricted to an explicitly disposable native database.
import assert from 'node:assert/strict';
import { once } from 'node:events';
export function assertScratchEnvironment(env) {
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres'
      || url.username !== 'platform_app' || !/^\/platform_partner_rehearsal_[a-f0-9]{12}$/.test(url.pathname)
      || url.search || url.hash || (url.port && url.port !== '5432')
      || ['PARTNER_PROGRAM_ENABLED', 'PARTNER_CLASSIFICATION_APPROVED', 'PARTNER_ACCOUNTING_APPROVED']
        .some(key => env[key] !== '0')) throw new Error('A disabled disposable native environment is required.');
  return url;
}

export async function verifyNativeSchema({ pool, env }) {
  const url = assertScratchEnvironment(env);
  const { rows: [role] } = await pool.query(`SELECT current_database() AS database, current_user AS name,
    rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user`);
  assert.equal(role.database, url.pathname.slice(1));
  assert.equal(role.name, 'platform_app');
  for (const key of ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb']) assert.equal(role[key], false);
  const { rows: tables } = await pool.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_access,
    has_table_privilege(current_user,c.oid,'SELECT') AS readable,
    has_table_privilege(current_user,c.oid,'INSERT') AS insertable,
    has_table_privilege(current_user,c.oid,'UPDATE') AS updatable,
    has_table_privilege(current_user,c.oid,'DELETE') AS deletable
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
      AND starts_with(c.relname,'partner_')`);
  for (const name of ['partner_programs', 'partner_accounts', 'partner_sessions', 'partner_gigs', 'partner_outbox', 'partner_weekly_statements']) {
    assert.ok(tables.some(table => table.name === name));
  }
  for (const table of tables) {
    assert.equal(table.owned, false);
    assert.equal(table.public_access, false);
    assert.equal(table.readable, true);
    assert.equal(table.insertable, true);
    if (table.name !== 'partner_weekly_statements') assert.equal(table.rls, true);
    if (table.name !== 'partner_activity_sessions') assert.equal(table.deletable, false);
    if (['partner_payables', 'partner_payment_events', 'partner_agreement_issues', 'partner_weekly_statements'].includes(table.name)) {
      assert.equal(table.updatable, false);
    }
  }
  return { schema: true, leastPrivilege: true };
}

export async function rehearseDisabledRuntime({ database, env, programId }) {
  const { createPartnerRuntime } = await import('../lib/partner-outreach/runtime.js');
  const { createPartnerHandlers } = await import('../lib/partner-outreach/http.js');
  const { createPlatformServer } = await import('../lib/platform/api-server.js');
  const runtime = createPartnerRuntime({ database, env });
  const tx = { query: (...args) => database.query(...args) };
  const status = await runtime.app.approvals.status(tx, programId);
  assert.equal(status.program.synthetic, true);
  assert.equal(status.allowed, false);
  for (const gate of ['program_environment', 'classification_environment', 'accounting_environment']) {
    assert.ok(status.missing.includes(gate));
  }
  assert.equal(await runtime.app.approvals.canEnroll(tx, programId), false);
  await assert.rejects(database.withTransaction(t => runtime.app.approvals.requireActive(t, programId)), { status: 409 });
  await assert.rejects(runtime.auth.session('x'.repeat(43)), { status: 401 });
  await assert.rejects(runtime.app.read({ role: 'OWNER', id: 'synthetic-owner' }, 'programs'), { status: 401 });
  const partner = createPartnerHandlers({ getRuntime: () => runtime, env });
  const server = createPlatformServer({ ...partner, env: { PLATFORM_PROXY_SECRET: 'synthetic-rehearsal' }, ready: async () => {} });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (path, options) => {
      const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return { status: response.status, body: await response.json() };
    };
    const publicStatus = await get('/api/partner/v1/status');
    assert.equal(publicStatus.status, 200);
    assert.equal(publicStatus.body.invitationRequired, true);
    for (const path of ['/api/partner/v1/session', '/api/partner/v1/gigs', '/api/operator-partners']) {
      assert.equal((await get(path)).status, 401);
    }
    assert.equal((await get('/api/partner/v1/status', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await get('/api/partner/v1/commands', { method: 'POST', headers: {
      Origin: 'https://partners.3dprint4.me', 'Content-Type': 'application/json',
    }, body: '{}' })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  return { disabledProgram: true, sessionDenials: true, noMessagesSent: true };
}
