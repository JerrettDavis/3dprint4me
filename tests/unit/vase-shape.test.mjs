import test from 'node:test';
import assert from 'node:assert/strict';

const shape = await import('../../public/assets/js/customize/vase-shape.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const points = [
  { height: 0, radius: 0.4 },
  { height: 0.3, radius: 1 },
  { height: 0.75, radius: 0.25 },
  { height: 1, radius: 0.6 },
];

test('vase profile validation returns independent canonical points', () => {
  assert.equal(typeof shape.validateVaseProfile, 'function');
  const result = shape.validateVaseProfile(points);
  assert.deepEqual(result, points);
  assert.notEqual(result, points);
  assert.notEqual(result[0], points[0]);
});

test('vase profiles require ordered finite normalized points and fixed endpoints', () => {
  assert.equal(typeof shape.validateVaseProfile, 'function');
  const invalid = [
    null, [], new Array(3), points.slice(0, 2), Array.from({ length: 13 }, (_, i) => ({ height: i / 12, radius: 0.5 })),
    [{ height: 0.1, radius: 0.4 }, ...points.slice(1)],
    [...points.slice(0, -1), { height: 0.99, radius: 0.6 }],
    [points[0], points[2], points[1], points[3]],
    [points[0], { height: 0.01, radius: 0.5 }, ...points.slice(2)],
    [points[0], { height: NaN, radius: 0.5 }, ...points.slice(2)],
    [points[0], { height: 0.3, radius: Infinity }, ...points.slice(2)],
    [points[0], { height: 0.3, radius: '0.5' }, ...points.slice(2)],
    [points[0], { height: 0.3, radius: 0 }, ...points.slice(2)],
    [points[0], { height: 0.3, radius: 1.01 }, ...points.slice(2)],
    [points[0], null, ...points.slice(2)],
  ];
  for (const value of invalid) assert.throws(() => shape.validateVaseProfile(value), /profile/i);
});

test('shape-preserving vase spline passes through every control point', () => {
  assert.equal(typeof shape.sampleVaseProfile, 'function');
  for (const point of points) {
    assert.ok(Math.abs(shape.sampleVaseProfile(points, point.height) - point.radius) < 1e-12);
  }
});

test('vase spline never overshoots local control point radii', () => {
  assert.equal(typeof shape.sampleVaseProfile, 'function');
  const profiles = [points, [
    { height: 0, radius: 0.05 }, { height: 0.02, radius: 1 },
    { height: 0.98, radius: 0.05 }, { height: 1, radius: 1 },
  ], [
    { height: 0, radius: 0.6 }, { height: 0.5, radius: 0.6 }, { height: 1, radius: 0.6 },
  ]];
  for (const profile of profiles) {
    for (let segment = 0; segment < profile.length - 1; segment++) {
      const a = profile[segment], b = profile[segment + 1];
      for (let i = 0; i <= 100; i++) {
        const result = shape.sampleVaseProfile(profile, a.height + (b.height - a.height) * i / 100);
        assert.ok(result >= Math.min(a.radius, b.radius) - 1e-12);
        assert.ok(result <= Math.max(a.radius, b.radius) + 1e-12);
      }
    }
  }
});

test('vase spline has a continuous first derivative at interior points', () => {
  assert.equal(typeof shape.sampleVaseProfile, 'function');
  const epsilon = 1e-6;
  for (const point of points.slice(1, -1)) {
    const center = shape.sampleVaseProfile(points, point.height);
    const left = (center - shape.sampleVaseProfile(points, point.height - epsilon)) / epsilon;
    const right = (shape.sampleVaseProfile(points, point.height + epsilon) - center) / epsilon;
    assert.ok(Math.abs(left - right) < 0.001);
  }
});

test('vase spline clamps finite sample heights and rejects nonfinite heights', () => {
  assert.equal(typeof shape.sampleVaseProfile, 'function');
  assert.equal(shape.sampleVaseProfile(points, -1), points[0].radius);
  assert.equal(shape.sampleVaseProfile(points, 2), points.at(-1).radius);
  for (const height of [NaN, Infinity, '0.5', null]) {
    assert.throws(() => shape.sampleVaseProfile(points, height), /height/i);
  }
});

test('compiled vase profiles snapshot points and match one-shot sampling', () => {
  assert.equal(typeof shape.compileVaseProfile, 'function');
  const editable = structuredClone(points);
  const sample = shape.compileVaseProfile(editable);
  editable[1].radius = 0.5;
  for (let i = 0; i <= 100; i++) {
    assert.equal(sample(i / 100), shape.sampleVaseProfile(points, i / 100));
  }
  assert.throws(() => sample(NaN), /height/i);
});
