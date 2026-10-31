import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildFace, faceSpec, FACE_PRESETS } from '../../customizer/generators/pumpkin/faces.js';
import { faceOverhangs } from '../../customizer/generators/pumpkin/printability.js';
import pumpkin from '../../public/assets/js/customize/generators/pumpkin.js';
import build from '../../customizer/generators/pumpkin/build.js';
import { clampParams, validateParams } from '../../public/assets/js/customize/schema.js';
import { normalizeCustomization } from '../../lib/customization/domain.js';

const wasm = await loadEngine();
const defaults = Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.default]));

test('legacy pumpkin provenance does not claim its original face was optimized', () => {
  const params = { style: 'hollow', face_style: 'cutout' };
  assert.equal(normalizeCustomization({ generatorId: 'pumpkin', generatorVersion: 1, params }).params.optimize_cutouts, false);
  assert.equal(normalizeCustomization({ generatorId: 'pumpkin', generatorVersion: 2, params }).params.optimize_cutouts, true);
  assert.equal(normalizeCustomization({ generatorId: 'pumpkin', generatorVersion: 3, params }).params.optimize_cutouts, true);
  assert.equal(normalizeCustomization({ generatorId: 'pumpkin', generatorVersion: 2, params: { ...params, optimize_cutouts: false } }).params.optimize_cutouts, false);
});
function face(p, optimize, W = 60) {
  const temps = [], t = x => { if (x) temps.push(x); return x; };
  try {
    const result = buildFace(wasm.CrossSection, faceSpec(p), W, t, { optimize });
    return { polygons: result.main.toPolygons(), area: result.main.area(), risk: faceOverhangs(result.main, { bridges: optimize }) };
  } finally { for (const x of temps) x.delete(); }
}

test('optimized preset roofs have no over-limit bridges or enclosed material islands at any face size', () => {
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

// Independent layer check: new material must remain attached to the layer below;
// complete bridge closures have anchors no more than 10 mm apart.
// Connected shallow cantilevers still require slicer inspection.
function materialIntervals(cs) {
  const hits = [];
  for (const points of cs.toPolygons()) for (let i = 0; i < points.length; i++) {
    const [x, py] = points[i], [nx, pny] = points[(i + 1) % points.length];
    const y = py + .5, ny = pny + .5;
    if ((y <= 0 && ny > 0) || (ny <= 0 && y > 0)) hits.push(x + (nx - x) * -y / (ny - y));
  }
  hits.sort((a, b) => a - b);
  return hits.reduce((out, x, i) => { if (i % 2 === 0) out.push([x, hits[i + 1]]); return out; }, []);
}

test('layer slabs reject floating details and over-limit flat bridges', () => {
  const checkLayers = (name, optimize) => {
    const temps = [], t = x => { temps.push(x); return x; };
    try {
      const selected = typeof name === 'string' ? { face: name } : name;
      const parts = buildFace(wasm.CrossSection, faceSpec({ ...defaults, ...selected }), 60, t, { optimize });
      const cutter = t(t(parts.main.extrude(4)).rotate([90, 0, 0]));
      const slab = t(t(wasm.Manifold.cube([100, 2, 80], true)).subtract(cutter));
      let failures = 0;
      for (let z = -28; z < 24; z += .2) {
        const below = slab.slice(z - .2), above = slab.slice(z);
        const previous = materialIntervals(below), current = materialIntervals(above);
        const supported = below.offset(.20001, 'Miter'), extra = above.subtract(supported);
        for (const [lo, hi] of current) {
          if (hi - lo < .001) continue; // float32 slice noise
          const overlaps = previous.some(([a, b]) => Math.min(hi, b) - Math.max(lo, a) > .001);
          if (!overlaps) failures++;
        }
        for (let i = 0; i + 1 < previous.length; i++) {
          const left = previous[i][1], right = previous[i + 1][0];
          if (right - left > 10.001 && current.some(([a, b]) => a <= left && b >= right)) failures++;
        }
        for (const cs of [below, above, supported, extra]) cs.delete();
      }
      return failures;
    } finally { for (const x of temps) x.delete(); }
  };
  for (const name of Object.keys(FACE_PRESETS)) assert.equal(checkLayers(name, true), 0, name);
  assert.ok(checkLayers('awesome', false) > 0, 'wide original grin exceeds bridge budget');
  assert.ok(checkLayers('traditional', false) > 0, 'original hanging teeth have no lower anchors');
  assert.equal(checkLayers({ face: 'custom', nose_shape: 'nostrils', mouth_shape: 'round' }, true), 0);
  for (const { value: eye_shape } of pumpkin.schema.eye_shape.options)
    for (const { value: nose_shape } of pumpkin.schema.nose_shape.options)
      for (const { value: mouth_shape } of pumpkin.schema.mouth_shape.options) {
        assert.equal(checkLayers({ face: 'custom', eye_shape, nose_shape, mouth_shape }, true), 0,
          `${eye_shape}/${nose_shape}/${mouth_shape}`);
      }
});

test('overlapping custom features cannot introduce hanging teeth after optimization', () => {
  for (const { value: eye_shape } of pumpkin.schema.eye_shape.options)
    for (const { value: nose_shape } of pumpkin.schema.nose_shape.options)
      for (const { value: mouth_shape } of pumpkin.schema.mouth_shape.options)
        for (const W of [24, 60, 121.5]) {
          const { risk } = face({ ...defaults, face: 'custom', eye_shape, nose_shape, mouth_shape }, true, W);
          assert.deepEqual(risk, { shallowRoofMm: 0, islands: 0, hangingTips: 0 }, `${eye_shape}/${nose_shape}/${mouth_shape}@${W}`);
        }
});

test('cutout optimization is default-on; warnings explain actual printing modes', async () => {
  assert.equal(defaults.optimize_cutouts, true);
  for (const [over, expected, absent] of [
    [{ style: 'hollow', face_style: 'cutout' }, /bridges up to 10 mm/i, /unsupported face roof/i],
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

