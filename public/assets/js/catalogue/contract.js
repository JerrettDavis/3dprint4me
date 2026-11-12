// Public snapshot contract shared by static shop, offline customizers and server validation.
import { getGenerator } from '../customize/registry.js?v=5d93ee7157a9c9d2';
import { sensitiveKeys, validateParams } from '../customize/schema.js?v=5d93ee7157a9c9d2';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE = /^\/assets\/images\/products\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png|jpg)(?:\?v=[a-f0-9]{16})?$/;
const fields = new Set(['id', 'revision', 'generatorId', 'generatorVersion', 'params', 'title', 'category', 'summary', 'description', 'limitations', 'order', 'discoverable', 'status', 'images']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = () => { throw new Error('This catalogue configuration is not available.'); };
const text = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value.trim();
};

export function validateProduct(record, { getGenerator: lookup = getGenerator, allowHistorical = false } = {}) {
  if (!plain(record) || Object.keys(record).some(key => !fields.has(key))) invalid();
  if (typeof record.id !== 'string' || !ID.test(record.id) || record.id.length > 100 || !Number.isSafeInteger(record.revision) || record.revision < 1) invalid();
  const g = typeof record.generatorId === 'string' && lookup(record.generatorId);
  if (!g?.rights?.publishable || !Number.isSafeInteger(record.generatorVersion) || record.generatorVersion < 1
    || (record.generatorVersion !== g.version && !(allowHistorical && record.generatorVersion < g.version))) invalid();
  const historical = record.generatorVersion !== g.version;
  const merchandising = {};
  for (const [key, max] of [['description', 2000], ['limitations', 1000]]) if (Object.hasOwn(record, key)) {
    if (typeof record[key] !== 'string' || record[key].length > max || /[\u0000-\u001f\u007f]/.test(record[key])) invalid();
    merchandising[key] = record[key].trim();
  }
  if (Object.hasOwn(record, 'order')) { if (!Number.isInteger(record.order) || Math.abs(record.order) > 10000) invalid(); merchandising.order = record.order; }
  if (Object.hasOwn(record, 'discoverable')) { if (typeof record.discoverable !== 'boolean') invalid(); merchandising.discoverable = record.discoverable; }
  if (!['published', 'withdrawn'].includes(record.status) || !plain(record.params)) invalid();
  const sensitive = new Set(sensitiveKeys(g));
  if (Object.keys(record.params).some(key => sensitive.has(key))) invalid();
  const checked = validateParams(g, record.params, { skipSensitive: true });
  if (!checked.ok) invalid();
  if (g.id === 'wifi-tag' && checked.value.security !== 'nopass') invalid();
  // A public product can only depend on bundled fonts and built-in artwork.
  if (g.font && ['custom', 'system'].includes(checked.value[g.font.key])) invalid();
  if (g.image?.when && Object.entries(g.image.when).every(([key, value]) => checked.value[key] === value)) invalid();
  if (!Array.isArray(record.images) || !record.images.length || record.images.length > 6) invalid();
  const images = record.images.map(image => {
    if (!plain(image) || Object.keys(image).some(key => !['src', 'alt', 'kind'].includes(key)) || !IMAGE.test(image.src) || image.kind !== 'render') invalid();
    return { src: image.src, alt: text(image.alt, 300), kind: 'render' };
  });
  return { id: record.id, revision: record.revision, generatorId: g.id, generatorVersion: record.generatorVersion,
    title: text(record.title, 100), category: text(record.category, 60), summary: text(record.summary, 400), ...merchandising,
    status: record.status, params: historical ? structuredClone(record.params) : Object.fromEntries(Object.entries(checked.value).filter(([key]) => !sensitive.has(key))), images };
}
export const isCurrentProduct = product => getGenerator(product.generatorId)?.version === product.generatorVersion;

export function productHref(product, { request = false } = {}) {
  if (typeof product?.id !== 'string' || typeof product?.generatorId !== 'string' || !ID.test(product.id) || !ID.test(product.generatorId) || !Number.isSafeInteger(product.revision) || product.revision < 1) invalid();
  const search = new URLSearchParams({ product: product.id, revision: String(product.revision) });
  if (request) search.set('intent', 'request');
  return `/customize/g/${product.generatorId}/?${search}`;
}

function previewProduct(configuration, generator) {
  if (!plain(configuration) || Object.keys(configuration).some(key => !['generatorId', 'generatorVersion', 'params'].includes(key))) invalid();
  return validateProduct({ id: 'catalogue-preview', revision: 1, ...configuration, title: 'Private catalogue preview', category: 'Preview',
    summary: 'Private draft settings for review.', status: 'published', images: [{ src: '/assets/images/products/preview.webp', alt: 'Private preview', kind: 'render' }] },
    generator ? { getGenerator: id => id === generator.id ? generator : undefined } : {});
}

export function cataloguePreviewHref(configuration) {
  const safe = previewProduct(configuration);
  const data = { generatorId: safe.generatorId, generatorVersion: safe.generatorVersion, params: safe.params };
  return `/customize/g/${safe.generatorId}/#catalogue-preview=${encodeURIComponent(JSON.stringify(data))}`;
}

export function resolveCataloguePreview(generator, hash) {
  const fragment = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  if (!fragment.has('catalogue-preview')) return { status: 'none' };
  const unavailable = { status: 'unavailable', message: 'This private preview is unavailable. Return to the catalogue editor or open your other draft.' };
  if (String(hash).length > 32768 || [...fragment.keys()].some(key => key !== 'catalogue-preview') || fragment.getAll('catalogue-preview').length !== 1) return unavailable;
  try {
    const product = previewProduct(JSON.parse(fragment.get('catalogue-preview')), generator);
    return { status: 'ready', product: { ...product, privatePreview: true }, params: product.params };
  } catch { return unavailable; }
}

export function resolveProductLink(generator, search, products) {
  const query = new URLSearchParams(search);
  if (!query.has('product') && !query.has('revision')) return { status: 'none' };
  const unavailable = { status: 'unavailable', message: 'This pictured design is unavailable. You can return to the shop or start a new design.' };
  const id = query.get('product');
  const revision = query.get('revision');
  if (query.getAll('product').length !== 1 || query.getAll('revision').length !== 1 || !ID.test(id ?? '') || !/^[1-9]\d{0,8}$/.test(revision ?? '')) return unavailable;
  const matches = products.filter(p => p.id === id && p.revision === Number(revision));
  if (matches.length !== 1) return unavailable;
  const product = matches[0];
  if (products.some(p => p.id === id && p.status === 'withdrawn' && p.revision >= Number(revision))) return unavailable;
  if (product.generatorId !== generator.id || product.status !== 'published') return unavailable;
  if (product.generatorVersion !== generator.version) return { status: 'stale', message: 'This design needs review after a generator update. Return to the shop or start a new design.' };
  try {
    const safe = validateProduct(product, { getGenerator: key => key === generator.id ? generator : undefined });
    return { status: 'ready', product: safe, params: structuredClone(safe.params) };
  } catch { return unavailable; }
}
