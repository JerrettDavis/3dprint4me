// These are operational reminders under owner-confirmed account rules, not a tax
// determination. No filing frequency, due day or holiday calendar is inferred.
const invalid = () => { throw new TypeError('Confirmed tax filing details are required.'); };
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) invalid();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function reference(value) {
  if (typeof value !== 'string' || value.trim().length < 5 || value.length > 500 || /[\x00-\x1f<>]/.test(value)) invalid();
  return value.trim();
}
function actor({ actorId, now }) {
  if (typeof actorId !== 'string' || actorId.length < 1 || actorId.length > 200 || !(now instanceof Date) || !Number.isFinite(now.getTime())) invalid();
  return { actorId, at: now.toISOString() };
}
function localDay(now, timeZone) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const dayFromMs = value => new Date(value).toISOString().slice(0, 10);
const dayMs = value => Date.parse(`${value}T00:00:00Z`);

export function normalizeTaxSchedule(raw, confirmation) {
  exact(raw, ['confirmed', 'frequency', 'effectiveFrom', 'dueDay', 'nextBusinessDay', 'holidayDates', 'timeZone', 'reference']);
  if (raw.confirmed !== true || !['monthly', 'quarterly'].includes(raw.frequency) ||
      !Number.isSafeInteger(raw.dueDay) || raw.dueDay < 1 || raw.dueDay > 28 || typeof raw.nextBusinessDay !== 'boolean' ||
      !Array.isArray(raw.holidayDates) || raw.holidayDates.length > 366 || typeof raw.timeZone !== 'string' || raw.timeZone.length > 100) invalid();
  const confirmed = actor(confirmation);
  localDay(confirmation.now, raw.timeZone);
  return { frequency: raw.frequency, effectiveFrom: date(raw.effectiveFrom), dueDay: raw.dueDay,
    nextBusinessDay: raw.nextBusinessDay, holidayDates: [...new Set(raw.holidayDates.map(date))].sort(),
    timeZone: raw.timeZone, reference: reference(raw.reference), confirmedBy: confirmed.actorId, confirmedAt: confirmed.at };
}

export function generateTaxPeriods(schedule, { through }) {
  date(through);
  if (!schedule) return [];
  date(schedule.effectiveFrom);
  if (!['monthly', 'quarterly'].includes(schedule.frequency) || !schedule.confirmedBy || !schedule.confirmedAt ||
      !Number.isSafeInteger(schedule.dueDay) || schedule.dueDay < 1 || schedule.dueDay > 28 || !Array.isArray(schedule.holidayDates)) invalid();
  if (through < schedule.effectiveFrom) return [];
  const step = schedule.frequency === 'monthly' ? 1 : 3;
  const effective = new Date(`${schedule.effectiveFrom}T00:00:00Z`);
  const firstMonth = Math.floor(effective.getUTCMonth() / step) * step;
  const first = Date.UTC(effective.getUTCFullYear(), firstMonth, 1);
  const holidays = new Set(schedule.holidayDates);
  const periods = [];
  for (let offset = 0; ; offset += step) {
    const startsOn = dayFromMs(Date.UTC(effective.getUTCFullYear(), firstMonth + offset, 1));
    if (startsOn > through) break;
    if (periods.length >= 120) invalid();
    const start = new Date(`${startsOn}T00:00:00Z`);
    const year = start.getUTCFullYear(), month = start.getUTCMonth();
    const endsOn = dayFromMs(Date.UTC(year, month + step, 1) - 86400000);
    let due = Date.UTC(year, month + step, schedule.dueDay);
    if (schedule.nextBusinessDay) {
      let adjustments = 0;
      while ([0, 6].includes(new Date(due).getUTCDay()) || holidays.has(dayFromMs(due))) {
        if (++adjustments > 14) invalid();
        due += 86400000;
      }
    }
    const suffix = step === 1 ? startsOn.slice(0, 7) : `${year}-Q${Math.floor(month / 3) + 1}`;
    periods.push({ id: `ok-sales-${suffix}`, startsOn, endsOn, dueDate: dayFromMs(due),
      ruleConfirmedAt: schedule.confirmedAt, reference: schedule.reference, submitted: null, paid: null });
  }
  // Guard Date.UTC's legacy interpretation of years 00-99.
  if (first !== dayMs(periods[0]?.startsOn ?? schedule.effectiveFrom)) invalid();
  return periods;
}

export function acknowledgeTaxPeriod(period, input, confirmation) {
  exact(input, ['kind', 'date', 'reference']);
  if (!period || !/^ok-sales-\d{4}-(?:\d{2}|Q[1-4])$/.test(period.id) || !['submitted', 'paid'].includes(input.kind)) invalid();
  const confirmed = actor(confirmation), acknowledgedOn = date(input.date);
  if (acknowledgedOn > localDay(confirmation.now, confirmation.timeZone ?? 'America/Chicago')) invalid();
  return { ...structuredClone(period), [input.kind]: { date: acknowledgedOn, reference: reference(input.reference),
    confirmedBy: confirmed.actorId, confirmedAt: confirmed.at } };
}

export function taxReminderEvents(periods, { now = new Date(), timeZone = 'America/Chicago' } = {}) {
  if (!Array.isArray(periods) || periods.length > 120) invalid();
  const today = localDay(now, timeZone), events = [];
  for (const period of periods) {
    if (!period || !/^ok-sales-\d{4}-(?:\d{2}|Q[1-4])$/.test(period.id)) invalid();
    const dueDate = date(period.dueDate), remaining = (dayMs(dueDate) - dayMs(today)) / 86400000;
    if (remaining > 7) continue;
    const stage = remaining < 0 ? `overdue-${Math.floor((-remaining - 1) / 7)}` : remaining === 0 ? 'due' : `upcoming-${remaining <= 1 ? 1 : 7}`;
    for (const [field, kind] of [['submitted', 'tax_filing_due'], ['paid', 'tax_payment_due']]) {
      if (period[field]) continue;
      const revision = period.reminderRevisions?.[field] ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0 || revision > 10000) invalid();
      events.push({ id: `${period.id}:${kind}:${dueDate}:${stage}${revision ? `:correction-${revision}` : ''}`, kind, periodId: period.id, dueDate, stage,
        occurredAt: now.toISOString() });
    }
  }
  return events;
}
