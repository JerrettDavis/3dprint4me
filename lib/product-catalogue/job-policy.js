import { HttpError } from '../http.js';
import { finishCatalogueRender } from './domain.js';

export function leaseOptions({ workerId, now, leaseMs }) {
  if (typeof workerId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(workerId) || !Number.isFinite(Date.parse(now))
    || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 900000) throw new TypeError('Valid bounded catalogue lease options are required.');
}
export const jobDue = (job, now) => (job.status === 'queued' && Date.parse(job.availableAt ?? job.createdAt) <= Date.parse(now))
  || (job.status === 'running' && Date.parse(job.leaseUntil) <= Date.parse(now));
export const ownsLease = (job, token, now) => job?.status === 'running' && job.leaseToken === token && Date.parse(job.leaseUntil) > Date.parse(now);
export const currentJobDraft = (job, draft) => draft?.revision === job.draftRevision && draft.status === 'rendering' && draft.render?.jobId === job.id;
const failedDraft = (draft, now) => ({ ...draft, revision: draft.revision + 1, status: 'failed', review: null,
  render: { ...draft.render, outcome: 'failed', errorCode: 'catalogue_render_failed' }, updatedAt: now });

export function claimCatalogueJob(job, { workerId, now, leaseMs, token }) {
  leaseOptions({ workerId, now, leaseMs });
  if (!jobDue(job, now)) return null;
  if (job.attempts >= 3) return { ...job, status: 'failed', errorCode: 'catalogue_render_failed', leaseUntil: null, updatedAt: now };
  return { ...job, status: 'running', workerId, leaseToken: token, leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(),
    attempts: job.attempts + 1, updatedAt: now };
}
export function expiredCatalogueDraft(job, draft, now) {
  return currentJobDraft(job, draft) ? failedDraft(draft, now) : null;
}

export function finishCatalogueJob(job, draft, input) {
  const { leaseToken, now, ok, result } = input;
  // Lost-response retry is safe, but a reclaimed job has a new token.
  if (job?.leaseToken === leaseToken && ['ready', 'failed', 'cancelled', 'queued'].includes(job.status)) return { job, draft: null };
  if (!ownsLease(job, leaseToken, now)) throw new HttpError(409, 'This catalogue job lease is no longer active.');
  if (!currentJobDraft(job, draft)) return { job: { ...job, status: 'cancelled', errorCode: 'catalogue_settings_changed', leaseUntil: null, updatedAt: now }, draft: null };
  if (ok === true) {
    const ready = finishCatalogueRender(draft, result, { now });
    return { job: { ...job, status: 'ready', errorCode: null, leaseUntil: null, updatedAt: now }, draft: ready };
  }
  const retry = job.attempts < 3;
  return { job: { ...job, status: retry ? 'queued' : 'failed', errorCode: 'catalogue_render_failed', leaseUntil: null,
    availableAt: new Date(Date.parse(now) + job.attempts * 30000).toISOString(), updatedAt: now }, draft: retry ? null : failedDraft(draft, now) };
}
