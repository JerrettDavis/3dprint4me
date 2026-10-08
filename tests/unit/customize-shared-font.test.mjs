// The font control is one shared definition: every generator offers the same choices, the same
// license confirmation for fonts from the customer's computer, and prints text in any of them.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { loadFont } from "../../customizer/framework/fonts.js";
import { renderFormHtml, storableParams, restoreParams, isFieldVisible } from "../../customizer/framework/form.js";
import { listInstalledFonts, filterFonts, readInstalledFont, installedFontsSupported, INSTALLED_DENIED, INSTALLED_EMPTY, INSTALLED_TOO_LARGE, INSTALLED_UNREADABLE } from "../../customizer/framework/system-fonts.js";
import { FONTS, FONT_OPTIONS, FONT_SPEC, FONT_ACK_KEY, FONT_ACK_REQUIRED, fontNeedsLicense } from "../../public/assets/js/customize/fonts.js";
import { GENERATORS, getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { loadBuilder } from "../../customizer/generators/index.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const parse = opentype.parse ?? opentype.default.parse;
const FONT_DIR = new URL("../../customizer/static/fonts/", import.meta.url);
const bebasBytes = await readFile(new URL("BebasNeue-Regular.ttf", FONT_DIR));
const toBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const bebas = parse(toBuffer(bebasBytes));
const generators = Object.values(GENERATORS);
const withBuild = async g => ({ ...g, build: (await loadBuilder[g.id]()).default });
// Parameters a generator needs besides the font (the Wi-Fi tag needs a password).
const needed = g => (g.id === "wifi-tag" ? { password: "correct-horse" } : {});

test("every generator uses the one shared font control", () => {
  assert.equal(generators.length, 4);
  for (const g of generators) {
    assert.deepEqual(g.font, FONT_SPEC, `${g.id} font spec`);
    assert.deepEqual(g.schema.font.options.map(o => o.value), FONT_OPTIONS.map(o => o.value), `${g.id} options`);
    assert.equal(g.schema.font.picker, "font");
    assert.equal(g.schema.font.default, "block");
    assert.equal(g.schema[FONT_ACK_KEY].type, "bool");
    assert.equal(g.schema[FONT_ACK_KEY].default, false);
    assert.equal(g.schema[FONT_ACK_KEY].transient, true, "the confirmation is never kept in a draft");
  }
  assert.deepEqual(FONT_OPTIONS.map(o => o.value), ["block", ...FONTS.map(f => f.id), "system", "custom"]);
});

test("a font from the customer's computer needs the license confirmation; vetted fonts do not", () => {
  for (const g of generators) {
    for (const font of ["block", ...FONTS.map(f => f.id)]) assert.equal(validateParams(g, { font, ...needed(g) }).ok, true, `${g.id} ${font}`);
    for (const font of ["system", "custom"]) {
      const bare = validateParams(g, { font, ...needed(g) });
      assert.equal(bare.ok, false, `${g.id} ${font} unconfirmed`);
      assert.equal(bare.fieldErrors[FONT_ACK_KEY], FONT_ACK_REQUIRED);
      assert.equal(validateParams(g, { font, [FONT_ACK_KEY]: true, ...needed(g) }).ok, true, `${g.id} ${font} confirmed`);
    }
  }
});

test("the confirmation is not asked for when no text prints", () => {
  const wifi = getGenerator("wifi-tag");
  assert.equal(validateParams(wifi, { format: "keychain", font: "custom", password: "correct-horse" }).ok, true, "a keychain tag prints no text");
  assert.equal(validateParams(wifi, { format: "placard", font: "custom", password: "correct-horse" }).ok, false);
  const card = getGenerator("rating-card");
  assert.equal(validateParams(card, { font: "system", caption: "" }).ok, true, "no caption, no text");
  assert.equal(validateParams(card, { font: "system", caption: "Hi" }).ok, false);
});

test("the font controls are shown only when they apply", () => {
  const wifi = getGenerator("wifi-tag");
  const at = params => ({ font: isFieldVisible(wifi.schema.font, params), ack: isFieldVisible(wifi.schema[FONT_ACK_KEY], params) });
  assert.deepEqual(at({ format: "placard", show_text: true, font: "block" }), { font: true, ack: false });
  assert.deepEqual(at({ format: "placard", show_text: true, font: "system" }), { font: true, ack: true });
  assert.deepEqual(at({ format: "keychain", show_text: false, font: "system" }), { font: false, ack: false });
  const html = renderFormHtml(wifi, validateParams(wifi, { password: "x" }).value);
  assert.match(html, /name="font_license_ack"/);
  assert.match(html, /We can(&#39;|')t check a font(&#39;|')s license/, "the confirmation carries its explanation");
});

test("drafts keep neither the confirmation nor a font that has to be picked again", () => {
  const g = getGenerator("name-plate");
  const saved = storableParams(g, { ...validateParams(g, {}).value, name: "Zoe", font: "custom", font_license_ack: true });
  assert.equal(saved.name, "Zoe");
  assert.equal(saved.font, "block");
  assert.ok(!(FONT_ACK_KEY in saved));
  assert.equal(storableParams(g, { name: "Zoe", font: "pacifico" }).font, "pacifico", "a curated font is kept");
  const restored = restoreParams(g, JSON.stringify({ name: "Zoe", font: "custom", font_license_ack: true }));
  assert.equal(restored.name, "Zoe");
  assert.equal(restored.font, "block");
  assert.equal(restored[FONT_ACK_KEY], false);
});

test("route shield's old font_mode key is gone, and the version moved", () => {
  const g = getGenerator("route-shield");
  assert.ok(!("font_mode" in g.schema));
  assert.equal(g.version, 3);
  assert.equal(validateParams(g, { font_mode: "block" }).ok, false);
});

// ---- Text in a real font on the label generators -------------------------------------------

const buildOut = async (id, params, font = null) => {
  const g = await withBuild(getGenerator(id));
  const checked = validateParams(g, params);
  assert.ok(checked.ok, checked.errors.join("; "));
  return buildModel(g, checked.value, { wasm, font });
};

test("wifi-tag prints its label in a real font, with no capitals-only warning", async () => {
  const block = await buildOut("wifi-tag", { password: "correct-horse", ssid: "Guest Wifi" });
  assert.ok(block.warnings.some(w => /capital letters only/.test(w)), "the block font still says so");
  const real = await buildOut("wifi-tag", { password: "correct-horse", ssid: "Guest Wifi", font: "bebas-neue" }, bebas);
  assert.ok(!real.warnings.some(w => /capital letters only|replaced with/.test(w)));
  assert.equal(real.parts.length, block.parts.length, "same parts: body, code and label");
});

test("wifi-tag in a real font: missing characters are skipped with a warning, none at all is an error", async () => {
  const skipped = await buildOut("wifi-tag", { password: "correct-horse", ssid: "Wifi \u{1F6BD}", font: "bebas-neue" }, bebas);
  assert.ok(skipped.warnings.includes("Some characters aren't in this font and were skipped."));
  await assert.rejects(() => buildOut("wifi-tag", { password: "correct-horse", ssid: "\u{1F6BD}\u{1F6BD}", font: "bebas-neue" }, bebas), /network name are available in this font/);
});

test("wifi-tag names the font when it is missing", async () => {
  await assert.rejects(() => buildOut("wifi-tag", { password: "correct-horse", font: "custom", font_license_ack: true }, null), /font file/);
  await assert.rejects(() => buildOut("wifi-tag", { password: "correct-horse", font: "system", font_license_ack: true }, null), /installed font/);
  assert.equal(getGenerator("wifi-tag").errorField("Choose an installed font below, or pick one of the listed fonts."), "font");
  assert.equal(getGenerator("wifi-tag").errorField("None of the characters in the title are available in this font. Choose another font."), "title");
});

test("a keychain tag needs no font even when one is chosen", async () => {
  const out = await buildOut("wifi-tag", { password: "correct-horse", format: "keychain", font: "pacifico" }, null);
  assert.ok(out.parts.length >= 2);
});

test("rating-card prints its caption in a real font, on one line or two", async () => {
  const short = await buildOut("rating-card", { caption: "Great", font: "bebas-neue" }, bebas);
  assert.ok(!short.warnings.some(w => /replaced with/.test(w)));
  const long = await buildOut("rating-card", { caption: "Would sit here again and again", font: "bebas-neue" }, bebas);
  assert.equal(long.parts.length, short.parts.length);
  const gone = await buildOut("rating-card", { caption: "Great \u{1F6BD}", font: "bebas-neue" }, bebas);
  assert.ok(gone.warnings.includes("Some characters aren't in this font and were skipped."));
  await assert.rejects(() => buildOut("rating-card", { caption: "\u{1F6BD}", font: "bebas-neue" }, bebas), /caption are available in this font/);
  await assert.rejects(() => buildOut("rating-card", { caption: "Hi", font: "system", font_license_ack: true }, null), /installed font/);
});

test("label builds in a real font free every object", async () => {
  const tracker = trackLiveObjects(wasm);
  try {
    const wifi = await withBuild(getGenerator("wifi-tag"));
    const card = await withBuild(getGenerator("rating-card"));
    const ok = (g, extra) => validateParams(g, extra).value;
    for (const [g, params] of [[wifi, ok(wifi, { password: "correct-horse", font: "bebas-neue" })], [card, ok(card, { font: "bebas-neue", caption: "Would sit here again" })]]) {
      const out = await g.build(params, { wasm: tracker.ctxWasm, font: bebas });
      for (const s of out.solids) s.solid.delete();
      assert.equal(tracker.live.size, 0, g.id);
    }
    await assert.rejects(() => card.build(validateParams(card, { font: "bebas-neue", caption: "\u{1F6BD}" }).value, { wasm: tracker.ctxWasm, font: bebas }));
    assert.equal(tracker.live.size, 0, "failed build");
  } finally { tracker.restore(); }
});

test("route shield skips characters its font lacks and warns", async () => {
  const out = await buildOut("route-shield", { font: "bebas-neue", top_text: "ROUTE \u{1F6BD}", lower_text: "66", back_text: "", qr_enabled: false }, bebas);
  assert.ok(out.warnings.includes("Some characters aren't in this font and were skipped."));
});

// ---- Installed fonts ------------------------------------------------------------------------

const fontData = (family, style, extra = {}) => ({ family, style, fullName: `${family} ${style}`, postscriptName: `${family}-${style}`.replace(/\s/g, ""), blob: async () => new Blob([bebasBytes]), ...extra });

test("installed fonts are de-duplicated, sorted by name and keyed by PostScript name", async () => {
  const list = await listInstalledFonts(async () => [fontData("Zed", "Regular"), fontData("Arial", "Bold"), fontData("Arial", "Regular"), fontData("Arial", "Regular")]);
  assert.deepEqual(list.map(f => f.label), ["Arial Bold", "Arial Regular", "Zed Regular"]);
  assert.deepEqual(list.map(f => f.id), ["Arial-Bold", "Arial-Regular", "Zed-Regular"]);
});

test("a refused permission and an empty list are explained", async () => {
  await assert.rejects(() => listInstalledFonts(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); }), error => error.message === INSTALLED_DENIED && error.code === "denied");
  await assert.rejects(() => listInstalledFonts(async () => []), error => error.message === INSTALLED_EMPTY);
});

test("the installed-font filter matches every word and caps what is shown", async () => {
  const list = await listInstalledFonts(async () => Array.from({ length: 100 }, (_, i) => fontData(i % 2 ? "Roboto" : "Open Sans", `Style ${i}`)));
  assert.equal(filterFonts(list, "").shown.length, 60);
  assert.equal(filterFonts(list, "").total, 100);
  assert.equal(filterFonts(list, "roboto style 7").total, 14, "odd i holding a 7: every word must match");
  assert.equal(filterFonts(list, "roboto style 7", 3).shown.length, 3);
  assert.equal(filterFonts(list, "nothing").total, 0);
  assert.equal(filterFonts(list, "  OPEN   sans ", 5).shown.length, 5);
});

test("reading an installed font returns its bytes under a system key, and refuses a huge one", async () => {
  const [entry] = await listInstalledFonts(async () => [fontData("Bebas", "Regular")]);
  const read = await readInstalledFont(entry);
  assert.equal(read.key, "system:Bebas-Regular");
  assert.equal(read.label, "Bebas Regular");
  assert.equal(read.bytes.byteLength, bebasBytes.byteLength);
  await assert.rejects(() => readInstalledFont(entry, { maxBytes: 100 }), error => error.message === INSTALLED_TOO_LARGE);
  const [broken] = await listInstalledFonts(async () => [fontData("Gone", "Regular", { blob: async () => { throw new Error("gone"); } })]);
  await assert.rejects(() => readInstalledFont(broken), error => error.message === INSTALLED_UNREADABLE);
});

test("installed fonts are offered only where the browser can list them", () => {
  assert.equal(installedFontsSupported({}), false);
  assert.equal(installedFontsSupported({ queryLocalFonts() {} }), true);
});

test("the worker parses installed-font bytes like a file, and explains an unreadable one", async () => {
  const font = await loadFont({ fontBytes: new Uint8Array(bebasBytes), fontKey: "system:Bebas-Regular" });
  assert.ok(font.charToGlyph("A").index > 0);
  await assert.rejects(() => loadFont({ fontBytes: new Uint8Array([1, 2, 3, 4]), fontKey: "system:Broken" }), /installed font couldn't be read/);
  await assert.rejects(() => loadFont({ fontBytes: new Uint8Array([1, 2, 3, 4]), fontKey: "broken.ttf:4:1" }), /font file couldn't be read/);
});

test("the shared helpers agree on which choices need the license", () => {
  assert.deepEqual(["block", "pacifico", "system", "custom"].map(fontNeedsLicense), [false, false, true, true]);
});
