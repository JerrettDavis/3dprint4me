import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createNativeDatabase, nativePoolOptions } from '../../lib/database.js';
import { MIGRATIONS } from '../../scripts/migrate-neon.mjs';
import * as rehearsal from '../../scripts/rehearse-partner.mjs';

const IMAGE = 'postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const flags = { PARTNER_PROGRAM_ENABLED: '0', PARTNER_CLASSIFICATION_APPROVED: '0', PARTNER_ACCOUNTING_APPROVED: '0' };
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 90000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('release rehearsal proves native private grants and disabled HTTP behavior, then detects privilege drift', { timeout: 120000 }, async () => {
  assert.equal(typeof rehearsal.verifyNativeSchema, 'function', 'native schema probe is missing');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = '3dprint4me-partner-release-test-' + suffix;
  const dbName = 'platform_partner_rehearsal_' + suffix;
  let started = false, admin, appPool;
  try {
    docker('run', '--detach', '--rm', '--name', name, '--label', '3dprint4me.purpose=partner-release-test',
      '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=' + dbName, IMAGE);
    started = true;
    const port = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
    admin = new pg.Pool(nativePoolOptions(`postgresql://postgres@127.0.0.1:${port}/${dbName}`));
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { await admin.query('SELECT 1'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 250)); }
    }
    assert.equal(ready, true);
    await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; GRANT USAGE ON SCHEMA public TO platform_backend');
    for (const file of MIGRATIONS) await admin.query(await readFile(new URL('../../neon/migrations/' + file, import.meta.url), 'utf8'));
    const programId = randomUUID();
    await admin.query("INSERT INTO partner_programs(id,label,starts_on,synthetic) VALUES($1,'Synthetic disabled rehearsal','2026-10-01',true)", [programId]);
    appPool = new pg.Pool(nativePoolOptions(`postgresql://platform_app@127.0.0.1:${port}/${dbName}`));
    const env = { ...flags, DATABASE_URL: `postgresql://platform_app@postgres/${dbName}` };
    assert.deepEqual(await rehearsal.verifyNativeSchema({ pool: appPool, env }), { schema: true, leastPrivilege: true });
    assert.deepEqual(await rehearsal.rehearseDisabledRuntime({ database: createNativeDatabase({ pool: appPool }), env, programId }),
      { disabledProgram: true, sessionDenials: true, noMessagesSent: true });
    await admin.query('GRANT UPDATE ON partner_payables TO platform_backend');
    await assert.rejects(rehearsal.verifyNativeSchema({ pool: appPool, env }));
    await admin.query('REVOKE UPDATE ON partner_payables FROM platform_backend; GRANT SELECT ON partner_accounts TO PUBLIC');
    await assert.rejects(rehearsal.verifyNativeSchema({ pool: appPool, env }));
    await admin.query('REVOKE SELECT ON partner_accounts FROM PUBLIC; ALTER TABLE partner_accounts DISABLE ROW LEVEL SECURITY');
    await assert.rejects(rehearsal.verifyNativeSchema({ pool: appPool, env }));
  } finally {
    await appPool?.end();
    await admin?.end();
    if (started) docker('rm', '--force', name);
  }
});
