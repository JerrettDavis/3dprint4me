import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkCustomizeNetwork, checkGenerators } from "../../scripts/generator-gates.mjs";
import { renderCatalogHtml } from "../../customizer/framework/catalog.js";
import { GENERATORS, listPublicGenerators } from "../../public/assets/js/customize/registry.js";
import { loadBuilder } from "../../customizer/generators/index.js";

const gen = (id, over = {}) => ({ id, title: id, blurb: "b", category: "tags", version: 1, origin: "house", rights: { publishable: true, note: "House design." }, ...over });
const sitemapFor = ids => `<urlset><url><loc>https://3dprint4.me/customize/</loc></url>${ids.map(id => `<url><loc>https://3dprint4.me/customize/g/${id}/</loc></url>`).join("")}</urlset>`;

// A complete fixture for generators a and b; `drop` removes one file, `files` overrides contents.
async function fixture({ ids = ["a", "b"], files = {}, drop = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "3dp-gates-"));
  const all = {
    "public/sitemap.xml": sitemapFor(ids),
    "public/customize/index.html": "<!doctype html>",
    "scripts/capture_screenshots.py": ids.map(id => `("x", "/customize/g/${id}/", "x.png")`).join("\n"),
    ...Object.fromEntries(ids.flatMap(id => [
      [`customizer/g/${id}/index.html`, `<meta name="generator-id" content="${id}">`],
      [`public/customize/g/${id}/index.html`, "<!doctype html>"]
    ])),
    ...files
  };
  for (const [path, text] of Object.entries(all)) {
    if (drop.includes(path)) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
async function gateErrors({ generators, ...options }) {
  const root = await fixture(options);
  try {
    const list = Object.values(generators);
    const builders = Object.fromEntries(list.map(g => [g.id, () => {}]));
    return await checkGenerators({ root, generators, loadBuilder: options.loadBuilder ?? builders, catalogHtml: renderCatalogHtml(list.filter(g => g.rights?.publishable === true)) });
  } finally { await rm(root, { recursive: true, force: true }); }
}
const both = { a: gen("a"), b: gen("b") };

test("a complete fixture passes every generator gate", async () => {
  assert.deepEqual(await gateErrors({ generators: both }), []);
});

test("each missing piece fails its own gate", async () => {
  const cases = [
    [{ drop: ["public/customize/g/b/index.html"] }, /Missing built file: customize\/g\/b\/index.html/],
    [{ drop: ["customizer/g/b/index.html"] }, /customizer\/g\/b\/index.html: missing page/],
    [{ files: { "public/sitemap.xml": sitemapFor(["a"]) } }, /sitemap.xml: missing public generator \/customize\/g\/b\//],
    [{ files: { "scripts/capture_screenshots.py": "/customize/g/a/" } }, /no screenshot of \/customize\/g\/b\//],
    [{ generators: { a: gen("a"), b: gen("b", { rights: { publishable: true, note: "  " } }) } }, /generator b: rights.note/],
    [{ generators: { a: gen("a"), b: gen("b", { rights: { note: "x" } }) }, files: { "public/sitemap.xml": sitemapFor(["a"]) } }, /generator b: rights.publishable/],
    [{ generators: { a: gen("a"), b: gen("b", { origin: "" }) } }, /generator b: origin is required/],
    [{ generators: { a: gen("a"), b: gen("b", { version: 0 }) } }, /generator b: version/],
    [{ loadBuilder: { a: () => {} } }, /generator b has no loadBuilder entry/]
  ];
  for (const [options, expected] of cases) {
    const errors = await gateErrors({ generators: both, ...options });
    assert.equal(errors.length, 1, `${expected}: ${JSON.stringify(errors)}`);
    assert.match(errors[0], expected);
  }
});

test("a publishable generator missing from the catalog fails", async () => {
  const root = await fixture();
  try {
    const errors = await checkGenerators({ root, generators: both, loadBuilder: { a() {}, b() {} }, catalogHtml: renderCatalogHtml([both.a]) });
    assert.deepEqual(errors, ["generator b: missing from the catalog"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unpublishable generator listed in the sitemap or catalog fails", async () => {
  const hidden = { a: gen("a"), b: gen("b", { rights: { publishable: false, note: "Client commission; not for reuse." } }) };
  const root = await fixture();   // the fixture's sitemap lists b
  try {
    const errors = await checkGenerators({ root, generators: hidden, loadBuilder: { a() {}, b() {} }, catalogHtml: renderCatalogHtml(Object.values(hidden)) });
    assert.deepEqual(errors.sort(), ["generator b: unpublishable generator must not be in the catalog", "public/sitemap.xml: unpublishable generator b must not be listed"]);
    const clean = await checkGenerators({ root, generators: hidden, loadBuilder: { a() {}, b() {} }, catalogHtml: renderCatalogHtml([hidden.a]) });
    assert.deepEqual(clean, ["public/sitemap.xml: unpublishable generator b must not be listed"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the real repository passes the generator gates", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const errors = await checkGenerators({ root, generators: GENERATORS, loadBuilder, catalogHtml: renderCatalogHtml(listPublicGenerators()) });
  // Built pages exist only after `npm run customizer:build` (npm test builds first).
  assert.deepEqual(errors.filter(e => !e.startsWith("Missing built file")), []);
});

test("a site asset that a /customize page loads may not request another origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "3dp-net-"));
  const pub = join(root, "public");
  const write = async (path, text) => { await mkdir(dirname(join(pub, path)), { recursive: true }); await writeFile(join(pub, path), text); };
  try {
    await write("customize/g/a/index.html", '<!doctype html><link rel="stylesheet" href="/assets/css/site.css?v=1"><script type="module" src="/assets/js/site.js?v=1"></script><a href="/order.html">x</a>');
    await write("assets/css/site.css", ".a{color:red}");
    await write("assets/js/site.js", 'import { C } from "./config.js?v=1";');
    await write("assets/js/config.js", 'export const C = { profile: "https://www.printables.com/@someone" };');
    await write("assets/js/unlinked.js", 'fetch("https://evil.example/never-loaded")');
    assert.deepEqual(await checkCustomizeNetwork({ publicRoot: pub }), [], "navigation links and unlinked files are not requests");
    await write("assets/css/site.css", ".a{background:url(https://evil.example/x.png)} .b{background:url(//evil.example/y.png)}");
    await write("assets/js/config.js", 'export const C = 1; fetch("https://evil.example/c");');
    const errors = await checkCustomizeNetwork({ publicRoot: pub });
    for (const [file, url] of [["site.css", "https://evil.example/x.png"], ["site.css", "//evil.example/y.png"], ["config.js", "https://evil.example/c"]]) {
      assert.ok(errors.some(e => e.includes(`${file}: `) && e.includes(` ${url} (`)), `${file} ${url}: ${JSON.stringify(errors)}`);
    }
    assert.equal(errors.length, 3, JSON.stringify(errors));
    assert.ok(!errors.some(e => e.includes("unlinked")), JSON.stringify(errors));
  } finally { await rm(root, { recursive: true, force: true }); }
});
