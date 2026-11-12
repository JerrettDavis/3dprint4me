import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
import { catalogueRenderRecipes } from '../../scripts/catalogue-render-recipes.mjs';
import { productRenderInputHash } from '../../scripts/product-render-inputs.mjs';

test('all sixty shipped gallery views match the current exact configuration, studio, mesh and image receipts', async () => {
  const receipt = JSON.parse(await readFile(new URL('../../scripts/product-render-manifest.json', import.meta.url), 'utf8'));
  const media = JSON.parse(await readFile(new URL('../../scripts/catalogue-media.json', import.meta.url), 'utf8'));
  const studio = createHash('sha256').update(await readFile(new URL('../../scripts/render-products.py', import.meta.url))).digest('hex');
  assert.equal(receipt.inputSha256, await productRenderInputHash(), 'rebuild media after geometry inputs change');
  const recipes = catalogueRenderRecipes(PRODUCTS);
  assert.equal(recipes.length, 60);
  for (const recipe of recipes) {
    const evidence = receipt.renders.find(r => r.id === recipe.id);
    assert.ok(evidence, recipe.id);
    assert.deepEqual(evidence.recipe, recipe, recipe.id);
    assert.equal(evidence.studioSha256, studio, recipe.id);
    assert.match(evidence.meshSha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(new URL(`../../public/assets/images/products/${recipe.output}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.sha256, recipe.id);
    assert.equal(media[recipe.id].configurationSha256, recipe.configurationSha256);
    assert.ok(media[recipe.id].dimensionsMm.every(n => Number.isFinite(n) && n > 0), recipe.id);
  }
});
