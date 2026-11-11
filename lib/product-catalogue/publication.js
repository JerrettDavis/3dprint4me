// Publication is a separate durable operation from review or a successful push.
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { assertCatalogueOwner, publicCatalogueSnapshot } from './domain.js';
import { validateProduct } from '../../public/assets/js/catalogue/contract.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const catalogueSnapshotHash = snapshot => createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
const conflict = message => { throw new HttpError(409, message); };

export function queueCataloguePublication(draft, { operation = 'publish', jobId, actor, now }) {
  assertCatalogueOwner(actor);
  if (!['publish', 'withdraw'].includes(operation) || typeof jobId !== 'string' || !/^publish-[A-Za-z0-9-]{1,90}$/.test(jobId)) throw new HttpError(400, 'A valid catalogue publication is required.');
  if (draft.status === 'publishing') conflict('This product already has a publication in progress.');
  const revision = Math.max(draft.publicationCounter ?? 0, draft.published?.revision ?? 0) + 1;
  let snapshot;
  if (operation === 'publish') snapshot = publicCatalogueSnapshot(draft, { revision });
  else {
    if (!draft.published?.snapshot || draft.published.snapshot.status === 'withdrawn') conflict('Only a currently published product can be withdrawn.');
    snapshot = validateProduct({ ...draft.published.snapshot, revision, status: 'withdrawn' });
  }
  const snapshotSha256 = catalogueSnapshotHash(snapshot);
  const releaseId = `release-${createHash('sha256').update(`${jobId}:${snapshotSha256}`).digest('hex').slice(0, 32)}`;
  const next = { ...structuredClone(draft), revision: draft.revision + 1, publicationCounter: revision, status: 'publishing', updatedAt: now,
    publication: { jobId, releaseId, operation, revision, snapshotSha256, phase: 'queued' } };
  return { draft: next, job: { id: jobId, productId: draft.id, draftRevision: next.revision, kind: 'publish', operation,
    status: 'queued', snapshot, snapshotSha256, releaseId, renderJobId: operation === 'publish' ? draft.render.jobId : null,
    attempts: 0, leaseUntil: null, errorCode: null, createdAt: now, updatedAt: now } };
}

function currentPublication(draft, job) {
  if (draft.status !== 'publishing' || draft.revision !== job.draftRevision || draft.publication?.jobId !== job.id
    || draft.publication.releaseId !== job.releaseId || draft.publication.snapshotSha256 !== catalogueSnapshotHash(job.snapshot)) conflict('This publication belongs to another product revision.');
}

export function finishCataloguePublication(draft, job, result, { now }) {
  currentPublication(draft, job);
  if (result?.verified !== true || result.releaseId !== job.releaseId || result.snapshotSha256 !== job.snapshotSha256
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(result.commit ?? '')) conflict('The public release has not been verified yet.');
  return { ...structuredClone(draft), revision: draft.revision + 1, updatedAt: now, status: job.operation === 'withdraw' ? 'withdrawn' : 'published',
    published: { revision: job.snapshot.revision, snapshot: structuredClone(job.snapshot), releaseId: job.releaseId, commit: result.commit, verifiedAt: now },
    publication: { ...draft.publication, phase: 'live', commit: result.commit, verifiedAt: now } };
}

export function failCataloguePublication(draft, job, { uncertain = false, now }) {
  currentPublication(draft, job);
  if (uncertain) conflict('Publication may have reached the deployment provider. Verify it before changing this product.');
  return { ...structuredClone(draft), revision: draft.revision + 1, updatedAt: now,
    status: draft.render?.outcome === 'ready' ? 'review_ready' : 'draft', review: null,
    publication: { ...draft.publication, phase: 'failed', errorCode: 'catalogue_publication_failed' } };
}

export function mergeCatalogueSnapshot(existing, incoming) {
  const safe = validateProduct(incoming);
  const snapshots = existing.map(record => validateProduct(record));
  const matching = snapshots.filter(p => p.id === safe.id && p.revision === safe.revision);
  if (matching.length) {
    if (matching.length !== 1 || catalogueSnapshotHash(matching[0]) !== catalogueSnapshotHash(safe)) conflict('An existing public product revision cannot be changed.');
    return snapshots;
  }
  const previous = snapshots.filter(p => p.id === safe.id);
  if (previous.some(p => p.revision >= safe.revision)) conflict('A newer public revision already exists. Reconcile this publication.');
  if (safe.status === 'withdrawn' && !previous.length) conflict('An unpublished product cannot be withdrawn.');
  return [...snapshots, safe];
}
