import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('partner release archives and SSH boundary reject unsafe or uncommitted inputs', () => {
  const result = spawnSync('python', ['tests/support/partner_release_checks.py'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 120000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('host entry rejects an invalid payload with a sanitized nonzero exit', () => {
  const result = spawnSync('python', ['deploy/platform/partner-release-host.py'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 10000,
    input: '{"archive":"private-sentinel"}', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /private-sentinel|Traceback/);
});

test('explicit deploy requires fresh backup custody before archiving or SSH', () => {
  const result = spawnSync('python', ['deploy/platform/release-partner.py', '--release', 'f'.repeat(40), '--phase', 'deploy'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--backup-config/);
});
