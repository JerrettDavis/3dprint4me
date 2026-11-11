import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct, productHref, resolveProductLink } from '../../public/assets/js/catalogue/contract.js';
import { getGenerator, listPublicGenerators } from '../../public/assets/js/customize/registry.js';
import { sensitiveKeys } from '../../public/assets/js/customize/schema.js';
import { launchProducts } from '../../scripts/catalogue-seeds.mjs';

const example = () => ({ id: 'little-witch', revision: 1, generatorId: 'pumpkin', generatorVersion: 9,
  title: 'Little witch', category: 'Seasonal', summary: 'A playful pumpkin lantern.', status: 'published',
  params: {}, images: [{ src: '/assets/images/products/catalogue/little-witch-r1.webp', alt: 'Orange pumpkin with witch hat', kind: 'render' }] });

test('public records normalize complete settings and never retain internal fields', () => {
  const result = validateProduct(example());
  assert.equal(result.params.diameter_mm, getGenerator('pumpkin').schema.diameter_mm.default);
  assert.ok(Object.keys(result.params).length > 20);
  assert.throws(() => validateProduct({ ...example(), sourceWorkId: 'private-request' }));
  assert.throws(() => validateProduct({ ...example(), params: { unknown: 1 } }));
});

test('sensitive values and redaction markers are rejected before publication', () => {
  const g = getGenerator('wifi-tag');
  for (const password of ['customer-secret', '[redacted]', '']) {
    assert.throws(() => validateProduct({ ...example(), generatorId: g.id, generatorVersion: g.version, params: { password } }));
  }
  const result = validateProduct({ ...example(), generatorId: g.id, generatorVersion: g.version, params: { security: 'nopass' } });
  assert.equal(Object.hasOwn(result.params, 'password'), false);
});

test('public image paths cannot fetch remote resources or traverse to private files', () => {
  for (const src of ['https://example.com/x.webp', '//example.com/x.webp', '/api/private-file', '/assets/images/products/../../secret.webp', '/assets/images/products/x.webp?token=private', '/assets/images/products/x.svg']) {
    assert.throws(() => validateProduct({ ...example(), images: [{ src, alt: 'Preview', kind: 'render' }] }));
  }
  assert.throws(() => validateProduct({ ...example(), title: ' ' }));
  assert.throws(() => validateProduct({ ...example(), images: [] }));
  assert.throws(() => validateProduct({ ...example(), revision: 0 }));
});

test('links pin immutable revision and resolve the exact pictured configuration', () => {
  const first = validateProduct(example());
  const second = validateProduct({ ...example(), revision: 2, params: { diameter_mm: 160 } });
  assert.equal(productHref(first), '/customize/g/pumpkin/?product=little-witch&revision=1');
  assert.equal(productHref(first, { request: true }), '/customize/g/pumpkin/?product=little-witch&revision=1&intent=request');
  const found = resolveProductLink(getGenerator('pumpkin'), '?product=little-witch&revision=1', [second, first]);
  assert.equal(found.status, 'ready');
  assert.equal(found.product.revision, 1);
  assert.equal(found.params.diameter_mm, getGenerator('pumpkin').schema.diameter_mm.default);
});

test('bad, withdrawn, mismatched and stale links explain failure instead of substituting defaults', () => {
  const g = getGenerator('pumpkin');
  const p = validateProduct(example());
  assert.equal(resolveProductLink(g, '', [p]).status, 'none');
  for (const search of ['?product=missing&revision=1', '?product=little-witch', '?revision=1', '?product=little-witch&revision=1&revision=2', '?product=little-witch&revision=01']) {
    const result = resolveProductLink(g, search, [p]);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.params, undefined);
  }
  assert.equal(resolveProductLink(g, '?product=little-witch&revision=1', [{ ...p, status: 'withdrawn' }]).status, 'unavailable');
  assert.equal(resolveProductLink(getGenerator('vase'), '?product=little-witch&revision=1', [p]).status, 'unavailable');
  assert.equal(resolveProductLink({ ...g, version: 10 }, '?product=little-witch&revision=1', [p]).status, 'stale');
});

test('thirty launch candidates cover all generators with valid distinct safe settings', () => {
  const products = launchProducts();
  assert.equal(products.length, 30);
  assert.equal(new Set(products.map(p => p.id)).size, 30);
  for (const g of listPublicGenerators()) {
    const entries = products.filter(p => p.generatorId === g.id);
    assert.equal(entries.length, 3, g.id);
    assert.equal(new Set(entries.map(p => JSON.stringify(p.params))).size, 3, g.id);
    for (const p of entries) {
      assert.doesNotThrow(() => validateProduct(p));
      for (const key of sensitiveKeys(g)) assert.equal(Object.hasOwn(p.params, key), false);
    }
  }
});
