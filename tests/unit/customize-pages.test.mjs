import assert from "node:assert/strict";
import test from "node:test";
import { renderCatalogHtml } from "../../customizer/framework/catalog.js";
import { describeFacts, colorCountLabel, FACTS_NOTE } from "../../customizer/framework/facts.js";
import { listPublicGenerators } from "../../public/assets/js/customize/registry.js";

test("catalog renders one linked card per public generator, escaped", () => {
  const html = renderCatalogHtml(listPublicGenerators());
  assert.match(html, /<a class="cz-card-link" href="\/customize\/g\/route-shield\/">Route shield<\/a>/);
  const evil = renderCatalogHtml([{ id: "x", title: "<b>x</b>", blurb: "\"'", category: "badges" }]);
  assert.ok(!evil.includes("<b>"));
  assert.match(renderCatalogHtml([]), /No customizable models/);
});

test("facts are planning figures with dimensions, volume, weight and time", () => {
  const facts = describeFacts({ dimensionsMm: [80, 88, 5.8], volumeMm3: 26900, surfaceAreaMm2: 16000 }, { colors: 4 });
  assert.equal(facts.colorsLabel, "4 colors");
  assert.deepEqual(facts.rows.map(r => r.label), ["Size", "Volume", "Rough weight", "Rough print time"]);
  assert.equal(facts.rows[0].value, "80 × 88 × 5.8 mm");
  assert.equal(facts.rows[1].value, "26.9 cm³");
  assert.match(facts.rows[2].value, /^about \d+ g PLA$/);
  assert.match(facts.rows[3].value, /^about [\d.]+ (h|min)$/);
  assert.equal(facts.fitsBed, true);
  assert.equal(describeFacts({ dimensionsMm: [300, 10, 2], volumeMm3: 100, surfaceAreaMm2: 100 }).fitsBed, false);
  assert.equal(colorCountLabel(1), "1 color");
  assert.equal(FACTS_NOTE, "Planning figures only; we confirm before printing.");
});
