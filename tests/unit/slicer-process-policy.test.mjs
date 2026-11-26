import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveBambuProcess, effectivePrusaProfile } from '../../lib/print-estimation/slicer-process-policy.js';

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

test('Prusa shop config enables organic overhang supports without changing calibrated layer height', () => {
  const result = effectivePrusaProfile('printer_settings_id = Test Shop\nnozzle_diameter = 0.4\nbed_shape = 0x0,250x0,250x210,0x210\nmax_print_height = 210\nfilament_diameter = 1.75\nfilament_density = 1.24\nfilament_type = PLA\nlayer_height = 0.2\nsupport_material = 0\n', 'pla');
  assert.match(result, /^support_material = 1$/m);
  assert.match(result, /^support_material_auto = 1$/m);
  assert.match(result, /^support_material_style = organic$/m);
  assert.match(result, /^layer_height = 0.2$/m);
  assert.doesNotMatch(result, /^support_material = 0$/m);
});

test('Prusa refuses placeholder, missing settings and wrong-material profiles', () => {
  for (const config of ['', '# PLACEHOLDER\nfilament_type = PLA\nlayer_height = 0.2', 'filament_type = PETG\nlayer_height = 0.2', 'filament_type = PLA\nlayer_height = 0.2']) {
    assert.throws(()=>effectivePrusaProfile(config,'pla'),{name:'SliceError'});
  }
});
