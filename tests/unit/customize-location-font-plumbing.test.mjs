import assert from "node:assert/strict";
import test from "node:test";
import { handleBuildRequest } from "../../customizer/framework/worker-core.js";
import { locationFontIds } from "../../public/assets/js/customize/fonts.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";

test("a per-location font reaches the builder as ctx.fonts, loaded by id", async () => {
  const loaded = [];
  let seen = null;
  const deps = {
    getGenerator: () => ({ id: "x" }),
    loadBuilder: { x: async () => ({ default: async () => ({}) }) },
    loadEngine: async () => ({}),
    loadFont: async ({ fontId }) => { loaded.push(fontId); return { id: fontId }; },
    buildModel: async (_def, _params, ctx) => { seen = ctx; return { data: new Uint8Array(1) }; }
  };
  const out = await handleBuildRequest({ id: 1, generatorId: "x", params: {}, locationFontIds: ["pacifico"] }, deps);
  assert.equal(out.message.ok, true);
  assert.deepEqual(loaded.filter(Boolean), ["pacifico"]);
  assert.deepEqual(seen.fonts, { pacifico: { id: "pacifico" } });
});

test("locationFontIds finds override fields by flag, whichever copy of fonts.js defined them", () => {
  const gen = getGenerator("route-shield");
  assert.deepEqual(locationFontIds(gen, { top_font: "pacifico", lower_font: "inherit", back_font: "block" }), ["pacifico"]);
});
