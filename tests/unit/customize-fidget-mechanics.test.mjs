import test from 'node:test';
import assert from 'node:assert/strict';
import { hingeDimensions } from '../../public/assets/js/customize/fidget-mechanics.js';
import { buildHingeTools } from '../../customizer/generators/infinity-fidget/hinge.js';
import { loadEngine } from '../../customizer/framework/engine.js';
import { buildHingeCoupon } from '../../customizer/generators/infinity-fidget/coupon.js';
import { buildModel } from '../../customizer/framework/model.js';
import { partsToStl } from '../../customizer/framework/stl.js';
import { analyzeModelBytes } from '../../public/assets/js/print-estimation/geometry.js';
import { inflateRawSync } from 'node:zlib';

test('fidget hinge policy rejects nonfinite, undersized and unbounded geometry before allocation', () => {
  for (const key of ['blockSize', 'thickness', 'clearance']) {
    for (const value of [NaN, Infinity, -1, '20', null, 1000000]) {
      assert.throws(() => hingeDimensions({ [key]: value }), RangeError, `${key}=${value}`);
    }
  }
  assert.throws(() => hingeDimensions({ blockSize: 12, thickness: 8 }), RangeError);
});

test('hinge coupon survives the real 3MF and binary STL export/analyzer routes', async () => {
  const wasm = await loadEngine();
  const params = { clearance: 0.3 };
  const generator = { id: 'infinity-fidget-fit', version: 1, build: p => buildHingeCoupon(wasm, hingeDimensions(p)) };
  const model = await buildModel(generator, params, { wasm });
  assert.equal(model.metrics.part_count, 3);
  assert.equal(model.metrics.unique_colors, 2);
  const inflateRaw = async (bytes, max) => new Uint8Array(inflateRawSync(bytes, { maxOutputLength: max }));
  const a = await analyzeModelBytes({ name: model.filename, bytes: model.data, inflateRaw });
  const b = await analyzeModelBytes({ name: 'hinge-fit.stl', bytes: partsToStl(model.parts), inflateRaw });
  for (const analysis of [a, b]) assert.ok(analysis.volumeMm3 > 0);
  assert.deepEqual(a.warnings.filter(w => w !== 'embedded_settings_ignored'), []);
  // STL does not carry units; the existing intake correctly warns that mm are assumed.
  assert.deepEqual(b.warnings, ['units_assumed']);
  assert.ok(Math.abs(a.volumeMm3 - b.volumeMm3) / a.volumeMm3 < 1e-5);
});

test('production hinge coupon retains a moving connector between two separate socket bodies', async () => {
  const wasm = await loadEngine();
  for (const clearance of [0.2, 0.3, 0.5]) {
    const out = buildHingeCoupon(wasm, hingeDimensions({ clearance }));
    const temps = [];
    const t = s => { temps.push(s); return s; };
    try {
      assert.equal(out.solids.length, 3);
      for (const { solid } of out.solids) {
        assert.equal(solid.status(), 'NoError');
        assert.ok(solid.volume() > 0);
        assert.ok(Math.abs(solid.boundingBox().min[2]) < 1e-5, 'all parts have a bed contact');
        const pieces = solid.decompose();
        try { assert.equal(pieces.length, 1, 'no loose unconnected body cheeks'); }
        finally { pieces.forEach(s => s.delete()); }
      }
      const [link, left, right] = out.solids.map(s => s.solid);
      for (const [a, b] of [[link, left], [link, right], [left, right]]) {
        assert.ok(t(a.intersect(b)).volume() < 1e-7, 'separate printed parts never overlap');
      }
      const bodies = t(left.add(right));
      for (const sign of [-1, 1]) {
        assert.ok(t(t(link.translate([0, sign * (clearance + 0.1), 0])).intersect(bodies)).volume() > 0,
          'blind pin pockets retain the connector in both axial directions');
        assert.ok(t(t(link.translate([0, sign * clearance * 0.5, 0])).intersect(bodies)).volume() < 1e-7,
          'connector has actual axial play within the selected clearance');
      }
    } finally {
      temps.reverse().forEach(s => s.delete());
      out.solids.forEach(s => s.solid.delete());
    }
  }
});

test('each fit socket permits a full quarter-turn around its own captured pin', async () => {
  const wasm = await loadEngine(), h = hingeDimensions();
  const out = buildHingeCoupon(wasm, h);
  const [link, left, right] = out.solids.map(s => s.solid);
  try {
    for (const [side, body] of [[-1, left], [1, right]]) {
      const axis = [side * h.pivotSpacing / 2, 0, h.barrelRadius];
      const centered = body.translate(axis.map(v => -v));
      try {
        // Half-degree samples are independent of the socket sweep construction steps.
        for (let angle = 0; angle <= 90; angle += 0.5) {
          const rotated = centered.rotate([0, side * angle, 0]);
          const moved = rotated.translate(axis);
          const hit = moved.intersect(link);
          try { assert.ok(hit.volume() < 1e-7, `${side} socket collides at ${angle} degrees: ${hit.volume()} mm3`); }
          finally { hit.delete(); moved.delete(); rotated.delete(); }
        }
      } finally { centered.delete(); }
    }
  } finally { out.solids.forEach(s => s.solid.delete()); }
});

test('small and large valid hinge coupons retain clear motion and solid bodies', async () => {
  const wasm = await loadEngine();
  for (const settings of [
    { blockSize: 12, thickness: 4, clearance: 0.2 },
    { blockSize: 12, thickness: 4, clearance: 0.5 },
    { blockSize: 40, thickness: 10, clearance: 0.2 },
    { blockSize: 40, thickness: 10, clearance: 0.5 }
  ]) {
    const h = hingeDimensions(settings), out = buildHingeCoupon(wasm, h);
    const link = out.solids[0].solid;
    try {
      for (const [index, side] of [[1, -1], [2, 1]]) {
        const body = out.solids[index].solid;
        assert.equal(body.status(), 'NoError');
        const pieces = body.decompose();
        try { assert.equal(pieces.length, 1); } finally { pieces.forEach(s => s.delete()); }
        const axis = [side * h.pivotSpacing / 2, 0, h.barrelRadius];
        const centered = body.translate(axis.map(v => -v));
        try {
          for (let angle = 0; angle <= 90; angle += 7.5) {
            const a = centered.rotate([0, side * angle, 0]), b = a.translate(axis), hit = b.intersect(link);
            try { assert.ok(hit.volume() < 1e-7, `${JSON.stringify(settings)} at ${angle}`); }
            finally { hit.delete(); b.delete(); a.delete(); }
          }
        } finally { centered.delete(); }
      }
    } finally { out.solids.forEach(s => s.solid.delete()); }
  }
});

test('captured double-pivot hinge has separated material and positive radial and axial running gaps', async () => {
  const wasm = await loadEngine();
  for (const clearance of [0.2, 0.3, 0.5]) {
    const h = hingeDimensions({ clearance });
    const out = buildHingeTools(wasm, h);
    const temps = [];
    const t = s => { temps.push(s); return s; };
    try {
      const { connector, socket } = out;
      for (const s of [connector, socket]) {
        assert.equal(s.status(), 'NoError');
        assert.ok(s.volume() > 0);
        const pieces = s.decompose();
        try { assert.equal(pieces.length, 1); } finally { pieces.forEach(s => s.delete()); }
      }
      // Every point of the connector must lie inside its socket cutter.
      assert.ok(t(connector.subtract(socket)).volume() < 1e-7);
      const c = connector.boundingBox(), b = socket.boundingBox();
      assert.ok(Math.abs((b.max[1] - c.max[1]) - clearance) < 1e-5, 'axial end gap');
      assert.ok(Math.abs((c.min[1] - b.min[1]) - clearance) < 1e-5, 'opposite axial end gap');
      assert.ok(Math.abs((b.max[2] - c.max[2]) - clearance) < 1e-5, 'radial bearing gap');
      assert.ok(h.pinLength > h.linkWidth + 2 * clearance + 1.2, 'retention overlap outside the open link channel');
      // A transverse slice must show pin material beyond the narrower bridge.
      const cheekBlank = t(wasm.Manifold.cube([100, 0.3, 100], true));
      const cheek = t(cheekBlank.translate([0, h.linkWidth / 2 + clearance + 0.3, 0]));
      assert.ok(t(connector.intersect(cheek)).volume() > 0, 'captured pin ends are actual geometry');
    } finally {
      temps.reverse().forEach(s => s.delete());
      out.dispose();
    }
  }
});
