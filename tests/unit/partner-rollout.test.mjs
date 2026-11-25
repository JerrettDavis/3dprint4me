import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('partner rollout and admitted resume preserve data, historical failures and guarded handover', () => {
  const result = spawnSync('python', ['tests/support/partner_rollout_checks.py'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 120000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
