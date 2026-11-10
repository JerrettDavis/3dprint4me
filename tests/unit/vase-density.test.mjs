import test from 'node:test';
import assert from 'node:assert/strict';
import generator from '../../public/assets/js/customize/generators/vase.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';
import { sampleVaseEnvelope } from '../../public/assets/js/customize/vase-dimensions.js';

test('poly density is validated and changes angular and vertical mesh resolution', () => {
  const preset = generator.presets.classic;
  const meshes = [0, 50, 100].map(poly_density => {
    const checked = validateParams(generator, { ...preset, poly_density });
    assert.equal(checked.ok, true, checked.errors.join('; '));
    return sampleVaseEnvelope(checked.value);
  });
  assert.equal(meshes[0].segments, 6);
  assert.ok(meshes[0].rings.length < 12);
  for (let i = 1; i < meshes.length; i++) {
    assert.ok(meshes[i].segments > meshes[i - 1].segments);
    assert.ok(meshes[i].rings.length > meshes[i - 1].rings.length);
  }
  // At the largest supported radius the smooth mesh's circular chord error
  // must be below 0.005 mm, well below ordinary extrusion resolution.
  assert.ok(110 * (1 - Math.cos(Math.PI / meshes[2].segments)) < 0.005);
  for (const mesh of meshes) {
    assert.equal(mesh.height, preset.height_mm);
    assert.ok(Math.abs(mesh.baseDiameterMm - 62) < 1e-9);
    assert.ok(Math.abs(mesh.mouthDiameterMm - 55) < 1e-9);
  }
  for (const poly_density of [-1, 101, 0.5, '100']) {
    assert.equal(validateParams(generator, { poly_density }).ok, false);
  }
});

test('every preset supports both density endpoints within the geometry budget', () => {
  for (const preset of Object.values(generator.presets)) for (const poly_density of [0, 100]) {
    const checked = validateParams(generator, { ...preset, poly_density });
    assert.equal(checked.ok, true, checked.errors.join('; '));
    const mesh = sampleVaseEnvelope(checked.value);
    assert.ok(mesh.segments * mesh.rings.length <= 80000);
    if (checked.value.facets) assert.equal(mesh.segments % (checked.value.facets * 2), 0);
  }
});
