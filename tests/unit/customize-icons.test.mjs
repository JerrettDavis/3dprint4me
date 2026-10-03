import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { ICONS, iconCrossSection } from "../../customizer/framework/icons.js";
import { traceImage, imageCrossSection, checkContours, MAX_CONTOUR_POINTS } from "../../customizer/framework/image-trace.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const { CrossSection } = wasm;

// Collect-and-delete helper for tests: every CrossSection made here is freed at the end.
function scope(fn) {
  const temps = [];
  const t = o => { temps.push(o); return o; };
  try { return fn(t); } finally { for (const o of temps) o.delete(); }
}
const pieces = (cs, t) => { const parts = cs.decompose(); parts.forEach(t); return parts.length; };

test("every bundled icon is a non-empty, bounded shape", () => {
  assert.deepEqual(Object.keys(ICONS).sort(), ["heart", "house", "mug", "toilet"]);
  for (const id of Object.keys(ICONS)) scope(t => {
    const cs = t(iconCrossSection(CrossSection, id));
    const b = cs.bounds();
    assert.ok(cs.area() > 200, `${id} area`);
    assert.ok(b.max[0] - b.min[0] <= 100.01 && b.max[1] - b.min[1] <= 100.01, `${id} bounds`);
    // Normalized: the long side is 100 and the shape is centered on the origin.
    assert.ok(Math.abs(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) - 100) < 0.01, `${id} long side`);
    assert.ok(Math.abs(b.min[0] + b.max[0]) < 0.01 && Math.abs(b.min[1] + b.max[1]) < 0.01, `${id} centered`);
    assert.equal(typeof ICONS[id].label, "string");
  });
});

test("an unknown icon id is a readable error, never an inherited property", () => {
  assert.throws(() => iconCrossSection(CrossSection, "__proto__"), /unknown icon/i);
  assert.throws(() => iconCrossSection(CrossSection, "toString"), /unknown icon/i);
});

test("each icon prints as its intended number of pieces with no feature thinner than 0.8 mm at 28 mm", () => {
  for (const [id, icon] of Object.entries(ICONS)) scope(t => {
    const cs = t(t(iconCrossSection(CrossSection, id)).scale([0.28, 0.28]));
    const expected = icon.pieces ?? 1;
    assert.equal(pieces(cs, t), expected, `${id} pieces`);
    // Morphological opening by a 0.4 mm radius disc erases every part thinner than 0.8 mm (two
    // nozzle widths); closing fills every gap narrower than 0.8 mm. What they change must be only
    // corner slivers: nothing in the difference may be thick (it would survive a 0.15 mm
    // erosion; a 0.35 mm tail or slot leaves 0.13 mm², icons leave under 0.02 mm²).
    const opened = t(t(cs.offset(-0.4, "Round", 2, 32)).offset(0.4, "Round", 2, 32));
    assert.equal(pieces(opened, t), expected, `${id}: a thin part was erased or split off`);
    const lost = t(cs.subtract(opened));
    assert.ok(lost.area() < 1, `${id}: opening removed ${lost.area().toFixed(2)} mm²`);
    assert.ok(t(lost.offset(-0.15, "Round")).area() < 0.05, `${id}: a part thinner than 0.8 mm`);
    const closed = t(t(cs.offset(0.4, "Round", 2, 32)).offset(-0.4, "Round", 2, 32));
    assert.ok(t(t(closed.subtract(cs)).offset(-0.15, "Round")).area() < 0.05, `${id}: a gap narrower than 0.8 mm`);
  });
});

test("the toilet has the seat opening and the flush button as holes", () => scope(t => {
  const cs = t(iconCrossSection(CrossSection, "toilet"));
  const filled = t(CrossSection.ofPolygons(cs.toPolygons().filter(p => {
    let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a > 0;
  })));
  assert.ok(filled.area() - cs.area() > 150, "the toilet's holes are real holes");
}));

const blank = (W, H, v = 255) => new Uint8ClampedArray(W * H * 4).fill(v);
function paint(px, W, x0, y0, x1, y1, rgb = 0) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = rgb; px[i + 3] = 255; }
}

test("tracing a black square on white yields one contour near the square", () => scope(t => {
  const W = 40, H = 40, px = blank(W, H);
  paint(px, W, 10, 10, 30, 30);
  const contours = traceImage({ pixels: px, width: W, height: H, threshold: 128, invert: false });
  const cs = t(imageCrossSection(CrossSection, contours));
  assert.ok(Math.abs(cs.area() - 400) / 400 < 0.1, `area ${cs.area()}`);
  assert.equal(pieces(cs, t), 1);
}));

test("the traced image is upright: a mark at the top of the picture is at +Y", () => scope(t => {
  const W = 40, H = 40, px = blank(W, H);
  paint(px, W, 5, 2, 35, 10);   // wide bar near the top row
  paint(px, W, 18, 10, 22, 38); // stem down
  const cs = t(imageCrossSection(CrossSection, traceImage({ pixels: px, width: W, height: H })));
  const b = cs.bounds();
  const top = t(cs.intersect(t(CrossSection.square([100, 6]).translate([-50, b.max[1] - 6])))).area();
  assert.ok(top > 150, `the bar is at the top (${top})`);
}));

test("invert traces the light parts; transparency counts as white", () => scope(t => {
  const W = 20, H = 20, px = blank(W, H, 0);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  paint(px, W, 5, 5, 15, 15, 255);
  const cs = t(imageCrossSection(CrossSection, traceImage({ pixels: px, width: W, height: H, invert: true })));
  assert.ok(Math.abs(cs.area() - 100) / 100 < 0.15, `area ${cs.area()}`);
  const clear = new Uint8ClampedArray(W * H * 4);  // fully transparent black
  assert.throws(() => traceImage({ pixels: clear, width: W, height: H }), /nothing to trace/i);
}));

test("large images are box-downsampled to at most maxCells on the long edge", () => {
  const W = 400, H = 200, px = blank(W, H);
  paint(px, W, 0, 0, 200, 200);
  const contours = traceImage({ pixels: px, width: W, height: H, maxCells: 96 });
  const xs = contours.flat().map(p => p[0]), ys = contours.flat().map(p => p[1]);
  assert.ok(Math.max(...xs) <= 96 && Math.max(...ys) <= 48, `${Math.max(...xs)} x ${Math.max(...ys)}`);
});

test("isolated single-cell specks are smoothed away", () => scope(t => {
  const W = 40, H = 40, px = blank(W, H);
  paint(px, W, 10, 10, 30, 30);
  paint(px, W, 2, 2, 3, 3);       // lone dark speck
  paint(px, W, 20, 20, 21, 21, 255); // lone light pinhole
  const cs = t(imageCrossSection(CrossSection, traceImage({ pixels: px, width: W, height: H })));
  assert.equal(pieces(cs, t), 1);
  assert.ok(Math.abs(cs.area() - 400) / 400 < 0.1, `area ${cs.area()}`);
}));

test("hostile images are bounded or rejected with readable errors", () => {
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(0), width: 0, height: 0, threshold: 128 }), /empty/i);
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(16), width: 1000000, height: 1000000, threshold: 128 }), /too large/i);
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(100), width: 10, height: 10 }), /size|malformed/i);
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(10 * 10 * 4 + 4), width: 10, height: 10 }), /size|malformed/i);
  assert.throws(() => traceImage({ pixels: [1, 2, 3, 4], width: 1, height: 1 }), /malformed/i);
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(4), width: 1.5, height: 1 }), /malformed|empty/i);
  assert.throws(() => traceImage({ pixels: blank(40, 40), width: 40, height: 40, threshold: 128 }), /nothing to trace|no shape/i);
  assert.throws(() => traceImage({ pixels: blank(40, 40, 0).map((v, i) => (i % 4 === 3 ? 255 : 0)), width: 40, height: 40 }), /whole image|all dark/i);
  assert.throws(() => traceImage({ pixels: blank(4, 4), width: 4, height: 4, threshold: 300 }), /threshold/i);
});

test("traced contours are bounded in count", () => {
  // A worst-case checkerboard at full resolution still yields a bounded number of points.
  const W = 96, H = 96, px = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + y) % 2) paint(px, W, x, y, x + 1, y + 1);
  let contours = [];
  try { contours = traceImage({ pixels: px, width: W, height: H }); } catch (e) { assert.match(e.message, /nothing to trace|whole image/i); }
  assert.ok(contours.flat().length <= MAX_CONTOUR_POINTS);
});

test("checkContours accepts traced output and rejects malformed or oversized contour data", () => {
  assert.doesNotThrow(() => checkContours([[[0, 0], [1, 0], [1, 1]]]));
  for (const bad of [null, "x", [], [[[0, 0], [1, 1]]], [[[0, 0], [1, Number.NaN], [1, 1]]], [[[0, 0], [1, 0], ["a", 1]]], [[[0, 0], [1e9, 0], [1, 1]]], [{ length: 3 }]]) {
    assert.throws(() => checkContours(bad), /image|outline/i, JSON.stringify(bad));
  }
  const huge = [Array.from({ length: MAX_CONTOUR_POINTS + 1 }, (_, i) => [i % 50, Math.floor(i / 50) % 50])];
  assert.throws(() => checkContours(huge), /too detailed/i);
});

test("icon and image helpers free their temporaries", () => {
  const tracker = trackLiveObjects(wasm);
  try {
    for (const id of Object.keys(ICONS)) {
      const cs = iconCrossSection(tracker.ctxWasm.CrossSection, id);
      assert.equal(tracker.live.size, 1, `${id}: ${tracker.live.size} live`);
      cs.delete();
    }
    const W = 30, H = 30, px = blank(W, H);
    paint(px, W, 5, 5, 25, 25);
    const cs = imageCrossSection(tracker.ctxWasm.CrossSection, traceImage({ pixels: px, width: W, height: H }));
    assert.equal(tracker.live.size, 1);
    cs.delete();
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});

test("the leak guard really sees a leaked temporary", () => {
  const tracker = trackLiveObjects(wasm);
  try {
    const sq = tracker.ctxWasm.CrossSection.square([1, 1]);
    const moved = sq.translate([1, 1]);
    sq.delete();
    assert.equal(tracker.live.size, 1);
    moved.delete();
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});
