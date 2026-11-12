import assert from "node:assert/strict";
import test from "node:test";
import { OUTER, UPPER, LOWER, positiveContour } from "../../customizer/generators/route-shield/template.js";
import { loadEngine } from "../../customizer/framework/engine.js";

// The long, convex left cheek was visibly faceted in exported geometry.
// Measure the actual contour rather than a renderer's shading or vertex count.
test("route shield cheek follows a smooth curve in the printable outline", () => {
  const cheek = OUTER.filter(([x, y]) => x < -24 && y > -11.7 && y < -0.8);
  assert.ok(cheek.length > 20, `only ${cheek.length} cheek samples`);
  for (let i = 1; i < cheek.length - 1; i++) {
    const a = cheek[i - 1], b = cheek[i], c = cheek[i + 1];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    const turn = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
    assert.ok(turn < 0.08, `cheek turn ${turn} radians`);
  }
});

test("curved color fields stay separate and inside the printable shield", async () => {
  const { CrossSection } = await loadEngine();
  const solids = [];
  const keep = solid => { solids.push(solid); return solid; };
  try {
    const [outer, upper, lower] = [OUTER, UPPER, LOWER].map(points => keep(CrossSection.ofPolygons([positiveContour(points)])));
    assert.equal(keep(upper.subtract(outer)).area(), 0);
    assert.equal(keep(lower.subtract(outer)).area(), 0);
    assert.equal(keep(upper.intersect(lower)).area(), 0);
  } finally {
    for (const solid of solids.reverse()) solid.delete();
  }
});

test("smoothing preserves shield corners and straight color dividers", () => {
  for (const [contour, corners] of [
    [OUTER, [[-19.071,-27.23],[-19.071,-18.843],[-24.582,17.942],[-15.274,27.34],[-0.001,27.815],[15.274,27.34],[24.581,17.942],[17.976,-19.501]]],
    [UPPER, [[-18.058,10.629],[18.057,10.629],[-0.001,24.4]]],
    [LOWER, [[-17.891,8.619],[17.89,8.619],[-0.001,-21.408]]]
  ]) for (const corner of corners) assert.ok(contour.some(p => p[0] === corner[0] && p[1] === corner[1]), `missing ${corner}`);
  assert.ok(UPPER.length > 100);
  assert.ok(LOWER.length > 100);
  for (const [contour, start, end] of [[UPPER, [18.057,10.629], [-18.058,10.629]], [LOWER, [-17.891,8.619], [17.89,8.619]]]) {
    const i = contour.findIndex(p => p[0] === start[0] && p[1] === start[1]);
    assert.deepEqual(contour[(i + 1) % contour.length], end, "divider remains one straight edge");
  }
});
