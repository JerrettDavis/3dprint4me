// Pure pumpkin math (no Manifold): the surface is a closed, consistently oriented mesh, the flat
// base and opening planes land where they should, and the tealight fit solver agrees with itself.
import assert from "node:assert/strict";
import test from "node:test";
import { baseCut, cavityScale, faceBox, geometry, minTealightDiameter, MIN_BASE_RADIUS_MM, openCut, resolution, splitCut, surfaceMesh, tealightFit } from "../../public/assets/js/customize/pumpkin-shape.js";
import pumpkin from "../../public/assets/js/customize/generators/pumpkin.js";

const defaults = () => Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.default]));

function edgeBalance({ idx }) {
  const directed = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[i + k], b = idx[i + (k + 1) % 3];
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [key, n] of directed) {
    const [a, b] = key.split(">");
    if (n !== 1 || directed.get(`${b}>${a}`) !== 1) bad++;
  }
  return bad;
}

const VARIANTS = {
  defaults: {},
  ridged: { decoration: "ridges" },
  knit: { decoration: "knit" },
  twisted: { twist_deg: 90, taper_pct: 30, oblong_pct: 25, irregularity_pct: 100 },
  boxy: { boxiness_pct: 100, dimple_pct: 20, height_pct: 55 },
  sharp: { segments: 16, rib_sharpness: 8, rib_depth_pct: 25 }
};

for (const [name, over] of Object.entries(VARIANTS)) {
  test(`surface mesh (${name}) is closed and oriented: every edge pairs with its reverse`, () => {
    const p = { ...defaults(), ...over };
    const mesh = surfaceMesh(geometry(p), resolution(p));
    assert.equal(edgeBalance(mesh), 0);
    assert.ok(mesh.pos.every(Number.isFinite), "no NaN or infinite coordinates");
  });
}

test("the same parameters (and seed) give the same surface; a new seed changes an irregular one", () => {
  const p = { ...defaults(), irregularity_pct: 80 };
  const a = surfaceMesh(geometry(p), resolution(p)).pos;
  const b = surfaceMesh(geometry(p), resolution(p)).pos;
  assert.deepEqual([...a], [...b]);
  const q = { ...p, seed: 8 };
  assert.notDeepEqual([...surfaceMesh(geometry(q), resolution(q)).pos], [...a]);
  const flat = { ...defaults(), irregularity_pct: 0 };
  assert.deepEqual([...surfaceMesh(geometry(flat), resolution(flat)).pos], [...surfaceMesh(geometry({ ...flat, seed: 99 }), resolution(flat)).pos], "seed is inert without irregularity");
});

test("lobes: grooves sit at the requested count and depth", () => {
  const p = { ...defaults(), segments: 8, rib_depth_pct: 20, rib_sharpness: 2 };
  const g = geometry(p);
  assert.ok(Math.abs(g.lobe(0, Math.PI / 2) - 0.8) < 1e-9, "groove at theta = 0 is 20 % in");
  assert.ok(Math.abs(g.lobe(Math.PI / 8, Math.PI / 2) - 1) < 1e-9, "crest halfway between grooves");
  assert.ok(Math.abs(g.lobe(Math.PI / 4, Math.PI / 2) - 0.8) < 1e-9, "next groove one lobe over (8 lobes)");
});

test("body size follows the width and height settings", () => {
  const p = { ...defaults(), diameter_mm: 100, height_pct: 70, rib_depth_pct: 0, boxiness_pct: 0, dimple_pct: 0, taper_pct: 0 };
  const g = geometry(p);
  assert.equal(g.a, 50);
  assert.ok(Math.abs(g.H - 70) < 1e-9);
  const mesh = surfaceMesh(g, resolution(p));
  let maxR = 0, maxZ = -Infinity, minZ = Infinity;
  for (let i = 0; i < mesh.pos.length; i += 3) { maxR = Math.max(maxR, Math.hypot(mesh.pos[i], mesh.pos[i + 1])); maxZ = Math.max(maxZ, mesh.pos[i + 2]); minZ = Math.min(minZ, mesh.pos[i + 2]); }
  assert.ok(Math.abs(maxR - 50) < 0.5, `radius ${maxR}`);
  assert.ok(Math.abs(maxZ - 35) < 1e-3 && Math.abs(minZ + 35) < 1e-3, `${minZ}..${maxZ}`);
});

test("flat base is never narrower than 30 mm across, and wider settings give a higher cut", () => {
  const small = { ...defaults(), diameter_mm: 50, flat_base_pct: 30 };
  assert.ok(baseCut(small).radius >= MIN_BASE_RADIUS_MM - 1e-9);
  const narrow = baseCut({ ...defaults(), flat_base_pct: 30 }), wide = baseCut({ ...defaults(), flat_base_pct: 80 });
  assert.ok(wide.z > narrow.z, "a wider base is cut higher up the body");
});

test("opening and split planes are ordered: base < split < opening-ish < top", () => {
  const p = defaults();
  const g = geometry(p);
  const base = baseCut(p, g).z, split = splitCut(p, g).z, open = openCut(p, g).z;
  assert.ok(base < split && split < g.b);
  assert.ok(open > 0 && open < g.b);
  assert.ok(openCut({ ...p, opening_pct: 45 }).z > openCut({ ...p, opening_pct: 90 }).z, "a narrower opening is cut higher");
});

test("the scaled cavity is smaller on every axis and leaves about the wall at the sides", () => {
  const p = { ...defaults(), wall_mm: 2, oblong_pct: 10 };
  const g = geometry(p);
  const [sx, sy, sz] = cavityScale(p, g);
  assert.ok(sx < 1 && sy < 1 && sz < 1 && sx > 0.8);
  assert.ok(Math.abs(g.a * (1 + g.ob) * (1 - sx) - 2) < 1e-9);
});

test("tealight fit: the solver's diameter fits, one millimetre less does not (or is the floor)", () => {
  const p = { ...defaults(), style: "hollow", opening: "bottom" };
  const need = minTealightDiameter(p);
  assert.ok(need && need >= 50 && need <= 200);
  const at = tealightFit({ ...p, diameter_mm: need });
  assert.ok(at.opening >= 41 && at.height >= 17, JSON.stringify(at));
  if (need > 50) assert.ok(tealightFit({ ...p, diameter_mm: need - 1 }).opening < 41 || tealightFit({ ...p, diameter_mm: need - 1 }).height < 17);
});

test("face box scales with the pumpkin and the face size", () => {
  const p = defaults();
  const a = faceBox(p), b = faceBox({ ...p, face_size_pct: 90 }), c = faceBox({ ...p, diameter_mm: 160 });
  assert.ok(b.width > a.width && c.width > a.width);
  assert.ok(a.top > a.centerZ && a.bottom < a.centerZ);
});
