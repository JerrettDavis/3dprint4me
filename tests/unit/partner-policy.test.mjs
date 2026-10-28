import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationWeek, reserveAuthorization, adjustWeeklyCap, canAuthorize, contactConsent } from '../../lib/partner-outreach/policy.js';

test('Central Monday boundary and DST use local calendar weeks', () => {
  for (const [instant, week] of [
    ['2026-10-26T04:59:59Z', '2026-10-19'],
    ['2026-10-26T05:00:00Z', '2026-10-26'],
    ['2026-11-02T05:59:59Z', '2026-10-26'],
    ['2026-11-02T06:00:00Z', '2026-11-02'],
    ['2026-03-09T04:59:59Z', '2026-03-02'],
    ['2026-03-09T05:00:00Z', '2026-03-09'],
  ]) assert.equal(authorizationWeek(instant), week);
  assert.throws(() => authorizationWeek('invalid'));
});

test('authorization uses integer cents and reserves full deterministic bonus', () => {
  const initial = { capCents: 20000, committedCents: 0 };
  const reserved = reserveAuthorization(initial, 15000, 5000);
  assert.deepEqual(reserved, { capCents: 20000, committedCents: 20000 });
  assert.deepEqual(initial, { capCents: 20000, committedCents: 0 });
  assert.throws(() => reserveAuthorization(reserved, 1));
  for (const bad of [-1, 1.5, '100', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => reserveAuthorization(initial, bad));
    assert.throws(() => reserveAuthorization(initial, 100, bad));
  }
});

test('cap decreases preserve obligations and hard maximum is 40000', () => {
  const current = { capCents: 20000, committedCents: 19000 };
  const lower = adjustWeeklyCap(current, 10000);
  assert.equal(lower.committedCents, 19000);
  assert.throws(() => reserveAuthorization(lower, 1));
  assert.equal(adjustWeeklyCap(current, 40000).capCents, 40000);
  for (const bad of [40001, -1, '20000', 1.5]) assert.throws(() => adjustWeeklyCap(current, bad));
});

test('flags alone cannot satisfy review evidence and program ends at Central midnight', () => {
  const settings = { enabled: true, classificationApproved: true, accountingApproved: true,
    approvedDocumentHash: 'a'.repeat(64), reviewedDocumentHash: 'a'.repeat(64),
    classificationEvidenceId: 'legal-review', accountingEvidenceId: 'cpa-review' };
  assert.equal(canAuthorize(settings, '2027-01-01T05:59:59Z'), true);
  assert.equal(canAuthorize(settings, '2027-01-01T06:00:00Z'), false);
  assert.equal(canAuthorize({}, '2026-10-23T12:00:00Z'), false);
  for (const field of ['enabled', 'classificationApproved', 'accountingApproved', 'classificationEvidenceId', 'accountingEvidenceId', 'approvedDocumentHash']) {
    assert.equal(canAuthorize({ ...settings, [field]: null }, '2026-10-23T12:00:00Z'), false);
  }
  assert.equal(canAuthorize({ ...settings, reviewedDocumentHash: 'b'.repeat(64) }, '2026-10-23T12:00:00Z'), false);
});

test('contacts need specific affirmative purpose and revocation wins', () => {
  assert.equal(contactConsent({ consent: true, purpose: 'Quote follow-up' }), true);
  for (const input of [{}, { consent: 'true', purpose: 'Quote' }, { consent: true, purpose: ' ' }, { consent: true, purpose: 'Quote', withdrawn: true }]) {
    assert.equal(contactConsent(input), false);
  }
});
