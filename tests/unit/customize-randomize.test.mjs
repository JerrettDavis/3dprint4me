// Ready-made designs and the safe randomizer: pure logic, no browser.
import assert from "node:assert/strict";
import test from "node:test";
import { applyDesign, designGroups, designSwatches } from "../../customizer/framework/designs.js";
import { isRandomizable, randomizeParams } from "../../customizer/framework/randomize.js";
import { GENERATORS } from "../../public/assets/js/customize/registry.js";
import { sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

const generators = Object.values(GENERATORS);
const start = g => ({ ...validateParams(g, {}).value, ...Object.fromEntries(sensitiveKeys(g).map(k => [k, "hunter2-canary"])) });
// A small deterministic generator (mulberry32) so a failure reproduces.
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("every generator offers designs, a default among them, in named groups", () => {
  for (const g of generators) {
    assert.ok((g.designs ?? []).length >= 4, g.id);
    assert.ok(g.designs.some(d => d.id === g.defaultDesign), `${g.id} default design`);
    assert.ok(designGroups(g).length >= 1);
    assert.deepEqual(applyDesign(g, g.designs.find(d => d.id === g.defaultDesign), {}), clampLike(g), `${g.id}: the default design is the defaults`);
  }
});
function clampLike(g) { return validateParams(g, {}).value; }

test("route shield offers interstates, with 66 first and the default", () => {
  const g = GENERATORS["route-shield"];
  assert.equal(g.defaultDesign, "route-66");
  assert.equal(g.designs[0].id, "route-66");
  assert.ok(g.designs.filter(d => d.group === "Interstates").length >= 5);
  assert.equal(applyDesign(g, g.designs.find(d => d.id === "i-95"), {}).lower_text, "95");
});

test("name plate offers several common names and plate styles", () => {
  const g = GENERATORS["name-plate"];
  assert.ok(g.designs.filter(d => d.group === "Common names").length >= 8);
  assert.ok(g.designs.filter(d => d.group === "Plate styles").length >= 5);
});

test("choosing a design keeps a secret and never stores one", () => {
  const g = GENERATORS["wifi-tag"];
  const out = applyDesign(g, g.designs.find(d => d.id === "sunny"), { password: "correct horse", ssid: "Typed" });
  assert.equal(out.password, "correct horse");
  assert.equal(out.ssid, "Guest WiFi", "a design brings its own sample text");
  for (const d of g.designs) for (const k of sensitiveKeys(g)) assert.ok(!(k in d.params));
});

test("a design swatch lists distinct colors only", () => {
  for (const g of generators) for (const d of g.designs) {
    const sw = designSwatches(g, d);
    assert.ok(sw.length >= 1 && sw.length <= 5);
    assert.equal(new Set(sw).size, sw.length);
  }
});

test("randomize never touches text, secrets, QR settings or locked fields, and stays valid", () => {
  for (const g of generators) {
    const current = start(g);
    const locked = new Set(Object.entries(g.schema).filter(([, d]) => d.type === "color").map(([k]) => k).slice(0, 2));
    for (let seed = 1; seed <= 25; seed++) {
      const out = randomizeParams(g, current, { locked, rng: seeded(seed) });
      assert.ok(out.ok, `${g.id} seed ${seed}`);
      assert.ok(out.changed.length > 0);
      assert.ok(validateParams(g, out.params).ok, `${g.id} seed ${seed}: ${validateParams(g, out.params).errors.join("; ")}`);
      for (const [key, def] of Object.entries(g.schema)) {
        if (def.type === "text" || def.sensitive || def.randomize === false || def.locationFont || locked.has(key)) {
          assert.deepEqual(out.params[key], current[key], `${g.id} seed ${seed}: ${key} must not change`);
        }
      }
    }
  }
});

test("randomize is deterministic for a seed and produces variety across seeds", () => {
  const g = GENERATORS["name-plate"];
  const current = start(g);
  assert.deepEqual(randomizeParams(g, current, { rng: seeded(7) }), randomizeParams(g, current, { rng: seeded(7) }));
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) seen.add(JSON.stringify(randomizeParams(g, current, { rng: seeded(seed) }).params));
  assert.ok(seen.size >= 10);
});

test("randomize only picks curated fonts, and a font nobody can license-check is never chosen", () => {
  const g = GENERATORS["name-plate"];
  const current = start(g);
  for (let seed = 1; seed <= 40; seed++) {
    const { params } = randomizeParams(g, current, { rng: seeded(seed) });
    assert.ok(!["system", "custom"].includes(params.font));
    assert.equal(params.font_license_ack, false);
  }
});

test("randomize with everything locked changes nothing and says so", () => {
  const g = GENERATORS["rating-card"];
  const current = start(g);
  const all = new Set(Object.keys(g.schema).filter(k => isRandomizable(g.schema[k])));
  const out = randomizeParams(g, current, { locked: all, rng: seeded(3) });
  assert.equal(out.ok, false);
  assert.deepEqual(out.params, current);
});

test("number settings stay near where they are", () => {
  const g = GENERATORS["name-plate"];
  const current = { ...start(g), height_mm: 30 };
  for (let seed = 1; seed <= 30; seed++) {
    const { params } = randomizeParams(g, current, { locked: new Set(["plate", "style"]), rng: seeded(seed) });
    assert.ok(Math.abs(params.height_mm - 30) <= (60 - 14) * 0.2 + 1e-6, `height ${params.height_mm}`);
  }
});

test("the rating card never randomizes to a custom image", () => {
  const g = GENERATORS["rating-card"];
  for (let seed = 1; seed <= 40; seed++) assert.notEqual(randomizeParams(g, start(g), { rng: seeded(seed) }).params.icon, "custom");
});
