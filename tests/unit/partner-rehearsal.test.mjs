import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerFixture } from '../support/partner-fixture.mjs';

const flags = { PARTNER_PROGRAM_ENABLED: '0', PARTNER_CLASSIFICATION_APPROVED: '0', PARTNER_ACCOUNTING_APPROVED: '0' };

test('native partner rehearsal refuses live databases, other hosts and enabled flags before connecting', async () => {
  let module;
  try { module = await import('../../scripts/rehearse-partner.mjs'); } catch {}
  assert.ok(module?.assertScratchEnvironment, 'scratch-only rehearsal entry is missing');
  const valid = { ...flags, DATABASE_URL: 'postgresql://platform_app:synthetic@postgres/platform_partner_rehearsal_a1b2c3d4e5f6' };
  assert.doesNotThrow(() => module.assertScratchEnvironment(valid));
  for (const DATABASE_URL of [
    'postgresql://platform_app:synthetic@postgres/platform_live_example',
    'postgresql://platform_app:synthetic@remote/platform_partner_rehearsal_a1b2c3d4e5f6',
    'postgresql://platform_owner:synthetic@postgres/platform_partner_rehearsal_a1b2c3d4e5f6',
    'postgresql://platform_app:synthetic@postgres/platform_partner_rehearsal_a1b2c3d4e5f6?options=bad',
  ]) assert.throws(() => module.assertScratchEnvironment({ ...valid, DATABASE_URL }));
  for (const key of Object.keys(flags)) {
    assert.throws(() => module.assertScratchEnvironment({ ...valid, [key]: '1' }));
    assert.throws(() => module.assertScratchEnvironment({ ...valid, [key]: undefined }));
  }
});

test('disabled rehearsal exercises real application and HTTP denials without creating approvals or messages', async () => {
  const module = await import('../../scripts/rehearse-partner.mjs');
  assert.equal(typeof module.rehearseDisabledRuntime, 'function', 'disabled runtime probe is missing');
  const fixture = await partnerFixture({ reviewed: false });
  try {
    const proof = await module.rehearseDisabledRuntime({ database: fixture.database, env: flags, programId: fixture.programId });
    assert.deepEqual(proof, { disabledProgram: true, sessionDenials: true, noMessagesSent: true });
    const [counts] = await fixture.database.query`SELECT
      (SELECT count(*)::int FROM partner_legal_reviews) AS reviews,
      (SELECT count(*)::int FROM partner_invites) AS invites,
      (SELECT count(*)::int FROM partner_outbox) AS outbox,
      (SELECT count(*)::int FROM partner_payables) AS payables`;
    assert.deepEqual(counts, { reviews: 0, invites: 0, outbox: 0, payables: 0 });
    await fixture.database.query`UPDATE partner_programs SET synthetic=false WHERE id=${fixture.programId}`;
    await assert.rejects(module.rehearseDisabledRuntime({ database: fixture.database, env: flags, programId: fixture.programId }));
  } finally { await fixture.close(); }
});
