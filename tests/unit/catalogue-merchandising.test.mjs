import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueDraft, editCatalogueDraft, queueCatalogueRender, finishCatalogueRender, approveCatalogueDraft, publicCatalogueSnapshot, catalogueConfigurationHash } from '../../lib/product-catalogue/domain.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
import { filterProducts, renderProduct } from '../../public/assets/js/catalogue/views.js';
import { catalogueRenderRecipes } from '../../scripts/catalogue-render-recipes.mjs';
const actor = { id: 'owner', role: 'owner' }; const now = '2026-11-11T18:00:00.000Z';
test('reviewed owner copy, limitations, ordering, visibility and image descriptions reach the public snapshot', () => {
  const initial = createCatalogueDraft({ id: 'office-sign', customization: { generatorId: 'name-plate', generatorVersion: 2, params: {} }, actor, now });
  const edited = editCatalogueDraft(initial, { title: 'Office sign', category: 'Signs', summary: 'A personal desk sign.', permissionNote: 'House design.',
    description: 'An editable desk sign with raised lettering.', limitations: 'Indoor use. Confirm mounting fit.', order: -10, discoverable: false,
    imageAlts: ['Blue desk sign with white raised lettering', 'Side view showing the desk sign backing'], renderCamera: 'front' }, { actor, now });
  assert.notEqual(catalogueConfigurationHash(edited), catalogueConfigurationHash({ ...edited, renderCamera: 'standard' }));
  const queued = queueCatalogueRender(edited, { jobId: 'render-copy', actor, now });
  const ready = finishCatalogueRender(queued, { jobId: 'render-copy', configurationSha256: queued.render.configurationSha256, renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64), images: PRODUCTS.find(p => p.id === 'name-plate-office').images }, { now });
  const snapshot = publicCatalogueSnapshot(approveCatalogueDraft(ready, { actor, now }), { revision: 1 });
  assert.equal(snapshot.description, edited.description); assert.equal(snapshot.limitations, edited.limitations);
  assert.equal(snapshot.order, -10); assert.equal(snapshot.discoverable, false);
  assert.equal(snapshot.images[0].alt, edited.imageAlts[0]);
  assert.equal(filterProducts([snapshot]).length, 0);
  assert.match(renderProduct(snapshot), /Indoor use\. Confirm mounting fit\./);
  assert.doesNotMatch(JSON.stringify(snapshot), /permissionNote|renderCamera|imageAlts/);
  assert.throws(() => editCatalogueDraft(edited, { renderCamera: 'https://untrusted.test' }, { actor, now }));
});
test('allowlisted camera presets change only bounded render angles and discovery respects owner ordering', () => {
  const p = PRODUCTS[0];
  const standard = catalogueRenderRecipes([p]);
  const front = catalogueRenderRecipes([p], { camera: 'front' });
  assert.notEqual(front[0].elevation, standard[0].elevation);
  assert.equal(front[0].configurationSha256, catalogueConfigurationHash({ ...p, renderCamera: 'front' }));
  assert.throws(() => catalogueRenderRecipes([p], { camera: '../private' }));
  assert.equal(filterProducts([{ ...p, order: 2 }, { ...PRODUCTS[1], order: -1 }])[0].id, PRODUCTS[1].id);
});
