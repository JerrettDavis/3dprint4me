import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('disabled worker does not inspect provider configuration or claim a job', () => {
  const result = spawnSync(process.execPath, ['scripts/catalogue-worker.mjs', '--once'], { encoding: 'utf8', env: { ...process.env, CATALOGUE_WORKER_ENABLED: '0', DATABASE_DRIVER: 'invalid', DATABASE_URL: 'PRIVATE CREDENTIAL' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /disabled/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE CREDENTIAL/);
});

test('enabled worker fails safely when native persistent storage is unavailable', () => {
  const result = spawnSync(process.execPath, ['scripts/catalogue-worker.mjs', '--once'], { encoding: 'utf8', env: { ...process.env, CATALOGUE_WORKER_ENABLED: '1', DATABASE_DRIVER: 'postgres', DATABASE_URL: '' } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /at |Error:|postgresql:\/\//);
  assert.match(result.stdout + result.stderr, /not configured/);
});
