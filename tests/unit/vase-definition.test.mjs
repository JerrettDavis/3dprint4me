import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParams } from '../../public/assets/js/customize/schema.js';
import { compileVaseField } from '../../public/assets/js/customize/vase-field.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';
import { loadBuilder } from '../../customizer/generators/index.js';
import { readFile } from 'node:fs/promises';
import { randomizeParams } from '../../customizer/framework/randomize.js';
import { normalizeCustomization } from '../../lib/customization/domain.js';

const module = await import('../../public/assets/js/customize/generators/vase.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('vase presets expose valid editable forms spanning every procedural surface family', () => {
  assert.ok(module.default, 'Vase definition must exist.');
  const generator = module.default;
  const patterns = new Set();
  const constructions = new Set();
  for (const preset of Object.values(generator.presets)) {
    const checked = validateParams(generator, preset);
    assert.equal(checked.ok, true, checked.errors.join('; '));
    const sample = compileVaseField(checked.value);
    assert.ok(sample(0.5, 0.7) > 0);
    patterns.add(checked.value.pattern);
    constructions.add(checked.value.construction);
  }
  assert.deepEqual([...patterns].sort(), ['cells', 'dune', 'fractal', 'ripple', 'scales', 'smooth', 'zigzag']);
  assert.deepEqual([...constructions].sort(), ['hollow', 'solid']);
  assert.ok(generator.presets[generator.defaultDesign]);
});

test('the initial vase matches its advertised default design', () => {
  assert.ok(module.default);
  const g = module.default;
  assert.deepEqual(validateParams(g, {}).value, validateParams(g, g.presets[g.defaultDesign]).value);
});

test('vase dimensions and serialized profiles are revalidated through the shared schema', () => {
  assert.ok(module.default, 'Vase definition must exist.');
  for (const input of [{ height_mm: 251 }, { diameter_mm: 0 }, { wall_mm: 0.1 },
    { base_mm: 100 }, { pattern: 'unsupported' }, { frequency: 1.5 }, { seed: '123' },
    { profile: 'unvalidated JSON' }, { undocumented: true }]) {
    assert.equal(validateParams(module.default, input).ok, false);
  }
});

test('vase is connected to the public registry, local builder, and same-origin studio page', async () => {
  assert.equal(getGenerator('vase')?.id, 'vase');
  assert.equal(typeof loadBuilder.vase, 'function');
  const html = await readFile(new URL('../../customizer/g/vase/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="generator-id" content="vase"/);
  assert.match(html, /https:\/\/3dprint4.me\/customize\/g\/vase\//);
  assert.match(html, /Algorithmic vase/);
  assert.equal(/<script(?![^>]*src=)[^>]*>\s*\S/.test(html), false);
});

test('randomizing a vase preserves the selected print construction and editable profile', () => {
  assert.ok(module.default);
  const initial = validateParams(module.default, module.default.presets['faceted-planter']).value;
  for (let i = 0; i < 10; i++) {
    const draw = randomizeParams(module.default, initial, { rng: () => (i + 0.5) / 10 });
    if (!draw.ok) continue;
    assert.equal(draw.params.construction, initial.construction);
    assert.deepEqual(draw.params.profile, initial.profile);
  }
});

test('conditional randomization preserves expensive hollow surface settings', () => {
  const generator = { schema: {
    construction: { type: 'enum', default: 'hollow', options: [{ value: 'hollow' }, { value: 'solid' }], randomize: false },
    depth: { type: 'number', min: 0, max: 10, default: 5, randomizeWhen: p => p.construction === 'solid' },
    color: { type: 'color', default: '#123456' },
  } };
  const initial = validateParams(generator, {}).value;
  assert.equal(randomizeParams(generator, initial, { rng: () => 0.8 }).params.depth, 5);
  assert.notEqual(randomizeParams(generator, { ...initial, construction: 'solid' }, { rng: () => 0.8 }).params.depth, 5);
});

test('server provenance accepts canonical vase v1 and rejects malformed or future submissions', () => {
  const normalized = normalizeCustomization({ generatorId: 'vase', generatorVersion: 1,
    params: module.default.presets.dune });
  assert.equal(normalized.generatorId, 'vase');
  assert.equal(normalized.generatorVersion, 1);
  assert.deepEqual(normalized.params.profile, module.default.presets.dune.profile);
  assert.equal(normalized.params.poly_density, 50);
  assert.equal(normalizeCustomization({ generatorId: 'vase', generatorVersion: 1,
    params: { ...module.default.presets.dune, poly_density: 100 } }).params.poly_density, 100);
  for (const input of [
    { generatorId: 'vase', generatorVersion: 2, params: {} },
    { generatorId: 'vase', generatorVersion: 1, params: { profile: 'raw JSON text' } },
    { generatorId: 'vase', generatorVersion: 1, params: { profile: new Array(10000).fill(null) } },
    { generatorId: 'vase', generatorVersion: 1, params: { height_mm: 1000 } },
    { generatorId: 'vase', generatorVersion: 1, params: { construction: 'unexpected' } },
    { generatorId: 'vase', generatorVersion: 1, params: { poly_density: 101 } },
  ]) assert.throws(() => normalizeCustomization(input), error => error.status === 400);
});
