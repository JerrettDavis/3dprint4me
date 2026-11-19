import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadEngine } from "../../customizer/framework/engine.js";
import { loadFont } from "../../customizer/framework/fonts.js";
import { applyDesign } from "../../customizer/framework/designs.js";
import build from "../../customizer/generators/holiday-ornament/build.js";
import ornament from "../../public/assets/js/customize/generators/holiday-ornament.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";

const wasm = await loadEngine();
const getFont = fontId => loadFont({ fontId, fetchImpl: async path =>
  new Response(await readFile(new URL(`../../customizer/static/fonts/${path.split("/").pop()}`, import.meta.url))) });

test("ornament settings reject empty names, invalid scenes and unreadable color pairs", () => {
  const { fieldErrors } = validateParams(ornament, { name: "  ", scene: "unknown" });
  assert.ok(fieldErrors.name);
  assert.ok(fieldErrors.scene);
  assert.ok(validateParams(ornament, { snow_color: "#80253f" }).fieldErrors.snow_color);
  assert.ok(validateParams(ornament, { year: "20AB" }).fieldErrors.year);
  assert.ok(validateParams(ornament, { year: "" }).ok);
});

test("switching to a built-in ornament preset keeps the personalized name", () => {
  const design = ornament.designs.find(d => d.id === "round-photo");
  assert.equal(applyDesign(ornament, design, { name: "Genevieve" }).name, "Genevieve");
  assert.equal(applyDesign(ornament, design).font, "alex-brush");
  const saved = applyDesign(ornament, design, { year: "2026", year_side: "rear", year_finish: "engraved", name_finish: "cut-through" });
  assert.deepEqual([saved.year, saved.year_side, saved.year_finish, saved.name_finish], ["2026", "rear", "engraved", "cut-through"]);
});

test("every ornament connects to its flat base, with true cutouts or a rear photo seat where advertised", async () => {
  const baseVolumes = new Set();
  for (const [scene, preset] of Object.entries(ornament.presets)) {
    const p = validateParams(ornament, { ...preset, name: "Merry Winter", diameter_mm: 70 });
    assert.ok(p.ok, scene);
    const font = await getFont(p.value.font);
    const { solids } = await build(p.value, { wasm, font });
    const temps = [];
    const track = object => { temps.push(object); return object; };
    try {
      const [[baseName, base], ...relief] = solids.map(({ name, solid }) => [name, solid]);
      assert.equal(baseName, "Ornament");
      assert.equal(base.boundingBox().min[2], 0);
      const top = base.boundingBox().max[2];
      const slice = track(base.slice(1));
      const face = track(base.slice(top - 0.1));
      const loopY = base.boundingBox().max[1] - 5.5;
      const opening = track(track(wasm.CrossSection.circle(2.49)).translate([0, loopY]));
      assert.ok(track(slice.intersect(opening)).isEmpty(), `${scene}: ribbon opening is blocked`);
      const loop = track(track(wasm.CrossSection.circle(5.49)).translate([0, loopY]));
      assert.ok(track(slice.intersect(loop)).area() > 70, `${scene}: missing material around the opening`);
      const full = track(wasm.Manifold.union(solids.map(({ solid }) => solid)));
      const pieces = full.decompose();
      temps.push(...pieces);
      assert.equal(pieces.length, 1, `${scene}: relief must not float above the base`);
      const reliefArea = relief.map(([, solid]) => track(solid.slice(top + 0.4)));
      const allRelief = track(wasm.CrossSection.union(reliefArea));
      assert.ok(track(allRelief.subtract(face)).area() < 1e-4, `${scene}: relief overhang`);
      const overlapArea = reliefArea.reduce((sum, part) => sum + part.area(), 0) - allRelief.area();
      assert.ok(overlapArea < 1e-3, `${scene}: overlapping color parts (${overlapArea} mm²)`);
      assert.ok(reliefArea.at(-1).area() > 25, `${scene}: missing name`);
      // Sample actual exported cross sections in 80 mm artwork coordinates.
      const sample = (section, x, y) => {
        const probe = track(track(wasm.CrossSection.circle(0.2, 32)).translate([x * 0.875, y * 0.875]));
        return track(section.intersect(probe)).area();
      };
      if (scene.endsWith("-photo")) {
        const rear = track(base.slice(0.5));
        const window = track(track(wasm.CrossSection.circle(12)).translate([0, 5]));
        assert.ok(track(face.intersect(window)).isEmpty(), `${scene}: blocked photo window`);
        assert.ok(face.area() - rear.area() > 100, `${scene}: no photo seat`);
        assert.ok(sample(reliefArea[0], scene === "round-photo" ? 27.7 : 25.9, 13.6) > 0.1, `${scene}: missing sprig berries`);
      } else if (scene === "snowflake-lace" || scene === "woodland-cutout") {
        assert.ok(slice.area() < 2600, `${scene}: filled background`);
        assert.ok(slice.area() > 800, `${scene}: missing ring or decoration`);
        baseVolumes.add(base.volume());
        if (scene === "snowflake-lace") {
          assert.equal(sample(slice, 0, 2.5), 0, "the crystal center is open");
          assert.ok(sample(slice, 0, 8.5) > 0.1, "the crystal center has a solid rim");
        } else {
          assert.ok(sample(slice, -27, 16) > 0.1, "the fir is part of the cutout");
          assert.equal(sample(slice, -6, 4.9), 0, "the deer's spots cut all the way through");
        }
      } else if (scene === "reindeer") {
        assert.ok(sample(reliefArea[0], -6, 4.9) > 0.1, "the deer's spots are contrasting relief");
      }
    } finally {
      for (const object of temps.reverse()) object.delete();
      for (const { solid } of solids) solid.delete();
    }
  }
  assert.equal(baseVolumes.size, 2, "each openwork design has distinct geometry");
});

test("stencil names and years leave no loose islands or overlapping relief at the minimum size", async () => {
  for (const [scene, preset] of Object.entries(ornament.presets)) {
    const { value: p } = validateParams(ornament, { ...preset, diameter_mm: 70, name: "Abigail",
      year: "2088", name_finish: "cut-through", year_finish: "cut-through" });
    const { solids } = await build(p, { wasm, font: await getFont(p.font) });
    const [base] = solids;
    const top = base.solid.boundingBox().max[2];
    const face = base.solid.slice(top - 0.1);
    try {
      assert.ok(solids.every(part => !["Name", "Year"].includes(part.name)), scene);
      for (const { solid } of solids.slice(1)) {
        const area = solid.slice(top + 0.4);
        const overhang = area.subtract(face);
        try { assert.ok(overhang.area() < 1e-4, `${scene}: cut covers raised decoration`); }
        finally { overhang.delete(); area.delete(); }
      }
      const { solids: reference } = await build({ ...p, name_finish: "raised", year_finish: "raised" }, { wasm, font: await getFont(p.font) });
      try {
        const cut = reference[0].solid.subtract(base.solid);
        try { assert.ok(cut.volume() > 70, `${scene}: neither line is fully cut through`); }
        finally { cut.delete(); }
      } finally { reference.forEach(({ solid }) => solid.delete()); }
    } finally { face.delete(); solids.forEach(({ solid }) => solid.delete()); }
  }
});

test("rear year geometry is mirrored and only raised lettering projects below the rear face", async () => {
  const { value: p } = validateParams(ornament, { scene: "square-photo", year: "2026" });
  const font = await getFont(p.font);
  const front = await build({ ...p, year_finish: "raised" }, { wasm, font });
  const rear = await build({ ...p, year_side: "rear", year_finish: "raised" }, { wasm, font });
  const engraved = await build({ ...p, year_side: "rear", year_finish: "engraved" }, { wasm, font });
  const plain = await build({ ...p, year: "" }, { wasm, font });
  const frontYear = front.solids.find(part => part.name === "Year").solid;
  const rearYear = rear.solids.find(part => part.name === "Year").solid;
  const face = frontYear.slice(3.6);
  const mirrored = face.mirror([1, 0]);
  const aligned = mirrored.translate([0, 8]);
  const back = rearYear.slice(0.4);
  const common = back.intersect(aligned);
  const loss = plain.solids[0].solid.subtract(engraved.solids[0].solid);
  try {
    assert.ok(Math.abs(common.area() - face.area()) < 1e-3);
    assert.ok(rear.warnings.some(w => w.includes("under the rear face only")));
    assert.equal(rearYear.boundingBox().min[2], 0);
    assert.equal(rear.slicerSettings.support_on_build_plate_only, "1");
    assert.equal(engraved.solids.some(part => part.name === "Year"), false);
    assert.ok(Math.abs(loss.boundingBox().max[2] - 0.6) < 1e-4);
    assert.ok(loss.volume() > 3);
  } finally {
    [loss, common, back, aligned, mirrored, face].forEach(object => object.delete());
    [front, rear, engraved, plain].flatMap(model => model.solids).forEach(({ solid }) => solid.delete());
  }
});

test("moving a surface year to the back restores the original name and band", async () => {
  for (const scene of ["snowflake-lace", "round-photo"]) {
    const { value: p } = validateParams(ornament, { ...ornament.presets[scene], name: "Abigail", diameter_mm: 70 });
    const font = await getFont(p.font);
    const plain = await build(p, { wasm, font });
    try {
      for (const year_finish of ["raised", "engraved", "cut-through"]) {
        const rear = await build({ ...p, year: "2088", year_side: "rear", year_finish }, { wasm, font });
        const base = rear.solids[0].solid;
        const name = rear.solids.find(part => part.name === "Name").solid;
        const original = plain.solids.find(part => part.name === "Name").solid;
        const face = base.slice(base.boundingBox().max[2] - 0.1);
        const originalFace = plain.solids[0].solid.slice(plain.solids[0].solid.boundingBox().max[2] - 0.1);
        const extra = face.subtract(originalFace);
        const sameName = name.slice(name.boundingBox().max[2] - 0.4);
        const originalName = original.slice(original.boundingBox().max[2] - 0.4);
        const sameArea = sameName.intersect(originalName);
        const unsupported = sameName.subtract(face);
        try {
          assert.ok(extra.area() < 1e-4, `${scene}/${year_finish}: the band got larger`);
          assert.ok(unsupported.area() < 1e-4, `${scene}/${year_finish}: the year cuts through the name`);
          if (year_finish !== "cut-through" || scene === "round-photo") {
            assert.deepEqual(sameName.bounds(), originalName.bounds());
            assert.ok(Math.abs(sameArea.area() - originalName.area()) < 1e-4);
          }
        } finally {
          [unsupported, sameArea, originalName, sameName, extra, originalFace, face].forEach(item => item.delete());
          rear.solids.forEach(({ solid }) => solid.delete());
        }
      }
    } finally { plain.solids.forEach(({ solid }) => solid.delete()); }
  }
});
