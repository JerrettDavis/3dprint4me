import test from 'node:test';
import assert from 'node:assert/strict';

const field = await import('../../public/assets/js/customize/vase-field.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const settings = {
  profile: [{ height: 0, radius: 0.4 }, { height: 0.5, radius: 1 }, { height: 1, radius: 0.6 }],
  facets: 0, twist_deg: 0, lobes: 0, lobe_depth: 0, pattern: 'smooth', relief: 0,
  frequency: 6, vertical_frequency: 5, organic: 0, seed: 123,
};

test('smooth vase field reproduces the spline profile', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  const sample = field.compileVaseField(settings);
  assert.equal(sample(0, 0), 0.4);
  assert.equal(sample(0.5, 0), 1);
  assert.equal(sample(1, 0), 0.6);
  assert.equal(sample(0.5, 1.2), 1);
});

test('all vase patterns stay positive, bounded, and periodic around the seam', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  assert.deepEqual(field.VASE_PATTERNS, ['smooth', 'ripple', 'dune', 'scales', 'cells', 'zigzag', 'fractal']);
  for (const pattern of field.VASE_PATTERNS) {
    const sample = field.compileVaseField({ ...settings, pattern, facets: 3, twist_deg: 360,
      lobes: 16, lobe_depth: 0.3, relief: 0.3, organic: 0.2, frequency: 23, vertical_frequency: 24 });
    for (let row = 0; row <= 20; row++) for (let column = 0; column < 36; column++) {
      const height = row / 20, angle = column * Math.PI / 18;
      const radius = sample(height, angle);
      assert.ok(radius > 0 && radius < 2, `${pattern}: ${radius}`);
      assert.ok(Math.abs(radius - sample(height, angle + 2 * Math.PI)) < 1e-10, pattern);
    }
  }
});

test('procedural vase patterns create distinct radial surfaces', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  const signatures = field.VASE_PATTERNS.map(pattern => {
    const sample = field.compileVaseField({ ...settings, pattern, relief: 0.25 });
    return Array.from({ length: 50 }, (_, i) => sample(0.15 + i / 70, i * 0.331).toFixed(5)).join(',');
  });
  assert.equal(new Set(signatures).size, field.VASE_PATTERNS.length);
});

test('vase deformation leaves a stable untextured base', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  const original = field.compileVaseField({ ...settings, facets: 6 });
  const decorated = field.compileVaseField({ ...settings, facets: 6, pattern: 'fractal', relief: 0.3,
    twist_deg: 360, lobes: 16, lobe_depth: 0.3, organic: 0.2 });
  for (let i = 0; i < 60; i++) assert.equal(decorated(0, i / 10), original(0, i / 10));
});

test('organic vase displacement is seeded, deterministic, and editable', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  const a = field.compileVaseField({ ...settings, organic: 0.2 });
  const b = field.compileVaseField({ ...settings, organic: 0.2 });
  const c = field.compileVaseField({ ...settings, organic: 0.2, seed: 124 });
  const samples = sample => Array.from({ length: 40 }, (_, i) => sample(i / 40, i * 0.3));
  assert.deepEqual(samples(a), samples(b));
  assert.notDeepEqual(samples(a), samples(c));
});

test('vase facets create straight polygon sides and twist changes their orientation', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  const sample = field.compileVaseField({ ...settings, facets: 4 });
  const halfSide = Math.PI / 8;
  const centerX = sample(0.5, 0);
  const sideX = sample(0.5, halfSide) * Math.cos(halfSide);
  assert.ok(Math.abs(centerX - sideX) < 1e-12);
  const twisted = field.compileVaseField({ ...settings, facets: 4, twist_deg: 90 });
  assert.ok(Math.abs(twisted(0.5, 0) - sample(0.5, Math.PI / 4)) < 1e-12);
});

test('vase field rejects unsupported and nonfinite algorithm settings', () => {
  assert.equal(typeof field.compileVaseField, 'function');
  for (const change of [
    { pattern: 'unknown' }, { facets: 2 }, { facets: 3.5 }, { facets: 65 },
    { frequency: 0 }, { frequency: 1.5 }, { frequency: 25 }, { vertical_frequency: 25 },
    { relief: 0.31 }, { relief: -0.01 }, { organic: 0.21 }, { lobe_depth: 0.31 },
    { lobes: 17 }, { twist_deg: Infinity }, { seed: NaN }, { seed: -1 }, { seed: 65536 },
  ]) assert.throws(() => field.compileVaseField({ ...settings, ...change }), /vase/i);
  const sample = field.compileVaseField(settings);
  assert.throws(() => sample(0.5, Infinity), /angle/i);
  assert.throws(() => sample(NaN, 0), /height/i);
});
