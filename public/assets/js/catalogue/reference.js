// Client-claimed starting point only: never a price, payment or model-content proof.
export function normalizeProductReference(value) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id', 'revision'].includes(key))
    || typeof value.id !== 'string' || value.id.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 1000000000) throw new TypeError('The starting product reference is invalid.');
  return { id: value.id, revision: value.revision };
}
