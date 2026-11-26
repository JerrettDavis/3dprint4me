import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveBambuProcess } from '../../lib/print-estimation/slicer-process-policy.js';

test('trusted process keeps calibrated settings and automatically detects tree supports', () => {
  const base = {type: 'process', name: 'Shop 0.16', layer_height: '0.16', sparse_infill_density: '15%', enable_support: '0'};
  const result = effectiveBambuProcess(base);
  assert.equal(result.enable_support, '1');
  assert.equal(result.support_type, 'tree(auto)');
  assert.equal(result.support_on_build_plate_only, '0');
  assert.equal(result.layer_height, '0.16');
  assert.equal(result.sparse_infill_density, '15%');
  assert.equal(base.enable_support, '0', 'shared profile must not be mutated');
});

test('effective process rejects unresolved or invalid presets', () => {
  for (const value of [null, {}, {type:'machine', name:'wrong'}, {type:'process', name:'unresolved', inherits:'parent'}]) {
    assert.throws(() => effectiveBambuProcess(value), {name: 'SliceError', category: 'unavailable'});
  }
});

test('effective process marks support settings as deliberate overrides for the pinned CLI', () => {
  const result = effectiveBambuProcess({type:'process', name:'Shop', different_settings_to_system:['layer_height']});
  assert.match(result.different_settings_to_system[0], /support_type/);
  assert.match(result.different_settings_to_system[0], /enable_support/);
  assert.match(result.different_settings_to_system[0], /layer_height/);
});
