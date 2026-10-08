// The curated font catalogue: every entry has its file, its OFL text, a pinned checksum and a
// category; every file parses in opentype.js and draws text; the text builder makes geometry from
// the script and blackletter faces; the picker options are grouped in category order.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { fontText } from "../../customizer/framework/text.js";
import { CURATED_FONTS } from "../../customizer/framework/fonts.js";
import { FONTS, FONT_CATEGORIES, FONT_OPTIONS, LOCATION_FONT_OPTIONS, findFont } from "../../public/assets/js/customize/fonts.js";

const DIR = new URL("../../customizer/static/fonts/", import.meta.url);
const parse = opentype.parse ?? opentype.default.parse;
const bytesOf = async name => readFile(new URL(name, DIR));
const parsed = new Map();
async function load(f) {
  if (!parsed.has(f.id)) {
    const b = await bytesOf(f.file);
    parsed.set(f.id, parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return parsed.get(f.id);
}

test("a broad, varied catalogue: unique ids and files, every category used, bold weights for body families", () => {
  assert.ok(FONTS.length >= 30 && FONTS.length <= 40, `${FONTS.length} fonts`);
  assert.equal(new Set(FONTS.map(f => f.id)).size, FONTS.length, "unique ids");
  assert.equal(new Set(FONTS.map(f => f.file)).size, FONTS.length, "unique files");
  assert.equal(new Set(FONTS.map(f => f.label)).size, FONTS.length, "unique labels");
  const ids = FONT_CATEGORIES.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.isFrozen(FONT_CATEGORIES));
  for (const f of FONTS) assert.ok(ids.includes(f.category), `${f.id} category ${f.category}`);
  for (const c of FONT_CATEGORIES) {
    assert.ok(c.label.length > 2);
    assert.ok(FONTS.some(f => f.category === c.id), `category ${c.id} is not empty`);
  }
  for (const id of ["sans", "serif", "slab", "mono", "script", "handwriting", "display", "blackletter", "fantasy", "western"]) assert.ok(ids.includes(id), id);
  // Thin strokes print badly: body-style families are offered in bold or heavier weights only.
  for (const f of FONTS.filter(x => ["sans", "serif", "slab", "mono"].includes(x.category))) assert.match(f.label, /(Bold|ExtraBold|Black)$|^(Spectral|Cinzel)/, f.label);
});

test("FONTS is listed in picker order and the options carry their category heading", () => {
  const rank = id => FONT_CATEGORIES.findIndex(c => c.id === id);
  const ranks = FONTS.map(f => rank(f.category));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "FONTS follows FONT_CATEGORIES order");
  for (const options of [FONT_OPTIONS, LOCATION_FONT_OPTIONS]) {
    const curated = options.filter(o => findFont(o.value));
    assert.deepEqual(curated.map(o => o.value), FONTS.map(f => f.id));
    for (const o of curated) {
      const f = findFont(o.value);
      assert.equal(o.group, FONT_CATEGORIES.find(c => c.id === f.category).label);
      assert.equal(o.face, f.id);
      assert.equal(o.label, f.label);
    }
    // Non-curated entries keep no group; block (and inherit) lead, system/custom trail.
    for (const o of options.filter(x => !findFont(x.value))) assert.equal(o.group, undefined, o.value);
  }
  assert.equal(FONT_OPTIONS[0].value, "block");
  assert.deepEqual(FONT_OPTIONS.slice(-2).map(o => o.value), ["system", "custom"]);
  assert.deepEqual(Object.keys(CURATED_FONTS), FONTS.map(f => f.id));
});

test("each font has its file, an OFL text, a license entry, a pinned checksum and an @font-face", async () => {
  const sums = new Map((await readFile(new URL("SHA256SUMS", DIR), "utf8")).trim().split(/\r?\n/).map(l => { const [h, n] = l.split(/\s+\*?/); return [n, h]; }));
  const licenses = await readFile(new URL("LICENSES.md", DIR), "utf8");
  const css = await readFile(new URL("fonts.css", DIR), "utf8");
  const onDisk = (await readdir(DIR)).filter(n => n.endsWith(".ttf")).sort();
  assert.deepEqual(onDisk, FONTS.map(f => f.file).sort(), "no unlisted font ships");
  assert.deepEqual([...sums.keys()].sort(), onDisk, "SHA256SUMS pins exactly the shipped fonts");
  let total = 0;
  for (const f of FONTS) {
    const b = await bytesOf(f.file);
    total += b.length;
    assert.ok(b.length < 460 * 1024, `${f.file} is ${b.length} bytes`);
    assert.equal(createHash("sha256").update(b).digest("hex"), sums.get(f.file), f.file);
    assert.equal(f.license, "OFL-1.1");
    const ofl = await readFile(new URL(f.licenseFile, DIR), "utf8");
    assert.match(ofl, /SIL OPEN FONT LICENSE\s+Version 1\.1/, f.licenseFile);
    assert.match(ofl, /^Copyright/m, `${f.licenseFile} names the copyright`);
    const entry = licenses.split("\n## ").find(s => s.startsWith(f.label + "\n"));
    assert.ok(entry, `LICENSES.md entry for ${f.label}`);
    assert.ok(entry.includes(f.file) && entry.includes(f.licenseFile) && entry.includes("github.com/google/fonts"), f.label);
    assert.match(entry, /Copyright/);
    assert.match(css, new RegExp(`font-family: "cz-${f.id}"; src: url\\("${f.file.replace(".", "\\.")}"\\)`), `${f.id} @font-face`);
    assert.match(css, new RegExp(`\\.cz-ff-${f.id} \\{ font-family: "cz-${f.id}"`), `${f.id} class`);
  }
  assert.ok(total < 7 * 1024 * 1024, `catalogue payload ${total} bytes`);
});

test("every font is a static font that parses and draws a basic glyph set", async () => {
  for (const f of FONTS) {
    const font = await load(f);
    assert.ok(!font.tables.fvar, `${f.id} is static`);
    // Per glyph, as the text builder does (fontTextPath); a few older fonts carry GSUB lookups that
    // opentype.js's whole-string shaper rejects, which the builder never uses.
    const commands = [...(("Hag 123"))].flatMap(ch => font.charToGlyph(ch).getPath(0, 0, 72).commands);
    assert.ok(commands.length > 10, `${f.id} draws text`);
    const bb = font.charToGlyph("H").getBoundingBox();
    assert.ok(bb.x2 > bb.x1 && bb.y2 > bb.y1, `${f.id} has an extent`);
    for (const ch of "HagAZ09") assert.ok(font.charToGlyph(ch).index > 0, `${f.id} has ${ch}`);
  }
});

test("fontText builds non-empty geometry from a script, a blackletter and a heavy sans face", async () => {
  const { CrossSection } = await loadEngine();
  for (const id of ["sacramento", "alex-brush", "unifraktur-cook", "pirata-one", "montserrat-extrabold", "medievalsharp", "rye"]) {
    const cs = fontText(CrossSection, await load(findFont(id)), "Mary Ann", { fillRule: "NonZero" });
    const b = cs.bounds();
    assert.ok(cs.area() > 1, `${id} area`);
    assert.ok(b.max[0] - b.min[0] > 5 && b.max[1] - b.min[1] > 1, `${id} bounds`);
    cs.delete?.();
  }
});
