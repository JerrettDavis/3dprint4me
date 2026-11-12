import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueRenderRecipes } from '../../scripts/catalogue-render-recipes.mjs';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';

test('render recipes rebuild each exact safe published configuration with a stable fingerprint', () => {
  const recipes = catalogueRenderRecipes(PRODUCTS);
  assert.equal(recipes.length, 60);
  const witch = recipes.find(r => r.id === 'catalogue-pumpkin-witch-r1');
  assert.equal(witch.generator, 'pumpkin');
  assert.equal(witch.params.topper, 'witch');
  assert.equal(witch.output, 'catalogue/pumpkin-witch-r1.webp');
  assert.match(witch.configurationSha256, /^[a-f0-9]{64}$/);
  const modified = structuredClone(PRODUCTS.find(p => p.id === 'pumpkin-witch'));
  modified.params.diameter_mm = 100;
  assert.notEqual(catalogueRenderRecipes([modified])[0].configurationSha256, witch.configurationSha256);
  assert.ok(recipes.every(r => r.elevation > 0 && r.elevation < 90 && Number.isFinite(r.azimuth)));
  const other = recipes.find(r => r.id === 'catalogue-pumpkin-witch-r1-detail');
  assert.equal(other.configurationSha256, witch.configurationSha256);
  assert.notEqual(other.elevation, witch.elevation);
  assert.equal(other.output, 'catalogue/pumpkin-witch-r1-detail.webp');
});

test('render input refuses sensitive values, withdrawn products and unsupported external assets', () => {
  const wifi = structuredClone(PRODUCTS.find(p => p.id === 'wifi-tag-card'));
  wifi.params.password = 'private';
  assert.throws(() => catalogueRenderRecipes([wifi]));
  assert.deepEqual(catalogueRenderRecipes([{ ...PRODUCTS[0], status: 'withdrawn' }]), []);
  const remote = structuredClone(PRODUCTS[0]);
  remote.images[0].src = 'https://external.example/render.webp';
  assert.throws(() => catalogueRenderRecipes([remote]));
});
