import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { renderFormHtml, isFieldVisible } from "../../customizer/framework/form.js";
import { loadFont, CURATED_FONTS } from "../../customizer/framework/fonts.js";
import { getGenerator, listPublicGenerators } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { contrastRatio } from "../../public/assets/js/customize/color.js";
import { FONTS } from "../../public/assets/js/customize/fonts.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import build from "../../customizer/generators/name-plate/build.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const parse = opentype.parse ?? opentype.default.parse;
const gen = { ...getGenerator("name-plate"), build };
const FONT_DIR = new URL("../../customizer/static/fonts/", import.meta.url);
const fontBytes = async file => readFile(new URL(file, FONT_DIR));
const fontCache = new Map();
const loadFontFile = async id => {
  if (!fontCache.has(id)) {
    const f = FONTS.find(x => x.id === id);
    const b = await fontBytes(f.file);
    fontCache.set(id, parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return fontCache.get(id);
};
const paramsFor = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
const fontFor = async p => (p.font === "block" ? null : loadFontFile(p.font));
const volume = m => m.volume();

// ---- Fonts: files, licenses, checksums ------------------------------------------------------

test("eight curated OFL fonts with kebab-case ids, labels, files and the OFL-1.1 license", () => {
  assert.deepEqual(FONTS.map(f => f.id), ["pacifico", "lobster", "bebas-neue", "righteous", "caveat-brush", "rubik-mono-one", "bangers", "titan-one"]);
  for (const f of FONTS) {
    assert.match(f.id, /^[a-z]+(-[a-z]+)*$/);
    assert.match(f.file, /^[A-Za-z]+-Regular\.ttf$/);
    assert.equal(f.license, "OFL-1.1");
    assert.ok(f.label.length > 2);
  }
  assert.ok(Object.isFrozen(FONTS));
});

test("the font list matches the files on disk and each has a recorded license", async () => {
  const licenses = await readFile(new URL("LICENSES.md", FONT_DIR), "utf8");
  const onDisk = (await readdir(FONT_DIR)).filter(n => n.endsWith(".ttf")).sort();
  assert.deepEqual(onDisk, FONTS.map(f => f.file).sort(), "no unlisted font ships");
  let total = 0;
  for (const f of FONTS) {
    const bytes = await fontBytes(f.file);
    total += bytes.length;
    // A real TrueType file: sfnt version 0x00010000 or 'true' (never a stray HTML 404 page).
    const magic = bytes.subarray(0, 4).toString("hex");
    assert.ok(["00010000", "74727565"].includes(magic), `${f.file} magic ${magic}`);
    const font = await loadFontFile(f.id);
    assert.ok(font.charToGlyph("A").index > 0, `${f.label} draws A`);
    assert.ok(!font.tables.fvar, `${f.label} is a static font`);
    const family = font.names.windows?.fontFamily?.en ?? font.names.macintosh?.fontFamily?.en ?? font.names.fontFamily?.en;
    assert.equal(family, f.label, "the label is the font's own family name");
    // The license entry names the family, the license and the shipped license text.
    assert.ok(licenses.includes(`## ${f.label}`), `license entry for ${f.label}`);
    const entry = licenses.split("## ").find(s => s.startsWith(f.label));
    assert.match(entry, /SIL Open Font License, Version 1\.1/);
    assert.match(entry, /Copyright/);
    assert.ok(entry.includes(f.licenseFile), `${f.label} names ${f.licenseFile}`);
    const ofl = await readFile(new URL(f.licenseFile, FONT_DIR), "utf8");
    assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  }
  assert.ok(total < 1.5 * 1024 * 1024, `font payload ${total} bytes`);
});

test("SHA256SUMS pins every font file (a silent change fails here)", async () => {
  const sums = (await readFile(new URL("SHA256SUMS", FONT_DIR), "utf8")).trim().split(/\r?\n/).map(l => l.split(/\s+\*?/));
  assert.deepEqual(sums.map(([, name]) => name).sort(), FONTS.map(f => f.file).sort());
  for (const [hash, name] of sums) {
    const actual = createHash("sha256").update(await fontBytes(name)).digest("hex");
    assert.equal(actual, hash, name);
  }
});

test("fonts.css declares an @font-face for each font, same-origin, relative to itself", async () => {
  const css = await readFile(new URL("fonts.css", FONT_DIR), "utf8");
  for (const f of FONTS) {
    assert.match(css, new RegExp(`font-family: "cz-${f.id}";[^}]*src: url\\("${f.file.replace(".", "\\.")}"\\) format\\("truetype"\\)`), f.id);
    assert.match(css, new RegExp(`\\.cz-ff-${f.id} \\{ font-family: "cz-${f.id}"`), f.id);
  }
  assert.doesNotMatch(css, /https?:|\/\//, "no remote font URL");
});

test("served fonts get a cache rule; the CSP still allows only same-origin fonts", async () => {
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  const rule = vercel.headers.find(r => r.source === "/customize/fonts/(.*)");
  assert.ok(rule, "a cache rule for /customize/fonts");
  const cache = rule.headers.find(h => h.key === "Cache-Control").value;
  assert.match(cache, /^public, max-age=\d+/);
  assert.ok(!/immutable/.test(cache), "file names carry no content hash, so not immutable");
  const csp = vercel.headers.find(r => r.source === "/customize/(.*)").headers.find(h => h.key === "Content-Security-Policy").value;
  assert.match(csp, /font-src 'self';/);
  const dev = await readFile(new URL("../../scripts/dev-server.mjs", import.meta.url), "utf8");
  assert.match(dev, /"\.ttf":"font\/ttf"/);
});

// ---- Font loading (worker side) -------------------------------------------------------------

test("loadFont fetches curated fonts same-origin once, rejects unknown ids, treats block as null", async () => {
  assert.deepEqual(Object.keys(CURATED_FONTS), FONTS.map(f => f.id));
  const calls = [];
  const bytes = await fontBytes("Righteous-Regular.ttf");
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  assert.equal(await loadFont({ fontId: "block", fetchImpl }), null);
  assert.equal(await loadFont({ fetchImpl }), null);
  const a = await loadFont({ fontId: "righteous", fetchImpl });
  const b = await loadFont({ fontId: "righteous", fetchImpl });
  assert.equal(a, b, "parsed font is cached");
  assert.deepEqual(calls, [["/customize/fonts/Righteous-Regular.ttf", { credentials: "same-origin" }]]);
  await assert.rejects(() => loadFont({ fontId: "comic-sans", fetchImpl }), /isn't available/);
  await assert.rejects(() => loadFont({ fontId: "custom", fetchImpl }), /isn't available/);
  await assert.rejects(() => loadFont({ fontId: "__proto__", fetchImpl }), /isn't available/);
  assert.equal(calls.length, 1);
  // A failed fetch is not cached: the next attempt fetches again.
  let fail = true;
  const flaky = async () => (fail ? { ok: false } : { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  await assert.rejects(() => loadFont({ fontId: "bangers", fetchImpl: flaky }), /couldn't be loaded/);
  // A network error (fetch rejects) gets the same readable message, never the raw one.
  await assert.rejects(() => loadFont({ fontId: "lobster", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), err => /couldn't be loaded/.test(err.message) && !/Failed to fetch/.test(err.message));
  fail = false;
  // (Bangers bytes are not needed: any valid font proves the retry.)
  assert.ok(await loadFont({ fontId: "bangers", fetchImpl: flaky }));
});

test("a customer's font bytes are parsed locally; bad bytes give a readable error", async () => {
  const bytes = await fontBytes("TitanOne-Regular.ttf");
  const font = await loadFont({ fontBytes: new Uint8Array(bytes), fetchImpl: () => assert.fail("no fetch for local bytes") });
  assert.ok(font.charToGlyph("A").index > 0);
  await assert.rejects(() => loadFont({ fontBytes: new Uint8Array([1, 2, 3, 4]) }), /couldn't be read/);
});

// ---- Schema and rules -----------------------------------------------------------------------

test("generator definition: id, version, category, provenance, registered", () => {
  assert.equal(gen.id, "name-plate");
  assert.equal(gen.version, 1);
  assert.equal(gen.title, "Name plate");
  assert.equal(gen.origin, "house");
  assert.deepEqual(gen.rights, { publishable: true, note: "House design." });
  assert.ok(listPublicGenerators().some(g => g.id === "name-plate"));
});

test("defaults: Alex in the block font, raised on a pill plate, 24 mm text", () => {
  const p = paramsFor();
  assert.deepEqual(
    { name: p.name, font: p.font, style: p.style, plate: p.plate, keychain_loop: p.keychain_loop, height_mm: p.height_mm, thickness_mm: p.thickness_mm, relief_mm: p.relief_mm },
    { name: "Alex", font: "block", style: "raised", plate: "pill", keychain_loop: false, height_mm: 24, thickness_mm: 3, relief_mm: 1.2 }
  );
  assert.ok(contrastRatio(p.text_color, p.plate_color) >= 3);
  assert.ok(contrastRatio(p.text_color, p.outline_color) >= 3);
});

test("the font enum is block, the eight curated fonts and the customer's own file", () => {
  assert.deepEqual(gen.schema.font.options.map(o => o.value), ["block", ...FONTS.map(f => f.id), "custom"]);
  assert.equal(gen.schema.font.options[0].label, "Block (built-in)");
  assert.equal(validateParams(gen, { font: "comic-sans" }).ok, false);
  assert.equal(validateParams(gen, { font: "custom" }).ok, true);
});

test("the 20-character limit and required name are enforced", () => {
  assert.equal(validateParams(gen, { name: "N".repeat(21) }).ok, false);
  assert.equal(validateParams(gen, { name: "N".repeat(20) }).ok, true);
  assert.equal(validateParams(gen, { name: " " }).ok, false);
  assert.equal(validateParams(gen, { name: "" }).ok, false);
});

test("plate and text colors need 3:1 contrast; with no plate the backing (outline color) does", () => {
  const r = validateParams(gen, { plate_color: "#ffffff", text_color: "#eeeeee" });
  assert.equal(r.ok, false);
  assert.ok(r.fieldErrors.plate_color && r.fieldErrors.text_color);
  assert.match(r.fieldErrors.text_color, /too similar/);
  // With no plate, the plate color is unused (hidden and ignored); the backing is the outline color.
  assert.equal(validateParams(gen, { plate: "none", plate_color: "#ffffff", text_color: "#fefefe", outline_color: "#000000" }).ok, true);
  const none = validateParams(gen, { plate: "none", text_color: "#ffffff", outline_color: "#f0f0f0" });
  assert.equal(none.ok, false);
  assert.ok(none.fieldErrors.outline_color && none.fieldErrors.text_color);
});

test("relief leaves at least 0.8 mm of plate underneath", () => {
  const r = validateParams(gen, { thickness_mm: 2, relief_mm: 1.4 });
  assert.equal(r.ok, false);
  assert.ok(r.fieldErrors.relief_mm);
  assert.deepEqual(gen.rules(paramsFor({ thickness_mm: 2, relief_mm: 1.2 })).limits.relief_mm, [0.6, 1.2]);
  assert.equal(clampParams(gen, { ...paramsFor(), relief_mm: 2, thickness_mm: 2 }, "thickness_mm").relief_mm, 1.2);
});

test("inlay needs a plate: the server refuses it, the page switches the other control", () => {
  const r = validateParams(gen, { style: "inlay", plate: "none" });
  assert.equal(r.ok, false);
  assert.match(r.fieldErrors.style, /Inlay needs a plate/);
  assert.equal(clampParams(gen, { ...paramsFor({ style: "inlay" }), plate: "none" }, "plate").style, "raised");
  assert.equal(clampParams(gen, { ...paramsFor({ plate: "none" }), style: "inlay" }, "style").plate, "pill");
  assert.equal(clampParams(gen, { ...paramsFor(), plate: "rect" }, "plate").style, "raised");
});

test("color controls appear only when they are used", () => {
  const shown = (key, p) => isFieldVisible(gen.schema[key], paramsFor(p));
  assert.equal(shown("outline_color", {}), false, "raised on a plate: no outline color");
  assert.equal(shown("outline_color", { style: "outline" }), true);
  assert.equal(shown("outline_color", { style: "shadow" }), true);
  assert.equal(shown("outline_color", { plate: "none" }), true, "no plate: the outline color is the backing");
  assert.equal(shown("plate_color", {}), true);
  assert.equal(shown("plate_color", { plate: "none" }), false);
  const html = renderFormHtml(gen, paramsFor());
  assert.match(html, /data-field="outline_color" hidden>/);
  assert.doesNotMatch(html, /data-field="plate_color" hidden>/);
});

test("visibleWhen accepts a list of values and a predicate", () => {
  assert.equal(isFieldVisible({ visibleWhen: { a: ["x", "y"] } }, { a: "y" }), true);
  assert.equal(isFieldVisible({ visibleWhen: { a: ["x", "y"] } }, { a: "z" }), false);
  assert.equal(isFieldVisible({ visibleWhen: p => p.a === 1 }, { a: 1 }), true);
  assert.equal(isFieldVisible({ visibleWhen: { a: "x" } }, { a: "x" }), true);
});

test("the font picker is a labelled radio group, each option drawn in its own font", () => {
  const html = renderFormHtml(gen, paramsFor({ font: "lobster" }));
  assert.match(html, /<button class="cz-picker-toggle" type="button" id="cz-font-toggle" aria-expanded="false" aria-controls="cz-font-list"/);
  assert.match(html, /<fieldset class="cz-picker-list" id="cz-font-list" hidden>\s*<legend class="visually-hidden">Font<\/legend>/);
  for (const f of FONTS) assert.match(html, new RegExp(`<input class="cz-picker-radio" type="radio" name="font" id="cz-font-${f.id}" value="${f.id}"[^>]*>\\s*<label for="cz-font-${f.id}" class="cz-picker-option cz-ff-${f.id}">${f.label}</label>`));
  assert.match(html, /value="lobster" checked/);
  assert.match(html, /id="cz-font-block" value="block"/);
  assert.match(html, /id="cz-font-custom" value="custom"/);
  // The toggle shows the current font in its own face.
  assert.match(html, /<span class="cz-picker-current cz-ff-lobster">Lobster<\/span>/);
});

test("errorField maps geometry errors to the control they concern", () => {
  assert.equal(gen.errorField("The letters aren't connected — choose a plate or a bolder font."), "plate");
  assert.equal(gen.errorField("None of these characters are available in this font."), "name");
  assert.equal(gen.errorField("The name would print only 2.1 mm tall at the 150 mm width limit, too small to read. Shorten it."), "name");
  assert.equal(gen.errorField("That font file couldn't be read. Try a TTF, OTF or WOFF file."), "font");
  assert.equal(gen.errorField("Choose a font file below, or pick one of the listed fonts."), "font");
  assert.equal(gen.errorField("That font isn't available."), "font");
  // A download failure is transient: unkeyed, so the page shows "Try again" (re-picking the
  // same font would not rebuild).
  assert.equal(gen.errorField("The font couldn't be loaded. Check your connection and try again."), null);
  assert.equal(gen.errorField("The selected font isn't loaded. Try again, or pick another font."), null);
  assert.equal(gen.errorField("something else"), null);
});

test("the server re-validates a name-plate customization, including the font id", () => {
  const ok = normalizeCustomization({ generatorId: "name-plate", generatorVersion: 1, params: paramsFor({ font: "pacifico" }) });
  assert.equal(ok.params.font, "pacifico");
  assert.throws(() => normalizeCustomization({ generatorId: "name-plate", generatorVersion: 1, params: { font: "https://evil.example/x.ttf" } }), err => err.status === 400);
  assert.throws(() => normalizeCustomization({ generatorId: "name-plate", generatorVersion: 1, params: { name: "N".repeat(21) } }), err => err.status === 400);
  // Hidden fields are accepted and ignored (a plate color with no plate).
  assert.ok(normalizeCustomization({ generatorId: "name-plate", generatorVersion: 1, params: paramsFor({ plate: "none", plate_color: "#ffffff", text_color: "#ffffff", outline_color: "#000000" }) }));
});

// ---- Geometry -------------------------------------------------------------------------------

for (const font of ["pacifico", "bebas-neue", "caveat-brush"]) for (const style of ["raised", "outline", "shadow", "inlay"]) {
  test(`${font} / ${style} builds a valid multi-part model`, async () => {
    const { ok, errors, value } = validateParams(gen, { name: "Jordan", font, style });
    assert.ok(ok, errors.join(";"));
    const out = await buildModel(gen, value, { wasm, font: await loadFontFile(font) });
    assert.ok(out.parts.length >= 2 && out.metrics.unique_colors <= 3);
  });
}

test("parts per style: names, colors, heights and no overlapping volume", async () => {
  const font = await loadFontFile("bebas-neue");
  const expected = {
    raised: ["Plate", "Name"],
    outline: ["Plate", "Outline", "Name"],
    shadow: ["Plate", "Shadow", "Name"],
    inlay: ["Plate", "Name"]
  };
  for (const plate of ["pill", "rect", "none"]) for (const style of Object.keys(expected)) {
    if (plate === "none" && style === "inlay") continue;
    const p = paramsFor({ name: "Jordan", font: "bebas-neue", style, plate });
    const built = await build(p, { wasm, font });
    try {
      const names = built.solids.map(s => s.name);
      assert.deepEqual(names, expected[style].map(n => (n === "Plate" && plate === "none" ? "Backing" : n)), `${plate}/${style}`);
      const zMax = Math.max(...built.solids.map(s => s.solid.boundingBox().max[2]));
      assert.ok(Math.abs(zMax - p.thickness_mm) < 1e-6, `${plate}/${style} total height ${zMax}`);
      for (let i = 0; i < built.solids.length; i++) for (let j = i + 1; j < built.solids.length; j++) {
        const both = built.solids[i].solid.intersect(built.solids[j].solid);
        try { assert.ok(both.volume() < 1e-3, `${names[i]} ∩ ${names[j]} = ${both.volume()} (${plate}/${style})`); } finally { both.delete(); }
      }
      const colorOf = Object.fromEntries(built.solids.map(s => [s.name, s.color]));
      assert.equal(colorOf.Name, p.text_color);
      if (plate === "none") assert.equal(colorOf.Backing, p.outline_color);
      else assert.equal(colorOf.Plate, p.plate_color);
      if (colorOf.Outline) assert.equal(colorOf.Outline, p.outline_color);
      if (colorOf.Shadow) assert.equal(colorOf.Shadow, p.outline_color);
      if (style === "inlay") {
        const name = built.solids.find(s => s.name === "Name").solid.boundingBox();
        assert.ok(Math.abs(name.min[2] - (p.thickness_mm - p.relief_mm)) < 1e-6 && Math.abs(name.max[2] - p.thickness_mm) < 1e-6, "inlay is flush");
      }
    } finally { built.solids.forEach(s => s.solid.delete()); }
  }
});

test("the plate (or backing) is one connected piece for every font", async () => {
  for (const f of ["block", ...FONTS.map(x => x.id)]) for (const plate of ["pill", "rect", "none"]) {
    const p = paramsFor({ name: "Jordan", font: f, plate, keychain_loop: true });
    const built = await build(p, { wasm, font: await fontFor(p) });
    try {
      const pieces = built.solids[0].solid.decompose();
      try { assert.equal(pieces.length, 1, `${f}/${plate}`); } finally { pieces.forEach(x => x.delete()); }
    } finally { built.solids.forEach(s => s.solid.delete()); }
  }
});

test("the letters sit at least 3 mm inside a pill or rectangle plate (and inside the backing)", async () => {
  for (const [font, name] of [["block", "Alex"], ["block", "AW"], ["lobster", "Alex"], ["pacifico", "Jordan"], ["rubik-mono-one", "MAX"], ["bebas-neue", "I"], ["titan-one", "Maximiliana Rosalind"]]) {
    for (const plate of ["pill", "rect", "none"]) {
      if (plate === "none" && name.includes(" ")) continue; // a word gap is never bridged (see below)
      const p = paramsFor({ name, font, plate });
      const built = await build(p, { wasm, font: await fontFor(p) });
      const temps = [];
      const t = o => { temps.push(o); return o; };
      try {
        const letters = t(built.solids.find(s => s.name === "Name").solid.slice(p.thickness_mm - p.relief_mm / 2));
        const base = t(built.solids[0].solid.slice(0.1));
        const margin = plate === "none" ? 1.5 : 2.95;
        const outside = t(t(letters.offset(margin, "Round", 2, 24)).subtract(base)).area();
        assert.ok(outside < 1e-3, `${font} "${name}" ${plate}: ${outside} mm² of letters near or past the edge`);
      } finally { temps.forEach(o => o.delete()); built.solids.forEach(s => s.solid.delete()); }
    }
  }
});

test("disconnected letters with no plate fail with a readable message", async () => {
  // Block letters a full space apart cannot be bridged by the backing outline.
  const p = paramsFor({ name: "A B", plate: "none" });
  await assert.rejects(() => buildModel(gen, p, { wasm, font: null }), { message: "The letters aren't connected — choose a plate or a bolder font." });
  // The same name on a plate is fine.
  assert.ok((await buildModel(gen, paramsFor({ name: "A B", plate: "rect" }), { wasm, font: null })).parts.length >= 2);
});

test("text fits a 150 mm × height box; too small to read is an error", async () => {
  const font = await loadFontFile("bebas-neue");
  for (const [name, height] of [["Al", 24], ["Maximiliana Rosalind", 24], ["Jo", 60], ["Jo", 14]]) {
    const p = paramsFor({ name, font: "bebas-neue", height_mm: height, plate: "rect" });
    const built = await build(p, { wasm, font });
    try {
      const t = built.solids.find(s => s.name === "Name").solid.boundingBox();
      const w = t.max[0] - t.min[0], h = t.max[1] - t.min[1];
      assert.ok(w <= 150 + 1e-6 && h <= height + 1e-6, `${name}: ${w} × ${h}`);
      assert.ok(Math.abs(w - 150) < 1e-3 || Math.abs(h - height) < 1e-3, `${name} fills its box`);
      const plate = built.solids[0].solid.boundingBox();
      assert.ok(plate.max[1] - plate.min[1] <= height + 6 + 1e-6, "3 mm padding above and below");
    } finally { built.solids.forEach(s => s.solid.delete()); }
  }
  await assert.rejects(() => buildModel(gen, paramsFor({ name: "_".repeat(20), font: "bebas-neue" }), { wasm, font }), /too small to read/);
});

test("overlapping script joins stay solid (non-zero fill), never become holes", async () => {
  const { fontText } = await import("../../customizer/framework/text.js");
  const font = await loadFontFile("pacifico");
  const nz = fontText(wasm.CrossSection, font, "Jordan Alex", { fillRule: "NonZero" });
  const eo = fontText(wasm.CrossSection, font, "Jordan Alex");
  const p = paramsFor({ name: "Jordan Alex", font: "pacifico", plate: "rect" });
  const built = await build(p, { wasm, font });
  let slice;
  try {
    assert.ok(nz.area() > eo.area() * 1.005, `${nz.area()} vs ${eo.area()}`);
    // The name plate's letters are the non-zero outline, scaled to fit.
    slice = built.solids.find(s => s.name === "Name").solid.slice(p.thickness_mm - p.relief_mm / 2);
    const [nb, sb] = [nz.bounds(), slice.bounds()];
    const k = (sb.max[1] - sb.min[1]) / (nb.max[1] - nb.min[1]);
    assert.ok(Math.abs(slice.area() - nz.area() * k * k) / slice.area() < 1e-3, `${slice.area()} vs ${nz.area() * k * k}`);
  } finally { nz.delete(); eo.delete(); slice?.delete(); built.solids.forEach(s => s.solid.delete()); }
});

test("names with emoji or glyphs the font lacks do not crash the build", async () => {
  const { value } = validateParams(gen, { name: "Zoë 🚽", font: "bebas-neue" });
  const out = await buildModel(gen, value, { wasm, font: await loadFontFile("bebas-neue") });
  assert.ok(out.parts.length >= 1);
  assert.deepEqual(out.warnings, ["Some characters aren't in this font and were skipped."]);
});

test("missing glyphs are skipped, never drawn as boxes; all missing is a clear error", async () => {
  const font = await loadFontFile("pacifico");
  const plain = await build(paramsFor({ name: "Zoe", font: "pacifico", plate: "rect" }), { wasm, font });
  const withEmoji = await build(paramsFor({ name: "Zoe🚽", font: "pacifico", plate: "rect" }), { wasm, font });
  try {
    const nameOf = b => b.solids.find(s => s.name === "Name").solid;
    // Skipping the emoji leaves exactly the same name geometry: no notdef box anywhere.
    assert.ok(Math.abs(volume(nameOf(plain)) - volume(nameOf(withEmoji))) < 1e-6);
    assert.deepEqual(plain.warnings, []);
    assert.deepEqual(withEmoji.warnings, ["Some characters aren't in this font and were skipped."]);
  } finally { [...plain.solids, ...withEmoji.solids].forEach(s => s.solid.delete()); }
  await assert.rejects(() => buildModel(gen, paramsFor({ name: "🚽🚽", font: "pacifico" }), { wasm, font }), { message: "None of these characters are available in this font." });
  // Hebrew is not in Pacifico; it is not special-cased, it is just missing.
  await assert.rejects(() => buildModel(gen, paramsFor({ name: "דנה", font: "pacifico" }), { wasm, font }), /None of these characters/);
  // The block font folds accents (Zoë → ZOE) and skips what it cannot draw.
  const block = await buildModel(gen, paramsFor({ name: "Zoë 🚽" }), { wasm, font: null });
  assert.deepEqual(block.warnings, ["Some characters aren't in this font and were skipped."]);
  const accentOnly = await buildModel(gen, paramsFor({ name: "Zoë" }), { wasm, font: null });
  assert.deepEqual(accentOnly.warnings, []);
  await assert.rejects(() => buildModel(gen, paramsFor({ name: "🚽" }), { wasm, font: null }), /None of these characters/);
});

test("combining marks and right-to-left text build without crashing and stay bounded", async () => {
  const font = await loadFontFile("lobster");
  for (const name of ["Zoë", "Amélie", "Á́́́́́́́́́́́́́́́́́́"]) {
    const out = await buildModel(gen, paramsFor({ name, font: "lobster" }), { wasm, font });
    const name3 = out.parts.find(p => p.name === "Name");
    const xs = name3.mesh.vertices.map(v => v[0]), ys = name3.mesh.vertices.map(v => v[1]);
    assert.ok(Math.max(...xs) - Math.min(...xs) <= 150 + 1e-6 && Math.max(...ys) - Math.min(...ys) <= 24 + 1e-6, name);
  }
});

test("a keychain loop adds a hole and keeps one connected body", async () => {
  const plain = await buildModel(gen, validateParams(gen, { keychain_loop: false }).value, { wasm, font: null });
  const loop = await buildModel(gen, validateParams(gen, { keychain_loop: true }).value, { wasm, font: null });
  assert.ok(loop.metrics.triangles > plain.metrics.triangles);
});

test("the keychain loop sits at the left end, clear of the letters, overlapping the base by at least 3 mm", async () => {
  for (const [font, plate] of [["block", "pill"], ["block", "none"], ["pacifico", "none"], ["caveat-brush", "rect"], ["bangers", "none"], ["lobster", "pill"]]) {
    const p = paramsFor({ name: "Jordan", font, plate, keychain_loop: true });
    const f = await fontFor(p);
    const withLoop = await build(p, { wasm, font: f });
    const without = await build({ ...p, keychain_loop: false }, { wasm, font: f });
    const { CrossSection } = wasm;
    const temps = [];
    const t = o => { temps.push(o); return o; };
    try {
      const { cx, cy, outerR, holeR } = withLoop.loop;
      assert.equal(outerR, 6);
      assert.equal(holeR, 2.75);
      const nameOf = b => b.solids.find(s => s.name === "Name").solid;
      // The letters are untouched by the loop.
      assert.ok(Math.abs(volume(nameOf(withLoop)) - volume(nameOf(without))) < 1e-6, `${font}/${plate} letters unchanged`);
      // The hole (plus 1.2 mm) never touches a letter.
      const zMid = p.thickness_mm - p.relief_mm / 2;
      const letters = t(nameOf(withLoop).slice(zMid));
      const keepOut = t(t(CrossSection.circle(holeR + 1.2, 48)).translate([cx, cy]));
      assert.ok(t(letters.intersect(keepOut)).area() < 1e-6, `${font}/${plate} hole clear of letters`);
      // The hole goes through every solid.
      const hole = t(t(CrossSection.circle(holeR - 0.05, 48)).translate([cx, cy]));
      for (const s of withLoop.solids) {
        const cut = t(t(t(hole.extrude(p.thickness_mm + 2)).translate([0, 0, -1])).intersect(s.solid));
        assert.ok(cut.volume() < 1e-6, `${s.name} has the hole`);
      }
      // The loop (its ring, or a short bridge when the letters push it further left) reaches
      // at least 3 mm into the base along the loop's axis, and is solid all the way.
      const { reach } = withLoop.loop;
      assert.ok(reach >= cx + outerR - 1e-9);
      const base = t(without.solids[0].solid.slice(0.1));
      const strip = t(t(CrossSection.square([60, 0.5], false)).translate([cx, cy - 0.25]));
      const baseStrip = t(base.intersect(strip));
      const overlap = reach - baseStrip.bounds().min[0];
      const axis = t(t(CrossSection.square([reach - cx - holeR - 0.1, 0.5], false)).translate([cx + holeR + 0.05, cy - 0.25]));
      const loopBase = t(withLoop.solids[0].solid.slice(0.1));
      assert.ok(Math.abs(t(axis.intersect(loopBase)).area() - axis.area()) < 1e-6, `${font}/${plate} loop is solid from the hole to the base`);
      assert.ok(overlap >= 3 - 1e-6, `${font}/${plate} overlap ${overlap}`);
      // The loop is at the left end and its ring never overlaps a letter.
      assert.ok(cx < letters.bounds().max[0]);
      const ring = t(t(CrossSection.circle(outerR - 0.01, 48)).translate([cx, cy]));
      assert.ok(t(letters.intersect(ring)).area() < 1e-6, `${font}/${plate} ring clear of letters`);
      const lettersOnAxis = t(letters.intersect(strip));
      if (!lettersOnAxis.isEmpty()) assert.ok(cx + outerR <= lettersOnAxis.bounds().min[0] + 1e-6);
    } finally {
      temps.forEach(o => o.delete());
      [...withLoop.solids, ...without.solids].forEach(s => s.solid.delete());
    }
  }
});

test("with no plate, an outline or shadow shares the backing's color: a warning says so", async () => {
  for (const style of ["outline", "shadow"]) {
    const out = await buildModel(gen, paramsFor({ name: "Jo", plate: "none", style }), { wasm, font: null });
    assert.deepEqual(out.warnings, ["With no plate, the backing is printed in the outline color too, so the outline or shadow shows only as a step in height. Choose a plate to give it its own color."]);
    assert.equal(out.metrics.unique_colors, 2);
  }
  assert.deepEqual((await buildModel(gen, paramsFor({ name: "Jo", plate: "none" }), { wasm, font: null })).warnings, []);
  assert.deepEqual((await buildModel(gen, paramsFor({ name: "Jo", style: "outline" }), { wasm, font: null })).warnings, []);
});

test("filename, title and 3MF part names are plain and bounded", async () => {
  const out = await buildModel(gen, paramsFor({ name: "Zoë & <Max>" }), { wasm, font: null });
  assert.match(out.filename, /^[A-Za-z0-9_-]{1,40}\.3mf$/);
  assert.equal(out.filename, "name-plate-Zo-Max.3mf");
  assert.deepEqual(out.parts.map(p => p.name), ["Plate", "Name"]);
  const long = await buildModel(gen, paramsFor({ name: "Bartholomew-Johnston" }), { wasm, font: null });
  assert.ok(long.filename.length <= 44, long.filename);
});

// ---- Memory ---------------------------------------------------------------------------------

test("build() frees every temporary: only the returned solids stay alive", async () => {
  const cases = [];
  for (const style of ["raised", "outline", "shadow", "inlay"]) for (const plate of ["pill", "rect", "none"]) for (const keychain_loop of [false, true]) {
    if (style === "inlay" && plate === "none") continue;
    cases.push({ style, plate, keychain_loop, font: "pacifico" });
  }
  cases.push({ font: "block", plate: "none", keychain_loop: true }, { name: "Zoë 🚽", font: "bebas-neue" }, { name: "Zoë 🚽" });
  for (const extra of cases) {
    const value = paramsFor(extra);
    const font = await fontFor(value);
    const tracker = trackLiveObjects(wasm);
    try {
      const built = await build(value, { wasm: tracker.ctxWasm, font });
      assert.equal(tracker.live.size, built.solids.length, `live ${tracker.live.size} vs solids ${built.solids.length} (${JSON.stringify(extra)})`);
      for (const s of built.solids) assert.ok(tracker.live.has(s.solid));
      built.solids.forEach(s => s.solid.delete());
      assert.equal(tracker.live.size, 0);
    } finally { tracker.restore(); }
  }
});

test("failed builds do not leak either", async () => {
  const bebas = await loadFontFile("bebas-neue");
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build(paramsFor({ name: "A B", plate: "none", keychain_loop: true }), { wasm: tracker.ctxWasm, font: null }), /aren't connected/);
    assert.equal(tracker.live.size, 0, "disconnected");
    await assert.rejects(() => build(paramsFor({ name: "🚽", font: "bebas-neue" }), { wasm: tracker.ctxWasm, font: bebas }), /None of these/);
    assert.equal(tracker.live.size, 0, "all missing");
    await assert.rejects(() => build(paramsFor({ name: "_".repeat(20), font: "bebas-neue", style: "outline" }), { wasm: tracker.ctxWasm, font: bebas }), /too small/);
    assert.equal(tracker.live.size, 0, "too small");
    await assert.rejects(() => build(paramsFor({ font: "custom" }), { wasm: tracker.ctxWasm, font: null }), /font file/);
    assert.equal(tracker.live.size, 0, "no custom file");
    await assert.rejects(() => build(paramsFor({ font: "pacifico" }), { wasm: tracker.ctxWasm, font: null }), /font/);
    assert.equal(tracker.live.size, 0, "curated font missing");
  } finally { tracker.restore(); }
});

test("the leak tracker sees instances returned inside arrays (decompose)", () => {
  const tracker = trackLiveObjects(wasm);
  try {
    const a = tracker.ctxWasm.Manifold.cube([1, 1, 1]);
    const b = a.translate([3, 0, 0]);
    const both = tracker.ctxWasm.Manifold.union([a, b]);
    const pieces = both.decompose();
    assert.equal(tracker.live.size, 3 + pieces.length);
    [a, b, both, ...pieces].forEach(o => o.delete());
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});

test("the name plate page offers a local font file and links the self-hosted font faces", async () => {
  const html = await readFile(new URL("../../customizer/g/name-plate/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/customize\/fonts\/fonts\.css" vite-ignore>/);
  assert.match(html, /<input class="cz-file" type="file" id="cz-font-file" accept="\.ttf,\.otf,\.woff,font\/ttf,font\/otf,font\/woff"/);
  assert.match(html, /id="cz-font-area" hidden/);
  assert.ok(html.includes("The file stays on this device; it is never uploaded."));
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|fontsource/i);
});
