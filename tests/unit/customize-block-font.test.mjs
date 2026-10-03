import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { blockText, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING } from "../../customizer/framework/text.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import build from "../../customizer/generators/route-shield/build.js";

const wasm = await loadEngine();
const gen = { ...getGenerator("route-shield"), build };
const area = text => { const cs = blockText(wasm.CrossSection, text); try { return cs.area(); } finally { cs.delete?.(); } };

test("the block font draws a comma and an apostrophe instead of '?'", () => {
  assert.deepEqual(unsupportedBlockChars("Tulsa, OK"), []);
  assert.deepEqual(unsupportedBlockChars("Joe's"), []);
  assert.deepEqual(unsupportedBlockChars("Joe\u2019s"), [], "typographic apostrophe is aliased");
  assert.notEqual(area(","), area("?"));
  assert.notEqual(area("'"), area("?"));
  assert.ok(area(",") > area("."), "a comma is a period-sized dot plus a tail");
});

test("unsupported characters are reported", () => {
  assert.deepEqual(unsupportedBlockChars("Café ~"), ["É", "~"]);
});

test("the default model has no substitution warning; unsupported text adds one", async () => {
  const defaults = await buildModel(gen, validateParams(gen, {}).value, { wasm, font: null });
  assert.ok(!defaults.warnings.includes(BLOCK_SUBSTITUTION_WARNING), defaults.warnings.join("; "));
  const { value } = validateParams(gen, { top_text: "CAFÉ" });
  const out = await buildModel(gen, value, { wasm, font: null });
  assert.ok(out.warnings.includes("Some characters aren't available in the built-in font and were replaced with '?'."));
});
