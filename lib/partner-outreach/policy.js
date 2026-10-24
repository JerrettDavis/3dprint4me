import { HttpError } from '../http.js';

export const DEFAULT_WEEKLY_CAP_CENTS = 20000;
export const MAX_WEEKLY_CAP_CENTS = 40000;
export const PROGRAM_TIME_ZONE = 'America/Chicago';
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: PROGRAM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

function calendarDate(instant) {
  if (!(instant instanceof Date) && typeof instant !== 'string') throw new HttpError(400, 'A valid timestamp is required.');
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'A valid timestamp is required.');
  const parts = Object.fromEntries(localDate.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Calendar arithmetic uses UTC only after deriving the Central civil date.
// Subtracting elapsed 24-hour periods across DST would assign the wrong week.
export function authorizationWeek(instant) {
  const day = new Date(`${calendarDate(instant)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, 'Amounts must be nonnegative integer cents.');
  return value;
}
function budget(state) {
  if (!state || typeof state !== 'object') throw new HttpError(400, 'A budget is required.');
  const capCents = cents(state.capCents), committedCents = cents(state.committedCents);
  if (capCents > MAX_WEEKLY_CAP_CENTS) throw new HttpError(400, 'Weekly authorization limit exceeds the program maximum.');
  return { capCents, committedCents };
}

// Repository must lock the program/week and persist the reservation atomically.
export function reserveAuthorization(state, feeCents, maximumBonusCents = 0) {
  const current = budget(state);
  const amount = cents(feeCents) + cents(maximumBonusCents);
  const committedCents = cents(current.committedCents + amount);
  if (committedCents > current.capCents) throw new HttpError(409, 'No additional budget is available for this authorization.');
  return { ...current, committedCents };
}

export function adjustWeeklyCap(state, capCents) {
  return budget({ ...budget(state), capCents });
}

// Evidence IDs/hashes must be resolved from trusted persisted review records by
// the application; never populate this policy input from browser role/flag data.
export function canAuthorize(settings = {}, instant = new Date()) {
  const day = calendarDate(instant);
  return day <= '2026-12-31' && settings.enabled === true &&
    settings.classificationApproved === true && settings.accountingApproved === true &&
    typeof settings.classificationEvidenceId === 'string' && !!settings.classificationEvidenceId.trim() &&
    typeof settings.accountingEvidenceId === 'string' && !!settings.accountingEvidenceId.trim() &&
    typeof settings.approvedDocumentHash === 'string' && /^[a-f0-9]{64}$/.test(settings.approvedDocumentHash) &&
    settings.approvedDocumentHash === settings.reviewedDocumentHash;
}

export function contactConsent(input = {}) {
  return input.consent === true && typeof input.purpose === 'string' && !!input.purpose.trim() && input.withdrawn !== true;
}
