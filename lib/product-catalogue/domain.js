// Private merchandising state machine. No provider calls, geometry, or customer uploads.
import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { sensitiveKeys, validateParams } from '../../public/assets/js/customize/schema.js';
import { validateProduct } from '../../public/assets/js/catalogue/contract.js';

const bad = message => { throw new HttpError(400, message); };
const conflict = message => { throw new HttpError(409, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const SHA = /^[a-f0-9]{64}$/;
export function assertCatalogueOwner(actor) {
  if (!actor?.id || actor.role !== 'owner' || actor.enabled === false) throw new HttpError(403, 'Only an enabled owner can manage catalogue products.');
}
function generatorFor(id, version) {
  const g = typeof id === 'string' && getGenerator(id);
  if (!g?.rights?.publishable) bad('This generator is not available for the catalogue.');
  if (version !== g.version) conflict('This design needs review with the current generator before promotion.');
  return g;
}
function copy(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) bad('Public copy is missing or too long.');
  return value.trim();
}
function paramsFor(g, params) {
  try {
    return validateProduct({ id: 'validation', revision: 1, generatorId: g.id, generatorVersion: g.version,
      title: 'Validation', category: 'Validation', summary: 'Validation', status: 'published', params,
      images: [{ src: '/assets/images/products/validation.webp', alt: 'Validation', kind: 'render' }] }).params;
  } catch { bad('Use valid public settings, bundled fonts and built-in artwork. Sensitive fields cannot be saved.'); }
}
export function catalogueConfigurationHash(draft) {
  return createHash('sha256').update(JSON.stringify({ generatorId: draft.generatorId, generatorVersion: draft.generatorVersion, params: draft.params,
    ...(draft.renderCamera && draft.renderCamera !== 'standard' ? { renderCamera: draft.renderCamera } : {}) })).digest('hex');
}
const next = (draft, now, change) => ({ ...structuredClone(draft), ...change, revision: draft.revision + 1, updatedAt: now });
function renderable(draft) {
  const g = generatorFor(draft.generatorId, draft.generatorVersion);
  paramsFor(g, draft.params);
  copy(draft.title, 100, true); copy(draft.category, 60, true); copy(draft.summary, 400, true);
}

export function createCatalogueDraft({ id, customization, actor, now }) {
  assertCatalogueOwner(actor);
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 100 || !plain(customization)) bad('A valid catalogue product is required.');
  const g = generatorFor(customization.generatorId, customization.generatorVersion);
  const checked = validateParams(g, customization.params, { skipSensitive: true });
  if (!checked.ok) bad('The source customization is not valid for this generator.');
  const secrets = new Set(sensitiveKeys(g));
  const params = {};
  for (const [key, def] of Object.entries(g.schema)) {
    if (secrets.has(key)) continue;
    // Text may be personal even without sensitive:true. Never copy it implicitly.
    params[key] = def.type === 'text' ? def.default : checked.value[key];
  }
  if (g.font && ['custom', 'system'].includes(params[g.font.key])) params[g.font.key] = g.schema[g.font.key].default;
  if (g.image?.when) for (const key of Object.keys(g.image.when)) params[key] = g.schema[key].default;
  if (g.id === 'wifi-tag') params.security = 'nopass';
  return { id, revision: 1, generatorId: g.id, generatorVersion: g.version, params: paramsFor(g, params),
    title: '', category: '', summary: '', permissionNote: '', status: 'draft', render: null, review: null,
    published: null, createdBy: actor.id, createdAt: now, updatedAt: now };
}

export function editCatalogueDraft(draft, input, { actor, now }) {
  assertCatalogueOwner(actor);
  if (!plain(input) || Object.keys(input).some(key => !['title', 'category', 'summary', 'permissionNote', 'params', 'description', 'limitations', 'order', 'discoverable', 'imageAlts', 'renderCamera'].includes(key))) bad('Unsupported catalogue edit.');
  if (draft.status === 'publishing') conflict('Wait for the current publication before editing.');
  const g = generatorFor(draft.generatorId, draft.generatorVersion);
  if (input.params !== undefined && !plain(input.params)) bad('Public settings must be an object.');
  const params = paramsFor(g, { ...draft.params, ...(input.params ?? {}) });
  const order = input.order ?? draft.order ?? 0;
  const discoverable = input.discoverable ?? draft.discoverable ?? true;
  const renderCamera = input.renderCamera ?? draft.renderCamera ?? 'standard';
  const imageAlts = input.imageAlts ?? draft.imageAlts ?? [];
  if (!Number.isInteger(order) || Math.abs(order) > 10000 || typeof discoverable !== 'boolean' || !['standard', 'front', 'overhead'].includes(renderCamera)
    || !Array.isArray(imageAlts) || imageAlts.length > 2) bad('Use valid ordering, visibility, image descriptions and camera choices.');
  return next(draft, now, { title: copy(input.title ?? draft.title, 100), category: copy(input.category ?? draft.category, 60),
    summary: copy(input.summary ?? draft.summary, 400), permissionNote: copy(input.permissionNote ?? draft.permissionNote, 1000),
    description: copy(input.description ?? draft.description ?? '', 2000), limitations: copy(input.limitations ?? draft.limitations ?? '', 1000),
    order, discoverable, renderCamera, imageAlts: imageAlts.map(alt => copy(alt, 300)),
    params, status: 'draft', render: null, review: null });
}

export function queueCatalogueRender(draft, { jobId, actor, now }) {
  assertCatalogueOwner(actor);
  if (['rendering', 'publishing'].includes(draft.status)) conflict('This product already has an active job.');
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(jobId)) bad('A valid render job is required.');
  renderable(draft);
  return next(draft, now, { status: 'rendering', review: null,
    render: { jobId, configurationSha256: catalogueConfigurationHash(draft), images: [], outcome: 'queued' } });
}

export function finishCatalogueRender(draft, result, { now }) {
  if (draft.status !== 'rendering' || draft.render?.jobId !== result.jobId || draft.render.configurationSha256 !== result.configurationSha256
    || catalogueConfigurationHash(draft) !== result.configurationSha256) conflict('This render belongs to older settings. Build previews again.');
  if (result.renderer !== 'Blender Cycles' || !SHA.test(result.inputSha256) || !SHA.test(result.meshSha256)) bad('A verified studio render is required.');
  let images;
  try { images = validateProduct({ id: draft.id, revision: 1, generatorId: draft.generatorId, generatorVersion: draft.generatorVersion,
    params: draft.params, title: draft.title, category: draft.category, summary: draft.summary, status: 'published', images: result.images.map((image, index) => ({ ...image,
      alt: draft.imageAlts?.[index] || `${draft.title}, ${index ? 'alternate' : 'primary'} studio view` })) }).images; }
  catch { bad('The generated preview is not a valid public image.'); }
  return next(draft, now, { status: 'review_ready', review: null,
    render: { ...draft.render, outcome: 'ready', images, renderer: result.renderer, inputSha256: result.inputSha256, meshSha256: result.meshSha256 } });
}

export function approveCatalogueDraft(draft, { actor, now }) {
  assertCatalogueOwner(actor);
  renderable(draft);
  if (!draft.permissionNote.trim()) bad('Record permission or house-design rights before approval.');
  if (draft.status !== 'review_ready' || draft.render?.outcome !== 'ready' || draft.render.configurationSha256 !== catalogueConfigurationHash(draft)) conflict('Build and inspect the current preview before approval.');
  return next(draft, now, { status: 'approved', review: { actorId: actor.id, at: now, revision: draft.revision + 1,
    configurationSha256: catalogueConfigurationHash(draft), renderJobId: draft.render.jobId } });
}

export function publicCatalogueSnapshot(draft, { revision }) {
  if (draft.status !== 'approved' || draft.review?.revision !== draft.revision || draft.review.configurationSha256 !== catalogueConfigurationHash(draft)
    || draft.review.renderJobId !== draft.render?.jobId || draft.render?.outcome !== 'ready') conflict('Only the current reviewed product can be published.');
  return validateProduct({ id: draft.id, revision, generatorId: draft.generatorId, generatorVersion: draft.generatorVersion,
    ...Object.fromEntries(['description', 'limitations', 'order', 'discoverable'].filter(key => Object.hasOwn(draft, key)).map(key => [key, draft[key]])),
    title: draft.title, category: draft.category, summary: draft.summary, status: 'published', params: draft.params, images: draft.render.images });
}
