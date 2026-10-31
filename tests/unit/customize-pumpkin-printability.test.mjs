import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildFace, faceSpec, FACE_PRESETS } from '../../customizer/generators/pumpkin/faces.js';
import { faceOverhangs } from '../../customizer/generators/pumpkin/printability.js';
import pumpkin from '../../public/assets/js/customize/generators/pumpkin.js';
import build from '../../customizer/generators/pumpkin/build.js';
import { clampParams, validateParams } from '../../public/assets/js/customize/schema.js';

const wasm = await loadEngine();
const defaults = Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.default]));
function face(p, optimize, W = 60) {
  const temps = [], t = x => { if (x) temps.push(x); return x; };
  try {
    const result = buildFace(wasm.CrossSection, faceSpec(p), W, t, { optimize });
    return { polygons: result.main.toPolygons(), area: result.main.area(), risk: faceOverhangs(result.main) };
  } finally { for (const x of temps) x.delete(); }
}

test('optimized preset roofs have no shallow edges or enclosed material islands at any face size', () => {
  for (const name of Object.keys(FACE_PRESETS)) for (const W of [24, 60, 121.5]) {
    const p = { ...defaults, face: name };
    const adapted = face(p, true, W), original = face(p, false, W);
    assert.ok(adapted.area > 0, name);
    assert.equal(adapted.risk.shallowRoofMm, 0, `${name}@${W}`);
    assert.equal(adapted.risk.islands, 0, name);
    assert.equal(adapted.risk.hangingTips, 0, name);
    const bounds = ps => ps.flat().reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
    const a = bounds(adapted.polygons), o = bounds(original.polygons);
    assert.ok(a[0] >= o[0] - .001 && a[1] >= o[1] - .001 && a[2] <= o[2] + .001 && a[3] <= o[3] + .001, name);
  }
});

test('every custom feature can be adapted and the original grin retains its unsupported roof', () => {
  for (const key of ['eye_shape', 'nose_shape', 'mouth_shape']) for (const { value } of pumpkin.schema[key].options) {
    const result = face({ ...defaults, face: 'custom', [key]: value }, true);
    assert.equal(result.risk.shallowRoofMm, 0, `${key}:${value}`);
    assert.equal(result.risk.islands, 0);
  }
  assert.ok(face({ ...defaults, face: 'awesome' }, false).risk.shallowRoofMm > 10);
  assert.ok(face({ ...defaults, face: 'traditional' }, false).risk.hangingTips > 0, 'steep teeth still start in mid-air');
  assert.notDeepEqual(face({ ...defaults, face: 'awesome' }, true).polygons, face({ ...defaults, face: 'awesome' }, false).polygons);
});

test('layer-by-layer slab checks independently verify support under the adapted face roofs', () => {
  const checkLayers = (name, optimize) => {
    const temps = [], t = x => { temps.push(x); return x; };
    try {
      const parts = buildFace(wasm.CrossSection, faceSpec({ ...defaults, face: name }), 60, t, { optimize });
      const cutter = t(t(parts.main.extrude(4)).rotate([90, 0, 0]));
      const slab = t(t(wasm.Manifold.cube([100, 2, 80], true)).subtract(cutter));
      let unsupported = 0;
      // Compare each new layer's material against the previous layer expanded by one
      // layer height (45°). This checks solids, independently of faceOverhangs.
      for (let z = -28; z < 24; z += .4) {
        const below = slab.slice(z - .4), above = slab.slice(z);
        const supported = below.offset(.40001, 'Miter'), extra = above.subtract(supported);
        unsupported = Math.max(unsupported, extra.area());
        for (const cs of [below, above, supported, extra]) cs.delete();
      }
      return unsupported;
    } finally { for (const x of temps) x.delete(); }
  };
  for (const name of ['traditional', 'awesome', 'happy', 'cool', 'starstruck', 'cute']) {
    assert.ok(checkLayers(name, true) < .001, name);
  }
  assert.ok(checkLayers('awesome', false) > 1, 'the original wide flat grin fails this same support check');
});

test('cutout optimization is default-on; warnings explain actual printing modes', async () => {
  assert.equal(defaults.optimize_cutouts, true);
  for (const [over, expected, absent] of [
    [{ style: 'hollow', face_style: 'cutout' }, /roof.*45°/i, /unsupported face roof/i],
    [{ style: 'hollow', face_style: 'cutout', optimize_cutouts: false }, /unsupported face roof/i, /reshaped/i],
    [{ style: 'bowl', wall_mm: 2.4, face_style: 'cutout', optimize_cutouts: false }, /unsupported face roof/i],
    [{ face_style: 'engraved' }, /recess.*cantilever/i],
    [{ face_style: 'inlay', multicolor: false }, /glue.*pocket/i],
    [{ face_style: 'inlay', multicolor: true }, null, /unsupported face roof|recess.*cantilever|glue.*pocket/i],
    [{ style: 'vase' }, null, /face roof|reshaped|cantilever/i],
    [{ face: 'none' }, null, /face roof|reshaped|cantilever/i],
  ]) {
    const p = validateParams(pumpkin, clampParams(pumpkin, { ...defaults, face: 'awesome', ...over }));
    assert.ok(p.ok, p.errors.join('; '));
    const result = await build(p.value, { wasm });
    try {
      const text = result.warnings.join(' ');
      if (expected) assert.match(text, expected);
      if (absent) assert.doesNotMatch(text, absent);
    } finally { for (const { solid } of result.solids) solid.delete(); }
  }
});

