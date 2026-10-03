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

test("every registered generator has a page, a builder, a sitemap entry and a catalog link", async () => {
  const { readFile } = await import("node:fs/promises");
  const { loadBuilder } = await import("../../customizer/generators/index.js");
  const sitemap = await readFile(new URL("../../public/sitemap.xml", import.meta.url), "utf8");
  const catalog = renderCatalogHtml(listPublicGenerators());
  const ids = listPublicGenerators().map(g => g.id);
  assert.ok(ids.includes("wifi-tag"), ids.join(","));
  for (const g of listPublicGenerators()) {
    const html = await readFile(new URL(`../../customizer/g/${g.id}/index.html`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`<meta name="generator-id" content="${g.id}">`));
    assert.match(html, new RegExp(`<link rel="canonical" href="https://3dprint4.me/customize/g/${g.id}/">`));
    assert.match(html, new RegExp(`<title>${g.title} \| Customize \| 3dprint4.me</title>`));
    assert.match(html, new RegExp(`<h1 class="cz-title">${g.title}</h1>`));
    // CSP: no inline scripts, ever.
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\bsrc="/, tag);
    assert.doesNotMatch(html, /<script\b[^>]*>[^<]+<\/script>/);
    assert.ok(sitemap.includes(`<loc>https://3dprint4.me/customize/g/${g.id}/</loc>`), `${g.id} in sitemap`);
    assert.equal(typeof loadBuilder[g.id], "function", `${g.id} has a builder`);
    assert.ok(catalog.includes(`href="/customize/g/${g.id}/">${g.title}</a>`), `${g.id} in catalog`);
  }
});

test("the Wi-Fi tag page states where the password goes", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../customizer/g/wifi-tag/index.html", import.meta.url), "utf8");
  assert.ok(html.includes("The password is encoded in the QR code inside your model file. The file is stored privately like any upload and seen by us when we print it. It is not copied into our request records, emails or your saved draft."));
});
