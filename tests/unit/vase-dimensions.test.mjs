import test from 'node:test';
import assert from 'node:assert/strict';
import generator from '../../public/assets/js/customize/generators/vase.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';
const dimensions = await import('../../public/assets/js/customize/vase-dimensions.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('physical endpoint measurements include final deformation normalization', () => {
  assert.equal(typeof dimensions.measureVaseDimensions, 'function');
  const classic = validateParams(generator, generator.presets.classic).value;
  const result = dimensions.measureVaseDimensions(classic);
  assert.ok(Math.abs(result.baseDiameterMm - 62) < 1e-9);
  assert.ok(Math.abs(result.mouthDiameterMm - 55) < 1e-9);
  const dune = validateParams(generator, generator.presets.dune).value;
  const deformed = dimensions.measureVaseDimensions(dune);
  assert.ok(Math.abs(deformed.baseDiameterMm - dune.diameter_mm * dune.profile[0].radius) > 1);
});

test('physical base and mouth controls synchronize the canonical endpoint points', () => {
  assert.equal(typeof dimensions.setVaseEndpointDiameter, 'function');
  let params = validateParams(generator, generator.presets.classic).value;
  const base = dimensions.setVaseEndpointDiameter(params, 'base', 70);
  assert.ok(Math.abs(base.diameterMm - 70) < 0.02);
  assert.ok(Math.abs(base.profile[0].radius - 0.7) < 0.001);
  params = { ...params, profile: base.profile };
  const mouth = dimensions.setVaseEndpointDiameter(params, 'mouth', 45);
  assert.ok(Math.abs(mouth.diameterMm - 45) < 0.02);
  assert.ok(Math.abs(mouth.profile.at(-1).radius - 0.45) < 0.001);
  assert.deepEqual(mouth.profile.slice(1, -1), params.profile.slice(1, -1));
});

test('unreachable endpoint dimensions report the achievable range without corrupting a profile', () => {
  assert.equal(typeof dimensions.setVaseEndpointDiameter, 'function');
  const params = validateParams(generator, generator.presets.dune).value;
  const result = dimensions.setVaseEndpointDiameter(params, 'base', 500);
  assert.equal(result.clamped, true);
  assert.ok(result.diameterMm <= params.diameter_mm + 0.001);
  assert.ok(result.diameterMm <= result.maximumMm + 0.02);
  assert.ok(result.minimumMm > 0);
  assert.throws(() => dimensions.setVaseEndpointDiameter(params, 'base', NaN), /diameter/i);
});
