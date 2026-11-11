import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { listPublicGenerators } from '../../public/assets/js/customize/registry.js';
import { PRODUCT_MEDIA } from '../../public/assets/js/customize/product-media.js';
import { sensitiveKeys, validateParams } from '../../public/assets/js/customize/schema.js';
import { productRenderInputHash } from '../../scripts/product-render-inputs.mjs';

const recipes = JSON.parse(readFileSync(new URL('../../scripts/product-render-recipes.json', import.meta.url)));
test('every category without a printed photograph has one reproducible, valid, non-sensitive recipe', () => {
  const expected = listPublicGenerators().filter(g => PRODUCT_MEDIA[g.id].label !== 'Printed example');
  assert.deepEqual(recipes.renders.filter(r => !r.generator).map(r => r.id).sort(), expected.map(g => g.id).sort());
  for (const g of expected) {
    const recipe = recipes.renders.find(r => r.id === g.id);
    const params = Object.fromEntries(Object.entries(g.schema).map(([key, field]) => [key, field.default]));
    for (const key of sensitiveKeys(g)) assert.equal(Object.hasOwn(recipe.params, key), false);
    assert.equal(validateParams(g, { ...params, ...recipe.params }).ok, true, g.id);
    assert.ok(recipe.elevation > 0 && recipe.elevation < 90);
    assert.ok(Number.isFinite(recipe.azimuth));
  }
});

test('shipped non-photographic media has provenance tied to the current recipe and image bytes', async () => {
  const { createHash } = await import('node:crypto');
  const evidence = JSON.parse(readFileSync(new URL('../../scripts/product-render-manifest.json', import.meta.url)));
  assert.equal(evidence.inputSha256, await productRenderInputHash(), 'regenerate renders after geometry, defaults, fonts or dependencies change');
  for (const recipe of recipes.renders) {
    const entry = evidence.renders.find(r => r.id === recipe.id);
    assert.deepEqual(entry.recipe, recipe);
    const src = PRODUCT_MEDIA[recipe.id]?.src ?? `/assets/images/products/${recipe.id}.webp`;
    const bytes = readFileSync(new URL(`../../public${src}`, import.meta.url));
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    if (PRODUCT_MEDIA[recipe.id]) {
      assert.equal(new URL(src, 'https://3dprint4.me').searchParams.get('v'), entry.sha256.slice(0, 16), 'image changes must bypass returning visitors\' cached renders');
    }
    assert.equal(entry.renderer, 'Blender Cycles');
    assert.equal(entry.studioSha256, createHash('sha256').update(readFileSync(new URL('../../scripts/render-products.py', import.meta.url))).digest('hex'));
    assert.match(entry.meshSha256, /^[0-9a-f]{64}$/);
  }
});
