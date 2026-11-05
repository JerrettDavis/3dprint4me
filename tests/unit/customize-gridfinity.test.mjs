import test from 'node:test';
import assert from 'node:assert/strict';
import { cellCenters, footprint, footSection, GRIDFINITY } from '../../public/assets/js/customize/gridfinity.js';
import { loadEngine } from '../../customizer/framework/engine.js';
import { normalizeCustomization } from '../../lib/customization/domain.js';
import { clampParams, validateParams } from '../../public/assets/js/customize/schema.js';

test('Gridfinity rectangular occupancy uses fixed 42 mm cell centers', () => {
  assert.deepEqual(cellCenters(1, 1), [[0, 0]]);
  assert.deepEqual(cellCenters(3, 2), [[-42, -21], [0, -21], [42, -21], [-42, 21], [0, 21], [42, 21]]);
  assert.deepEqual(footprint(3, 2), { width: 125.5, depth: 83.5 });
  assert.deepEqual(footprint(1, 1), { width: 41.5, depth: 41.5 });
  assert.equal(GRIDFINITY.heightUnit, 7);
});

test('baseplate variants build connected rails and reduced-material plate uses less material', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-base.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-base/build.js');
  const wasm = await loadEngine();
  const volumes = {};
  for (const style of ['standard', 'light', 'magnetic']) {
    const v = validateParams(g, { style, columns: 2, rows: 2 });
    assert.ok(v.ok, v.errors?.join(';'));
    const out = await build(v.value, { wasm });
    try {
      const s = out.solids[0].solid;
      assert.equal(s.status(), 'NoError');
      const pieces = s.decompose();
      try { assert.equal(pieces.length, 1, style); } finally { pieces.forEach(p => p.delete()); }
      const b = s.boundingBox();
      assert.equal(b.max[0] - b.min[0], 84);
      assert.equal(b.max[1] - b.min[1], 84);
      assert.equal(b.min[2], 0);
      assert.equal(b.max[2], style === 'magnetic' ? 7.95 : 4.75, 'magnetless variants retain full foot seating height');
      volumes[style] = s.volume();
    } finally { out.solids.forEach(p => p.solid.delete()); }
  }
  assert.ok(volumes.light < volumes.standard * 0.75);
  assert.ok(volumes.magnetic > volumes.standard);
  assert.equal(validateParams(g, { columns: 7 }).ok, false);
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

test('baseplate edge footprints stay connected within the 20 second build budget', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-base.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-base/build.js');
  const wasm = await loadEngine();
  for (const [columns, rows] of [[1, 1], [1, 6], [6, 1], [6, 6]]) {
    for (const style of ['standard', 'light', 'magnetic']) {
      const p = validateParams(g, { columns, rows, style }).value;
      const start = performance.now();
      const out = build(p, { wasm });
      try {
        const s = out.solids[0].solid;
        assert.equal(s.status(), 'NoError');
        const pieces = s.decompose();
        try { assert.equal(pieces.length, 1, `${columns}x${rows} ${style}`); } finally { pieces.forEach(p => p.delete()); }
        assert.ok(performance.now() - start < 20000);
      } finally { out.solids.forEach(p => p.solid.delete()); }
    }
  }
});

test('magnetic plate glue pockets open down with a 1 mm roof beneath the socket', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-base.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-base/build.js');
  const wasm = await loadEngine();
  const out = build(validateParams(g, { columns: 1, rows: 1, style: 'magnetic' }).value, { wasm });
  const probe = wasm.Manifold.cylinder(0.1, 0.1, 0.1, 12);
  const volumeAt = (x, y, z) => {
    const placed = probe.translate([x, y, z]);
    const hit = out.solids[0].solid.intersect(placed);
    try { return hit.volume(); } finally { hit.delete(); placed.delete(); }
  };
  try {
    for (const x of [-13, 13]) for (const y of [-13, 13]) {
      assert.ok(volumeAt(x, y, 0.1) < 1e-8);
      assert.ok(volumeAt(x, y, 2.1) < 1e-8);
      assert.ok(volumeAt(x, y, 2.25) > 0.002);
      assert.ok(volumeAt(x, y, 3.05) > 0.002);
    }
    assert.ok(volumeAt(0, 0, 0.1) > 0.002);
    assert.ok(volumeAt(0, 0, 3.3) < 1e-8);
  } finally { probe.delete(); out.solids.forEach(p => p.solid.delete()); }
});

test('bin variants validate, build connected solids and isolate vase print settings', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-bin/build.js');
  const wasm = await loadEngine();
  for (const [name, params] of Object.entries({ standard: {}, magnetic: { magnets: true }, labeled: { label_shelf: true }, divided: { compartments_x: 2, compartments_y: 2 }, thin: { wall_mm: 1.2 }, shell: { style: 'vase', stacking_lip: false }, adapter: { style: 'vase', stacking_lip: false, vase_part: 'adapter' } })) {
    const checked = validateParams(g, params);
    assert.ok(checked.ok, `${name}: ${checked.errors?.join(';')}`);
    const out = build(checked.value, { wasm });
    try {
      assert.equal(out.solids.length, 1);
      const s = out.solids[0].solid;
      assert.equal(s.status(), 'NoError', name);
      const pieces = s.decompose();
      try { assert.equal(pieces.length, 1, name); } finally { pieces.forEach(p => p.delete()); }
      assert.equal(s.boundingBox().min[2], 0);
      assert.ok(s.volume() > 0);
      if (name === 'shell') {
        assert.equal(out.slicerSettings.spiral_mode, '1');
        assert.equal(out.slicerSettings.top_shell_thickness, '0');
        assert.equal(out.slicerSettings.bottom_shell_thickness, '1.2');
        assert.equal(out.slicerSettings.outer_wall_line_width, '0.45');
        assert.equal(out.slicerSettings.wall_loops, '1');
      }
      else assert.ok(!out.slicerSettings?.spiral_mode || out.slicerSettings.spiral_mode === '0');
      if (['shell', 'adapter'].includes(name)) assert.ok(out.filenameBase.endsWith(`vase-${name}`));
    } finally { out.solids.forEach(p => p.solid.delete()); }
  }
  for (const params of [{ style: 'vase' }, { style: 'vase', stacking_lip: false, magnets: true }, { height_units: 2, label_shelf: true }, { columns: 1, compartments_x: 6 }]) {
    assert.equal(validateParams(g, params).ok, false);
  }
});

test('bin form safely clamps a temporarily blank or out-of-range cell count', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const defaults = validateParams(g, {}).value;
  for (const columns of [0, 7, NaN]) {
    assert.doesNotThrow(() => clampParams(g, { ...defaults, columns }, 'columns'));
    assert.equal(validateParams(g, { ...defaults, columns }).ok, false);
  }
});

test('standard feet clear both sockets and stacking lips without geometric interference', async () => {
  const { gridFoot } = await import('../../customizer/generators/gridfinity/shared.js');
  const { default: bin } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const { default: base } = await import('../../public/assets/js/customize/generators/gridfinity-base.js');
  const { default: buildBin } = await import('../../customizer/generators/gridfinity-bin/build.js');
  const { default: buildBase } = await import('../../customizer/generators/gridfinity-base/build.js');
  const wasm = await loadEngine();
  const foot = gridFoot(wasm);
  try {
    for (const style of ['standard', 'light', 'magnetic']) {
      const out = buildBase(validateParams(base, { columns: 1, rows: 1, style }).value, { wasm });
      const inserted = foot.translate([0, 0, style === 'magnetic' ? 3.2 : 0]);
      const hit = inserted.intersect(out.solids[0].solid);
      try { assert.ok(hit.volume() < 1e-6, style); }
      finally { hit.delete(); inserted.delete(); out.solids.forEach(p => p.solid.delete()); }
    }
    const out = buildBin(validateParams(bin, { columns: 1, rows: 1 }).value, { wasm });
    const inserted = foot.translate([0, 0, 42]);
    const hit = inserted.intersect(out.solids[0].solid);
    try { assert.ok(hit.volume() < 1e-6, 'stacking lip clears the inserted standard foot'); }
    finally { hit.delete(); inserted.delete(); out.solids.forEach(p => p.solid.delete()); }
  } finally { foot.delete(); }
});

test('bin minimum strips and maximum divided magnetic footprint remain connected within budget', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-bin/build.js');
  const wasm = await loadEngine();
  for (const params of [{ columns: 1, rows: 1, height_units: 2 }, { columns: 1, rows: 6 }, { columns: 6, rows: 1 }, { columns: 6, rows: 6, height_units: 12, magnets: true, label_shelf: true, compartments_x: 6, compartments_y: 6 }]) {
    const checked = validateParams(g, params);
    assert.ok(checked.ok);
    const start = performance.now();
    const out = build(checked.value, { wasm });
    try {
      const s = out.solids[0].solid;
      assert.equal(s.status(), 'NoError');
      const pieces = s.decompose();
      try { assert.equal(pieces.length, 1); } finally { pieces.forEach(p => p.delete()); }
      assert.ok(performance.now() - start < 20000);
    } finally { out.solids.forEach(p => p.solid.delete()); }
  }
});

test('magnet pocket clearance is bounded, adjustable and changes geometry in both generators', async () => {
  const wasm = await loadEngine();
  for (const id of ['base', 'bin']) {
    const { default: g } = await import(`../../public/assets/js/customize/generators/gridfinity-${id}.js`);
    const { default: build } = await import(`../../customizer/generators/gridfinity-${id}/build.js`);
    const values = { columns: 1, rows: 1, ...(id === 'base' ? { style: 'magnetic' } : { magnets: true }) };
    for (const bad of [{ magnet_diameter_mm: 6.5 }, { magnet_depth_mm: 2.5 }]) assert.equal(validateParams(g, { ...values, ...bad }).ok, false);
    const volumes = [];
    for (const [magnet_diameter_mm, magnet_depth_mm] of [[6, 2], [6.4, 2.4]]) {
      const checked = validateParams(g, { ...values, magnet_diameter_mm, magnet_depth_mm });
      assert.ok(checked.ok, checked.errors?.join(';'));
      const out = build(checked.value, { wasm });
      try { volumes.push(out.solids[0].solid.volume()); } finally { out.solids.forEach(p => p.solid.delete()); }
    }
    assert.ok(volumes[1] < volumes[0], `${id}: larger pockets remove more material`);
  }
});

test('server normalization pins each vase component and rejects incompatible options', () => {
  for (const vase_part of ['shell', 'adapter']) {
    const out = normalizeCustomization({ generatorId: 'gridfinity-bin', generatorVersion: 1, params: { style: 'vase', vase_part, stacking_lip: false } });
    assert.equal(out.params.vase_part, vase_part);
    assert.equal(out.params.style, 'vase');
  }
  for (const invalid of [{ magnets: true }, { stacking_lip: true }, { label_shelf: true }, { compartments_x: 2 }]) {
    assert.throws(() => normalizeCustomization({ generatorId: 'gridfinity-bin', generatorVersion: 1, params: { style: 'vase', stacking_lip: false, ...invalid } }), e => e.status === 400 && e.details?.code === 'customization-stale');
  }
  assert.throws(() => normalizeCustomization({ generatorId: 'gridfinity-base', generatorVersion: 1, params: { rows: 7 } }), e => e.status === 400);
});

test('stacking lip ends in a printable 0.4 mm land rather than a zero-width knife edge', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-bin/build.js');
  const wasm = await loadEngine();
  const out = build(validateParams(g, { columns: 1, rows: 1 }).value, { wasm });
  const cube = wasm.Manifold.cube([0.1, 1, 0.05]);
  const probe = cube.translate([20.45, -0.5, 45.9]);
  const hit = out.solids[0].solid.intersect(probe);
  try {
    assert.equal(out.solids[0].solid.boundingBox().max[2], 46);
    assert.ok(hit.volume() > 0.0049);
  } finally { hit.delete(); probe.delete(); cube.delete(); out.solids.forEach(p => p.solid.delete()); }
});

test('bin floor, 1.2 mm dividers and the 45 degree shelf underside match their dimensions', async () => {
  const { default: g } = await import('../../public/assets/js/customize/generators/gridfinity-bin.js');
  const { default: build } = await import('../../customizer/generators/gridfinity-bin/build.js');
  const wasm = await loadEngine();
  const out = build(validateParams(g, { stacking_lip: false, label_shelf: true, compartments_x: 2, compartments_y: 2 }).value, { wasm });
  const probe = wasm.Manifold.cube([0.05, 0.05, 0.05]);
  const contains = (x, y, z) => {
    const moved = probe.translate([x, y, z]);
    const hit = out.solids[0].solid.intersect(moved);
    try { return hit.volume() > 0.00012; } finally { hit.delete(); moved.delete(); }
  };
  try {
    assert.ok(contains(10, 10, 5.85), 'floor under the cavity');
    assert.ok(!contains(10, 10, 5.96), 'cavity starts 1.2 mm above the 4.75 mm foot');
    assert.ok(contains(0.5, 10, 15));
    assert.ok(!contains(0.7, 10, 15));
    assert.ok(contains(10, 0.5, 15));
    assert.ok(!contains(10, 0.7, 15));
    // Shelf starts at z32.8, y40.25; at z36.8 its ramp has grown inward 4 mm.
    assert.ok(contains(10, 37, 36.8));
    assert.ok(!contains(10, 35.5, 36.8));
    assert.ok(contains(10, 33, 41));
  } finally { probe.delete(); out.solids.forEach(p => p.solid.delete()); }
});
