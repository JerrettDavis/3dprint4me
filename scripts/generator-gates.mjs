// Generator gates for `npm run validate` (see docs/GENERATORS.md). Callable with a fixture root
// and registry so each gate can be proven to fail (tests/unit/generator-gates.test.mjs).
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { linkedSiteAssets, scanRemoteRequests } from "./browser-secret-scan.mjs";

const exists = path => stat(path).then(() => true).catch(() => false);

/**
 * Every registered generator has a source page that names it, a builder, a built page, an origin,
 * an integer version and a rights record. A publishable one is also in the sitemap (entries are
 * added by hand), the catalog and the screenshot set; one that is not publishable stays out of
 * the sitemap and catalog. Returns a list of error messages.
 */
export async function checkGenerators({ root, publicRoot = join(root, "public"), generators, loadBuilder, catalogHtml }) {
  const errors = [];
  const sitemap = await readFile(join(publicRoot, "sitemap.xml"), "utf8").catch(() => "");
  const screenshotScript = await readFile(join(root, "scripts/capture_screenshots.py"), "utf8").catch(() => "");
  if (!sitemap.includes("<loc>https://3dprint4.me/customize/</loc>")) errors.push("public/sitemap.xml: missing /customize/");
  if (!(await exists(join(publicRoot, "customize/index.html")))) errors.push("Missing built file: customize/index.html (run npm run customizer:build)");
  for (const generator of Object.values(generators)) {
    const { id } = generator;
    const where = `generator ${id}`;
    const sitemapEntry = `<loc>https://3dprint4.me/customize/g/${id}/</loc>`;
    const catalogLink = `href="/customize/g/${id}/"`;
    const source = await readFile(join(root, "customizer/g", id, "index.html"), "utf8").catch(() => "");
    if (!source.includes(`<meta name="generator-id" content="${id}">`)) errors.push(`customizer/g/${id}/index.html: missing page or <meta name="generator-id" content="${id}">`);
    if (!(await exists(join(publicRoot, "customize/g", id, "index.html")))) errors.push(`Missing built file: customize/g/${id}/index.html (run npm run customizer:build)`);
    if (typeof loadBuilder[id] !== "function") errors.push(`customizer/generators/index.js: ${where} has no loadBuilder entry`);
    if (typeof generator.rights?.publishable !== "boolean") errors.push(`${where}: rights.publishable must be true or false`);
    if (typeof generator.rights?.note !== "string" || !generator.rights.note.trim()) errors.push(`${where}: rights.note must say where the design comes from and why it may (or may not) be published`);
    if (typeof generator.origin !== "string" || !generator.origin.trim()) errors.push(`${where}: origin is required`);
    if (!Number.isInteger(generator.version) || generator.version < 1) errors.push(`${where}: version must be a positive integer`);
    if (generator.rights?.publishable === true) {
      if (!sitemap.includes(sitemapEntry)) errors.push(`public/sitemap.xml: missing public generator /customize/g/${id}/`);
      if (!catalogHtml.includes(catalogLink)) errors.push(`${where}: missing from the catalog`);
      if (!screenshotScript.includes(`/customize/g/${id}/`)) errors.push(`scripts/capture_screenshots.py: no screenshot of /customize/g/${id}/`);
    } else {
      if (sitemap.includes(sitemapEntry)) errors.push(`public/sitemap.xml: unpublishable generator ${id} must not be listed`);
      if (catalogHtml.includes(catalogLink)) errors.push(`${where}: unpublishable generator must not be in the catalog`);
    }
  }
  return errors;
}

async function htmlUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlUnder(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/**
 * The customizer works from its own origin alone: nothing in public/customize/ may name or request
 * another origin (strict), and the shared site assets its pages load (site.css, site.js and their
 * imports, ...) may not request one either ("requests" mode: their ordinary <a href> profile links
 * are navigation, not requests). Returns a list of error messages.
 */
export async function checkCustomizeNetwork({ publicRoot }) {
  const customizeRoot = join(publicRoot, "customize");
  if (!(await exists(customizeRoot))) return [];
  const errors = [];
  const rule = "must not contact another origin; see scripts/browser-secret-scan.mjs";
  for (const { file, url, reason } of await scanRemoteRequests([customizeRoot])) errors.push(`${file}: ${reason} ${url} (public/customize ${rule})`);
  const linked = await linkedSiteAssets(publicRoot, await htmlUnder(customizeRoot), { customizeDir: customizeRoot });
  for (const { file, url, reason } of await scanRemoteRequests(linked, { mode: "requests" })) errors.push(`${file}: ${reason} ${url} (an asset loaded by /customize pages ${rule})`);
  return errors;
}
