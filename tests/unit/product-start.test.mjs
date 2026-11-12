import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProductState, productDraftKey } from '../../customizer/framework/product-start.js';
import { designsOf, applyDesign } from '../../customizer/framework/designs.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
import { cataloguePreviewHref } from '../../public/assets/js/catalogue/contract.js';

test('an explicit product wins over a conflicting draft without using the ordinary draft key', () => {
  const g = getGenerator('pumpkin');
  const state = initialProductState(g, '?product=pumpkin-witch&revision=1', JSON.stringify({ diameter_mm: 60 }), PRODUCTS);
  assert.equal(state.product.id, 'pumpkin-witch');
  assert.equal(state.params.topper, 'witch');
  assert.notEqual(state.params.diameter_mm, 60);
  assert.equal(state.preserveDraft, true);
  assert.equal(productDraftKey(g, state.product), '3dp-customize:pumpkin:v9:product:pumpkin-witch:r1');
  assert.equal(productDraftKey(g), '3dp-customize:pumpkin:v9');
});

test('ordinary navigation restores the draft and explicit unavailable links do not build defaults', () => {
  const g = getGenerator('pumpkin');
  const ordinary = initialProductState(g, '', JSON.stringify({ diameter_mm: 60 }), PRODUCTS);
  assert.equal(ordinary.params.diameter_mm, 60);
  assert.equal(ordinary.product, null);
  const failed = initialProductState(g, '?product=no-such-product&revision=1', null, PRODUCTS);
  assert.equal(failed.params, null);
  assert.ok(failed.error);
});

test('product entry resets sensitive fields instead of restoring an earlier password', () => {
  const g = getGenerator('wifi-tag');
  const state = initialProductState(g, '?product=wifi-tag-card&revision=1', JSON.stringify({ password: 'private-password' }), PRODUCTS);
  assert.equal(state.params.password, '');
  assert.equal(state.params.security, 'nopass');
  assert.equal(state.params.format, 'card');
});

test('published products appear as pictured generator choices and apply their actual settings', () => {
  const g = getGenerator('pumpkin');
  const designs = designsOf(g);
  const product = designs.find(d => d.product?.id === 'pumpkin-witch');
  assert.ok(product);
  assert.match(product.image.src, /pumpkin-witch-r1\.webp/);
  assert.equal(applyDesign(g, product).topper, 'witch');
  assert.ok(designs.find(d => d.id === 'cute'), 'ordinary built-in designs remain available');
});

test('admin inspection opens safe private settings locally without replacing the ordinary draft', () => {
  const g = getGenerator('name-plate');
  const href = cataloguePreviewHref({ generatorId: g.id, generatorVersion: g.version, params: { name: 'PUBLIC EXAMPLE', style: 'raised' } });
  assert.ok(href.startsWith('/customize/g/name-plate/#catalogue-preview='));
  const url = new URL(href, 'https://3dprint4.me');
  const initial = initialProductState(g, '', JSON.stringify({ name: 'MY DRAFT' }), PRODUCTS, url.hash);
  assert.equal(initial.params.name, 'PUBLIC EXAMPLE');
  assert.equal(initial.preview, true);
  assert.equal(initial.preserveDraft, true);
  assert.equal(productDraftKey(g, initial.product), '3dp-customize:name-plate:v2:catalogue-preview');
  const ambiguous = initialProductState(g, '?product=name-plate-classic&revision=1', null, PRODUCTS, url.hash);
  assert.ok(ambiguous.error);
  assert.equal(ambiguous.params, null);
  assert.throws(() => cataloguePreviewHref({ generatorId: 'wifi-tag', generatorVersion: 2, params: { password: 'private' } }));
});

test('reload resumes this product’s own edits while a new gallery link still starts as pictured', () => {
  const g = getGenerator('name-plate');
  const readProductDraft = () => JSON.stringify({ name: 'MY EDITED NAME', style: 'raised' });
  const search = '?product=name-plate-office&revision=1';
  const resumed = initialProductState(g, search, null, PRODUCTS, '', { resume: true, readProductDraft });
  assert.equal(resumed.params.name, 'MY EDITED NAME');
  assert.equal(resumed.resumed, true);
  const fresh = initialProductState(g, search, null, PRODUCTS, '', { resume: false, readProductDraft });
  assert.equal(fresh.params.name, 'Alex');
  const malformed = initialProductState(g, search, null, PRODUCTS, '', { resume: true, readProductDraft: () => '{broken' });
  assert.equal(malformed.params.name, 'Alex');
  assert.equal(malformed.params.size, 'office');
});
