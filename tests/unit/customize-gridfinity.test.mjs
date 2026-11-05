import test from 'node:test';
import assert from 'node:assert/strict';
import { cellCenters, footprint, footSection, GRIDFINITY } from '../../public/assets/js/customize/gridfinity.js';
import { loadEngine } from '../../customizer/framework/engine.js';

test('Gridfinity rectangular occupancy uses fixed 42 mm cell centers', () => {
  assert.deepEqual(cellCenters(1, 1), [[0, 0]]);
  assert.deepEqual(cellCenters(3, 2), [[-42, -21], [0, -21], [42, -21], [-42, 21], [0, 21], [42, 21]]);
  assert.deepEqual(footprint(3, 2), { width: 125.5, depth: 83.5 });
  assert.deepEqual(footprint(1, 1), { width: 41.5, depth: 41.5 });
  assert.equal(GRIDFINITY.heightUnit, 7);
});

test('Gridfinity foot has the independently specified two chamfers and vertical waist', () => {
  for (const [z, width, radius] of [[0, 35.6, 0.8], [0.8, 37.2, 1.6], [2.6, 37.2, 1.6], [4.75, 41.5, 3.75]]) {
    const s = footSection(z);
    assert.ok(Math.abs(s.width - width) < 1e-8, `${z}: width ${s.width}`);
    assert.ok(Math.abs(s.radius - radius) < 1e-8, `${z}: radius ${s.radius}`);
  }
  assert.ok(Math.abs(footSection(3.6).width - 39.2) < 1e-8);
  assert.ok(Math.abs(footSection(0.4).width - 36.4) < 1e-8);
});

test('Gridfinity dimensions reject invalid or unbounded workloads before allocating cells', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '2', 1000000]) {
    assert.throws(() => cellCenters(value, 1), RangeError);
    assert.throws(() => footprint(1, value), RangeError);
  }
  for (const z of [-0.01, 4.76, NaN, Infinity]) assert.throws(() => footSection(z), RangeError);
  assert.equal(cellCenters(6, 6).length, 36);
});

test('real Manifold foot sections match the compatibility profile and remain connected', async () => {
  const { gridFoot } = await import('../../customizer/generators/gridfinity/shared.js');
  const wasm = await loadEngine();
  const solid = gridFoot(wasm);
  try {
    assert.equal(solid.status(), 'NoError');
    const pieces = solid.decompose();
    try { assert.equal(pieces.length, 1); } finally { pieces.forEach(p => p.delete()); }
    const b = solid.boundingBox();
    assert.deepEqual(b.min, [-20.75, -20.75, 0]);
    assert.deepEqual(b.max, [20.75, 20.75, 4.75]);
    for (const [z, width] of [[0.4, 36.4], [1.5, 37.2], [3.6, 39.2]]) {
      const s = solid.slice(z);
      try {
        const bounds = s.bounds();
        assert.ok(Math.abs(bounds.max[0] - bounds.min[0] - width) < 1e-5);
      } finally { s.delete(); }
    }
  } finally { solid.delete(); }
});
