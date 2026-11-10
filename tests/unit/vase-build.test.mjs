import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildModel } from '../../customizer/framework/model.js';
import { unzipSync, strFromU8 } from 'fflate';
import { analyzeModelOnServer } from '../../lib/print-estimation/geometry/analyze-model.js';

const module = await import('../../customizer/generators/vase/build.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const settings = {
  height_mm: 60, diameter_mm: 50, wall_mm: 1.2, base_mm: 2, construction: 'solid',
  profile: [{ height: 0, radius: 1 }, { height: 0.5, radius: 1 }, { height: 1, radius: 1 }],
  facets: 0, twist_deg: 0, lobes: 0, lobe_depth: 0, pattern: 'smooth', relief: 0,
  frequency: 6, vertical_frequency: 5, organic: 0, seed: 123, color: '#527c70',
};

async function build(changes = {}) {
  assert.equal(typeof module.default, 'function');
  return module.default({ ...settings, ...changes }, { wasm: await loadEngine() });
}
const dispose = result => result.solids.forEach(part => part.solid.delete());

test('density changes the downloaded triangulated mesh and smooth preview intent', async () => {
  const wasm = await loadEngine();
  const counts = [];
  for (const construction of ['solid', 'hollow']) {
    for (const poly_density of [0, 100]) {
      const exported = await buildModel({ id: 'vase', version: 1, build: module.default },
        { ...settings, construction, poly_density }, { wasm });
      const files = unzipSync(exported.data);
      const xml = strFromU8(files['3D/3dmodel.model']);
      const triangles = [...xml.matchAll(/<triangle /g)].length;
      counts.push(triangles);
      assert.equal(Boolean(exported.parts[0].smoothShading), poly_density === 100);
      assert.equal(JSON.parse(strFromU8(files['Metadata/customizer.json'])).poly_density, poly_density);
      const { metrics } = await analyzeModelOnServer({ name: exported.filename, bytes: exported.data });
      assert.equal(metrics.degenerateTriangles, 0);
      assert.ok(metrics.signedVolumeMm3 > 0);
      assert.ok(Math.abs(metrics.dimensionsMm[2] - settings.height_mm) < 0.001);
    }
  }
  assert.ok(counts[1] > counts[0] * 10);
  assert.ok(counts[3] > counts[2] * 10);
});

test('every ready-made vase builds at both density extremes', async () => {
  const { default: generator } = await import('../../public/assets/js/customize/generators/vase.js');
  const { validateParams } = await import('../../public/assets/js/customize/schema.js');
  for (const [name, preset] of Object.entries(generator.presets)) for (const poly_density of [0, 100]) {
    const checked = validateParams(generator, { ...preset, poly_density });
    assert.equal(checked.ok, true);
    const result = await build(checked.value);
    try {
      assert.equal(result.solids[0].solid.status(), 'NoError', `${name}, density ${poly_density}`);
      assert.ok(result.solids[0].solid.volume() > 0);
    } finally { dispose(result); }
  }
});

test('solid vase output is a closed full-volume envelope on a flat base', async () => {
  const result = await build();
  try {
    assert.equal(result.solids.length, 1);
    const solid = result.solids[0].solid;
    assert.equal(solid.status(), 'NoError');
    assert.ok(solid.numTri() <= 512, 'Straight cylinder sides must not retain redundant height rings.');
    const box = solid.boundingBox();
    assert.equal(box.min[2], 0);
    assert.equal(box.max[2], 60);
    assert.ok(Math.abs(box.max[0] - box.min[0] - 50) < 0.01);
    assert.ok(Math.abs(solid.volume() / (Math.PI * 25 ** 2 * 60) - 1) < 0.005);
    const section = solid.slice(59);
    try { assert.ok(section.area() > 1900); } finally { section.delete(); }
    assert.equal(result.slicerSettings.spiral_mode, '1');
    assert.equal(result.slicerSettings.top_shell_layers, '0');
    assert.match(result.filenameBase, /solid/);
  } finally { dispose(result); }
});

test('high-facet full twists retain their intermediate polygon orientation', async () => {
  const result = await build({ facets: 32, twist_deg: 360 });
  try {
    const section = result.solids[0].solid.slice(60 * 0.265625);
    try {
      let positiveX = 0;
      for (const loop of section.toPolygons()) for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if ((a[1] <= 0 && b[1] >= 0) || (a[1] >= 0 && b[1] <= 0)) {
          const x = Math.abs(b[1] - a[1]) < 1e-10 ? Math.max(a[0], b[0])
            : a[0] + (b[0] - a[0]) * -a[1] / (b[1] - a[1]);
          positiveX = Math.max(positiveX, x);
        }
      }
      assert.ok(Math.abs(positiveX - 25) < 0.03, `Twisted polygon vertex should reach x=25, got ${positiveX}.`);
    } finally { section.delete(); }
  } finally { dispose(result); }
});

test('rotating polygon sections preserve their exact corners between fixed angular rays', async () => {
  const result = await build({ facets: 3, twist_deg: 180 });
  try {
    const section = result.solids[0].solid.slice(30);
    try {
      const maximum = Math.max(...section.toPolygons().flat().map(point => Math.hypot(...point)));
      assert.ok(Math.abs(maximum - 25) < 0.03, `Rotated polygon corners should reach radius 25, got ${maximum}.`);
    } finally { section.delete(); }
  } finally { dispose(result); }
});

test('hollow vase has an open mouth, modeled walls, and a closed base', async () => {
  const result = await build({ construction: 'hollow' });
  try {
    const solid = result.solids[0].solid;
    assert.equal(solid.status(), 'NoError');
    const bottom = solid.slice(1), mouth = solid.slice(59);
    try {
      assert.ok(bottom.area() > 1900);
      assert.ok(mouth.area() > 150 && mouth.area() < 350, `mouth area ${mouth.area()}`);
      const polygons = mouth.toPolygons();
      assert.equal(polygons.length, 2, 'The mouth has one outside loop and one opening.');
      const area = loop => Math.abs(loop.reduce((sum, a, i) => {
        const b = loop[(i + 1) % loop.length]; return sum + a[0] * b[1] - b[0] * a[1];
      }, 0));
      const [outside, opening] = polygons.sort((a, b) => area(b) - area(a));
      const distance = (p, a, b) => {
        const u = [b[0] - a[0], b[1] - a[1]], v = [p[0] - a[0], p[1] - a[1]];
        const t = Math.max(0, Math.min(1, (v[0] * u[0] + v[1] * u[1]) / (u[0] ** 2 + u[1] ** 2)));
        return Math.hypot(v[0] - t * u[0], v[1] - t * u[1]);
      };
      // The selector promises minimum physical separation, not exact radial
      // subtraction; conservative erosion may leave thicker walls.
      for (const point of opening) for (let i = 0; i < outside.length; i++) {
        assert.ok(distance(point, outside[i], outside[(i + 1) % outside.length]) >= 1.2 - 1e-5);
      }
    } finally { bottom.delete(); mouth.delete(); }
    assert.ok(solid.volume() < 20000);
    assert.equal(result.slicerSettings?.spiral_mode ?? '0', '0');
    assert.match(result.filenameBase, /hollow/);
  } finally { dispose(result); }
});

test('vase builder rejects dimensions and complexity outside the build contract', async () => {
  for (const changes of [{ height_mm: NaN }, { diameter_mm: 0 }, { wall_mm: -1 },
    { base_mm: 61 }, { construction: 'unsupported' }]) {
    await assert.rejects(() => build(changes), /vase/i);
  }
});

test('downloaded vase archives have consistent closed topology and independently measured dimensions', async () => {
  assert.equal(typeof module.default, 'function');
  const wasm = await loadEngine();
  const variants = [
    { construction: 'solid', facets: 6, twist_deg: 60 },
    { construction: 'solid', pattern: 'fractal', relief: 0.15, frequency: 2, vertical_frequency: 2 },
    { construction: 'hollow', facets: 6 },
  ];
  for (const variant of variants) {
    const params = { ...settings, ...variant };
    const exported = await buildModel({ id: 'vase', version: 1, build: module.default }, params, { wasm });
    const files = unzipSync(exported.data);
    const xml = strFromU8(files['3D/3dmodel.model']);
    const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map(match => match.slice(1).map(Number));
    const triangles = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map(match => match.slice(1).map(Number));
    assert.ok(vertices.length > 0 && triangles.length > 0);
    const edges = new Map();
    for (const triangle of triangles) {
      for (let i = 0; i < 3; i++) {
        const a = triangle[i], b = triangle[(i + 1) % 3];
        assert.ok(a !== b && a < vertices.length && b < vertices.length);
        const key = `${Math.min(a, b)},${Math.max(a, b)}`;
        const entry = edges.get(key) ?? { count: 0, winding: 0 };
        entry.count++;
        entry.winding += a < b ? 1 : -1;
        edges.set(key, entry);
      }
    }
    for (const entry of edges.values()) {
      assert.equal(entry.count, 2, 'Every downloaded edge must have exactly two incident faces.');
      assert.equal(entry.winding, 0, 'Downloaded incident faces must wind in opposite directions.');
    }
    const { metrics } = await analyzeModelOnServer({ name: exported.filename, bytes: exported.data });
    assert.ok(metrics.signedVolumeMm3 > 0);
    assert.equal(metrics.degenerateTriangles, 0);
    assert.ok(Math.abs(metrics.dimensionsMm[2] - 60) < 0.001);
    assert.ok(metrics.dimensionsMm[0] <= 50.001 && metrics.dimensionsMm[1] <= 50.001);
    const metadata = JSON.parse(strFromU8(files['Metadata/customizer.json']));
    assert.deepEqual(metadata.profile, params.profile);
    assert.equal(metadata.construction, variant.construction);
  }
});
