import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaxSchedule, generateTaxPeriods, acknowledgeTaxPeriod, taxReminderEvents } from '../../lib/invoicing/tax-periods.js';

const confirmation = { actorId: 'owner-one', now: new Date('2026-11-24T18:00:00Z') };
const schedule = overrides => normalizeTaxSchedule({ confirmed: true, frequency: 'monthly', effectiveFrom: '2026-10-01',
  dueDay: 20, nextBusinessDay: true, holidayDates: [], timeZone: 'America/Chicago',
  reference: 'Owner verified filing account and applicable filing instructions', ...overrides }, confirmation);

test('an unconfirmed or unknown filing schedule cannot generate assumed monthly reminders', () => {
  assert.deepEqual(generateTaxPeriods(null, { through: '2026-11-24' }), []);
  assert.throws(() => schedule({ confirmed: false }), TypeError);
  assert.throws(() => schedule({ frequency: 'guessed-monthly' }), TypeError);
  assert.throws(() => schedule({ reference: '' }), TypeError);
});

test('explicit monthly rules produce separate periods and move weekend due dates to the next business day', () => {
  const periods = generateTaxPeriods(schedule(), { through: '2026-11-24' });
  assert.deepEqual(periods.map(p => [p.id, p.startsOn, p.endsOn, p.dueDate]), [
    ['ok-sales-2026-10', '2026-10-01', '2026-10-31', '2026-11-20'],
    ['ok-sales-2026-11', '2026-11-01', '2026-11-30', '2026-12-21']
  ]);
});

test('quarterly schedules and explicitly supplied holidays use the confirmed rules', () => {
  const periods = generateTaxPeriods(schedule({ frequency: 'quarterly', effectiveFrom: '2026-10-01', holidayDates: ['2027-01-20'] }), { through: '2026-11-24' });
  assert.equal(periods.length, 1);
  assert.equal(periods[0].startsOn, '2026-10-01');
  assert.equal(periods[0].endsOn, '2026-12-31');
  assert.equal(periods[0].dueDate, '2027-01-21');
});

test('filing and payment acknowledgements are independent and never inferred from customer payments', () => {
  const period = generateTaxPeriods(schedule(), { through: '2026-10-31' })[0];
  const filed = acknowledgeTaxPeriod(period, { kind: 'submitted', date: '2026-11-20', reference: 'OKTAP submission confirmation' }, confirmation);
  assert.equal(filed.submitted.date, '2026-11-20');
  assert.equal(filed.paid, null);
  const paid = acknowledgeTaxPeriod(filed, { kind: 'paid', date: '2026-11-20', reference: 'OKTAP payment confirmation' }, confirmation);
  assert.equal(paid.paid.date, '2026-11-20');
  assert.equal(period.submitted, null, 'original record is immutable');
  assert.throws(() => acknowledgeTaxPeriod(period, { kind: 'paid', date: '2026-12-01', reference: 'future payment' }, confirmation), TypeError);
});

test('reminders respect filing/payment state and use stable weekly overdue identities', () => {
  const periods = generateTaxPeriods(schedule(), { through: '2026-11-24' });
  const first = taxReminderEvents(periods, { now: confirmation.now, timeZone: 'America/Chicago' });
  assert.deepEqual(first.map(e => e.kind), ['tax_filing_due', 'tax_payment_due']);
  assert.equal(first[0].periodId, 'ok-sales-2026-10');
  assert.equal(first[0].stage, 'overdue-0');
  const repeat = taxReminderEvents(periods, { now: new Date('2026-11-25T18:00:00Z'), timeZone: 'America/Chicago' });
  assert.deepEqual(repeat.map(e => e.id), first.map(e => e.id));
  const filed = acknowledgeTaxPeriod(periods[0], { kind: 'submitted', date: '2026-11-20', reference: 'OKTAP submission confirmation' }, confirmation);
  assert.deepEqual(taxReminderEvents([filed], { now: confirmation.now, timeZone: 'America/Chicago' }).map(e => e.kind), ['tax_payment_due']);
});

test('reminder dates use the business day at midnight and include the due-day action', () => {
  const period = generateTaxPeriods(schedule(), { through: '2026-10-31' })[0];
  assert.equal(taxReminderEvents([period], { now: new Date('2026-11-20T05:59:59Z'), timeZone: 'America/Chicago' })[0].stage, 'upcoming-1');
  assert.equal(taxReminderEvents([period], { now: new Date('2026-11-20T06:00:00Z'), timeZone: 'America/Chicago' })[0].stage, 'due');
});

test('schedule inputs are bounded and dates must be real, without silently accepting unknown fields', () => {
  for (const change of [{ effectiveFrom: '2026-02-30' }, { dueDay: 0 }, { dueDay: 32 }, { holidayDates: ['2026-02-30'] },
    { timeZone: 'invalid/timezone' }, { password: 'never persisted' }]) assert.throws(() => schedule(change));
  assert.throws(() => generateTaxPeriods(schedule({ effectiveFrom: '2000-01-01' }), { through: '2026-11-24' }), TypeError);
});
