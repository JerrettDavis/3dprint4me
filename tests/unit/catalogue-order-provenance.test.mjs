import test from 'node:test';
import assert from 'node:assert/strict';
import { continuePayload } from '../../customizer/framework/continue.js';
import { customizationFromHandoff, handoffPrefill, projectRequestFromData } from '../../public/assets/js/order/model.js';
import { normalizeCustomization } from '../../lib/customization/domain.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';

test('product identity and friendly title follow the actual customized model into private print intake', () => {
  const p = PRODUCTS.find(p => p.id === 'name-plate-office');
  const g = getGenerator(p.generatorId);
  const handoff = continuePayload(g, { ...p.params, name: 'GALLERY' }, { data: new Uint8Array([1]), filename: 'name-plate.3mf' }, { product: p });
  assert.equal(handoff.generatorTitle, 'Office name sign');
  assert.deepEqual(handoff.product, { id: 'name-plate-office', revision: 1 });
  assert.equal(handoffPrefill(handoff).projectTitle, 'Custom Office name sign');
  const customization = customizationFromHandoff(handoff);
  const request = projectRequestFromData({ data: { service: 'print' }, files: [], estimate: {}, buildSummary: () => ({ service: 'print' }), customization });
  const normalized = normalizeCustomization(request.customization);
  assert.deepEqual(normalized.product, { id: 'name-plate-office', revision: 1 });
  assert.equal(normalized.params.name, 'GALLERY', 'actual settings remain authoritative, even when changed after selecting a product');
  assert.equal(projectRequestFromData({ data: { service: 'repair' }, buildSummary: () => ({ service: 'repair' }), customization }).customization, undefined);
});

test('private previews do not claim a published product identity', () => {
  const g = getGenerator('name-plate');
  const handoff = continuePayload(g, {}, { data: new Uint8Array([1]), filename: 'name-plate.3mf' }, { product: { id: 'catalogue-preview', revision: 1, title: 'Private preview', privatePreview: true } });
  assert.equal(handoff.product, undefined);
  assert.equal(handoff.generatorTitle, g.title);
});

test('server revalidates bounded product references and rejects unexpected values without echoing them', () => {
  for (const product of [{ id: '../../private', revision: 1 }, { id: 'office', revision: 0 }, { id: 'office', revision: 1, password: 'PRIVATE SECRET' }, ['office', 1]]) {
    assert.throws(() => normalizeCustomization({ generatorId: 'name-plate', generatorVersion: 2, params: {}, product }), error => error.status === 400 && !error.message.includes('PRIVATE SECRET'));
  }
});
