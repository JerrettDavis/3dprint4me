import test from 'node:test';
import assert from 'node:assert/strict';
import { requirementsForWork, normalizeRequirements } from '../../lib/filament-matching/requirements.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';

const detail = specifications => ({ request: { service: 'print', specifications } });
test('color count is unresolved, not a color, and total demand stays unsplit', () => {
  const result = requirementsForWork(detail({ material: 'pla', colors: '3', grams: '30', quantity: '2' }));
  assert.equal(result.requirements[0].color, null);
  assert.equal(result.totalGrams, 60);
  assert.equal(result.requirements[0].grams, null);
  assert.ok(result.warnings.length);
  assert.equal(requirementsForWork({ request: { service: 'repair' } }).applicable, false);
});
test('explicit colors, override validation, single-color demand', () => {
  const result = requirementsForWork(detail({ material: 'PLA', brandLine: 'Requested PLA', color: '#00f', grams: '20', quantity: '3' }));
  assert.equal(result.requirements[0].colorHex, '#0000ff');
  assert.equal(result.requirements[0].grams, 60);
  assert.equal(result.requirements[0].brandLine, 'Requested PLA');
  assert.throws(() => normalizeRequirements([{ id: 'a', material: 'pla', colorHex: 'bad' }]));
  assert.throws(() => normalizeRequirements([{ id: 'a', grams: -1 }]));
  assert.throws(() => normalizeRequirements([{ id: 'a' }, { id: 'a' }]));
});
test('only visible non-sensitive generator color fields enter requirements', () => {
  const d = detail({ material: 'pla' });
  d.request.customization = { generatorId: 'test', params: { color: '#00ff00', password: 'SECRET', hidden: '#ff0000' }, redacted: ['password'] };
  const generator = { schema: { color: { type: 'color', label: 'Body' }, password: { type: 'color', sensitive: true }, hidden: { type: 'color', visibleWhen: () => false } } };
  const result = requirementsForWork(d, { getGenerator: () => generator });
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].colorHex, '#00ff00');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('actual name-plate schema extracts active colors and excludes unused outline and image', () => {
  const generator = getGenerator('name-plate');
  const params = Object.fromEntries(Object.entries(generator.schema).map(([key, field]) => [key, field.default]));
  const d = detail({ material: 'pla' });
  d.request.customization = { generatorId: generator.id, params };
  const result = requirementsForWork(d);
  assert.ok(result.requirements.some(row => row.id === 'generator_text_color' && row.colorHex === '#ffffff'));
  assert.ok(result.requirements.some(row => row.id === 'generator_plate_color'));
  assert.equal(result.requirements.some(row => ['generator_outline_color', 'generator_image_color'].includes(row.id)), false);
});
