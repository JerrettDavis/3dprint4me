import { HttpError } from '../http.js';

const PARTNER_TRANSITIONS = Object.freeze({
  accept: { offered: 'accepted' }, decline: { offered: 'declined' },
  submit: { accepted: 'submitted', changes_requested: 'submitted' },
  request_cancel: { accepted: 'cancellation_requested' },
  report_unsafe: { accepted: 'cancellation_requested', changes_requested: 'cancellation_requested' },
  dispute: { submitted: 'disputed', approved: 'disputed', payable: 'disputed', paid: 'disputed' },
});
const OWNER_TRANSITIONS = Object.freeze({
  publish: { draft: 'offered' }, withdraw: { offered: 'withdrawn' },
  approve: { submitted: 'approved', disputed: 'approved' },
  request_changes: { submitted: 'changes_requested', disputed: 'changes_requested' },
  make_payable: { approved: 'payable' },
});
const REASON_REQUIRED = new Set(['request_cancel', 'report_unsafe', 'dispute', 'request_changes']);

// Acceptance additionally requires atomic policy/reservation in the application.
// Payment and cancellation settlements require ledger commands, not free-form
// state changes; this function cannot mark obligations paid or erase their fee.
export function transitionGig(gig, command, actor) {
  if (!actor || !['OWNER', 'PARTNER'].includes(actor.role)) throw new HttpError(403, 'Access denied.');
  if (!gig || actor.role === 'PARTNER' && gig.partnerId !== actor.id) throw new HttpError(404, 'Gig not found.');
  if (!command || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision !== gig.revision) throw new HttpError(409, 'This gig has changed. Refresh and review it again.');
  if (Object.keys(command).some(key => !['action', 'expectedRevision', 'reason'].includes(key))) throw new HttpError(400, 'Unexpected command field.');
  const transitions = actor.role === 'OWNER' ? OWNER_TRANSITIONS : PARTNER_TRANSITIONS;
  const next = Object.hasOwn(transitions, command.action) ? transitions[command.action][gig.status] : undefined;
  if (!next) throw new HttpError(409, 'This action is unavailable for the current gig.');
  if (REASON_REQUIRED.has(command.action) && (typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 2000)) throw new HttpError(400, 'Provide a brief reason.');
  return { ...gig, status: next, revision: gig.revision + 1 };
}

function text(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new HttpError(400, 'A valid text value is required.');
  return value.trim();
}
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 40000) throw new HttpError(400, 'Invalid offer amount.');
  return value;
}
export function freezeOffer(input) {
  const fields = ['title', 'feeCents', 'maximumBonusCents', 'tasks', 'materials', 'area', 'deadline'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw new HttpError(400, 'Invalid offer fields.');
  if (!Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length > 50 || !Array.isArray(input.materials) || input.materials.length > 50) throw new HttpError(400, 'Specify numbered tasks and supplied materials.');
  if (typeof input.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || !Number.isFinite(Date.parse(input.deadline)) || new Date(input.deadline).toISOString().slice(0, 10) !== input.deadline || input.deadline > '2026-12-31') throw new HttpError(400, 'Choose a valid deadline within the pilot.');
  const feeCents = amount(input.feeCents), maximumBonusCents = amount(input.maximumBonusCents ?? 0);
  if (feeCents + maximumBonusCents > 40000) throw new HttpError(400, 'Offer exceeds the maximum weekly authorization.');
  return Object.freeze({ title: text(input.title, 200), feeCents, maximumBonusCents,
    tasks: Object.freeze(input.tasks.map(value => text(value))), materials: Object.freeze(input.materials.map(value => text(value))),
    area: text(input.area, 200), deadline: input.deadline });
}
