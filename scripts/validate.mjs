import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArchitecture } from "./check-architecture.mjs";
import { scanBrowserSecrets, scanRemoteRequests } from "./browser-secret-scan.mjs";
import { GENERATORS, listPublicGenerators } from "../public/assets/js/customize/registry.js";
import { loadBuilder } from "../customizer/generators/index.js";
import { renderCatalogHtml } from "../customizer/framework/catalog.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(root, "public");
const operatorRoot = resolve(root, "operator");
const errors = [];
const requiredPublic = ["index.html", "services.html", "portfolio.html", "about.html", "order.html", "privacy.html", "terms.html", "404.html", "manifest.webmanifest", "robots.txt", "sitemap.xml", "favicon.svg"];
// Produced by `npm run customizer:build` (Vite) before validation runs.
const requiredBuilt = ["customize/index.html"];
const requiredRoot = ["vercel.json", "package.json", ".env.example", "integrations/home-assistant/package.yaml", "integrations/home-assistant/dashboard.yaml", "integrations/home-assistant/README.md"];

async function walk(path) {
  const result = [];
  for (const name of await readdir(path)) {
    if ([".git", "node_modules", ".vercel", "__pycache__", ".pytest_cache"].includes(name)) continue;
    const full = join(path, name);
    const info = await stat(full);
    if (info.isDirectory()) result.push(...await walk(full)); else result.push(full);
  }
  return result;
}
function exists(path) { return stat(path).then(() => true).catch(() => false); }
function cleanRef(ref) { return ref.split("#")[0].split("?")[0]; }
function localTarget(file, ref) {
  const cleaned = cleanRef(ref);
  if (!cleaned || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(cleaned)) return null;
  const decoded = decodeURIComponent(cleaned);
  const candidate = decoded.startsWith("/") ? resolve(publicRoot, `.${decoded}`) : resolve(dirname(file), decoded);
  return candidate;
}

// Generator gates (see docs/GENERATORS.md): every registered generator has a source page that
// names it, a builder, a built page and a provenance/rights record; a publishable one is also in
// the sitemap (entries are added by hand), the catalog and the screenshot set; one that is not
// publishable stays out of the sitemap and catalog.
const sitemap = await readFile(join(publicRoot, "sitemap.xml"), "utf8").catch(() => "");
const screenshotScript = await readFile(join(root, "scripts/capture_screenshots.py"), "utf8").catch(() => "");
const catalogHtml = renderCatalogHtml(listPublicGenerators());
for (const generator of Object.values(GENERATORS)) {
  const { id } = generator;
  const where = `generator ${id}`;
  const sitemapEntry = `<loc>https://3dprint4.me/customize/g/${id}/</loc>`;
  const catalogLink = `href="/customize/g/${id}/"`;
  requiredBuilt.push(`customize/g/${id}/index.html`);
  const source = await readFile(join(root, "customizer/g", id, "index.html"), "utf8").catch(() => "");
  if (!source.includes(`<meta name="generator-id" content="${id}">`)) errors.push(`customizer/g/${id}/index.html: missing page or <meta name="generator-id" content="${id}">`);
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
if (!sitemap.includes("<loc>https://3dprint4.me/customize/</loc>")) errors.push("public/sitemap.xml: missing /customize/");
for (const name of requiredBuilt) if (!(await exists(join(publicRoot, name)))) errors.push(`Missing built file: ${name} (run npm run customizer:build)`);
for (const name of requiredPublic) if (!(await exists(join(publicRoot, name)))) errors.push(`Missing public file: ${name}`);
for (const name of requiredRoot) if (!(await exists(join(root, name)))) errors.push(`Missing root file: ${name}`);
for (const name of ["index.html", "manifest.webmanifest", "sw.js", "assets/operator.css", "assets/operator.js"]) if (!(await exists(join(operatorRoot, name)))) errors.push(`Missing operator file: ${name}`);
if (await exists(join(publicRoot, "operator"))) errors.push("operator/: private operator application must not be inside public output");

const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
if (vercel.outputDirectory !== "public") errors.push("vercel.json: outputDirectory must be public");
const indexHtml = await readFile(join(publicRoot, "index.html"), "utf8");
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.length > 0);
const csp = (vercel.headers || []).flatMap(rule => rule.headers || []).find(header => header.key === "Content-Security-Policy")?.value || "";
for (const source of inlineScripts) {
  const hash = `sha256-${createHash("sha256").update(source).digest("base64")}`;
  if (!csp.includes(`'${hash}'`)) errors.push(`vercel.json: CSP is missing inline script hash ${hash}`);
}
const files = await walk(root);
const publicFiles = await walk(publicRoot);
const htmlFiles = publicFiles.filter(file => extname(file) === ".html");
let refsChecked = 0;
for (const file of htmlFiles) {
  const text = await readFile(file, "utf8");
  if (!/^<!doctype html>/i.test(text.trimStart())) errors.push(`${file}: missing HTML doctype`);
  if (!/<html[^>]+lang="en"/i.test(text)) errors.push(`${file}: missing lang=en`);
  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) errors.push(`${file}: duplicate ids: ${duplicateIds.join(", ")}`);
  for (const match of text.matchAll(/<img\b([^>]*)>/gi)) if (!/\balt="[^"]*"/i.test(match[1])) errors.push(`${file}: img missing alt attribute`);
  const refs = [...text.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  for (const ref of refs) {
    const target = localTarget(file, ref);
    if (!target) continue;
    refsChecked++;
    if (!(target === publicRoot || target.startsWith(`${publicRoot}${sep}`))) errors.push(`${file}: path escapes public output: ${ref}`);
    else if (!(await exists(target))) errors.push(`${file}: missing local reference ${ref}`);
  }
}

const operatorHtml = await readFile(join(operatorRoot, "index.html"), "utf8");
for (const ref of [...operatorHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match => match[1])) {
  if (/^(https?:|data:)/i.test(ref)) errors.push(`operator/index.html: external browser asset is not allowed: ${ref}`);
  const target = resolve(operatorRoot, `.${cleanRef(ref)}`);
  if (!(target === operatorRoot || target.startsWith(`${operatorRoot}${sep}`)) || !(await exists(target))) errors.push(`operator/index.html: missing local reference ${ref}`);
}
for (const { file, secret } of await scanBrowserSecrets([publicRoot, operatorRoot])) {
  errors.push(`${file}: browser source contains forbidden secret name ${secret}`);
}
// The customizer works from its own origin alone: no remote URL or remote request in its bundle.
const customizeRoot = join(publicRoot, "customize");
if (await exists(customizeRoot)) {
  for (const { file, url, reason } of await scanRemoteRequests([customizeRoot])) {
    errors.push(`${file}: ${reason} ${url} (public/customize must not contact another origin; see scripts/browser-secret-scan.mjs)`);
  }
}

const homeAssistantPackagePath = join(root, "integrations/home-assistant/package.yaml");
const homeAssistantDashboardPath = join(root, "integrations/home-assistant/dashboard.yaml");
if (await exists(homeAssistantPackagePath) && await exists(homeAssistantDashboardPath)) {
  const packageYaml = await readFile(homeAssistantPackagePath, "utf8");
  const dashboardYaml = await readFile(homeAssistantDashboardPath, "utf8");
  for (const [label, valid] of [
    ["snapshot endpoint", /resource:\s*https:\/\/3dprint4\.me\/api\/home-assistant-work/.test(packageYaml)],
    ["secret Authorization header", /Authorization:\s*!secret three_d_print_work_authorization/.test(packageYaml)],
    ["one-minute polling", /scan_interval:\s*60/.test(packageYaml)],
    ["persistent notification", /persistent_notification\.create/.test(packageYaml)],
    ["canonical alert link", /https:\/\/work\.3dprint4\.me\/work\//.test(packageYaml)],
    ["canonical dashboard link", /https:\/\/work\.3dprint4\.me\//.test(dashboardYaml)],
    ["item canonical URLs", /item\.url/.test(dashboardYaml)],
    ["read-only configuration", !/operator-work-update|\backnowledge\b|set-status|add-note/.test(`${packageYaml}\n${dashboardYaml}`)]
  ]) if (!valid) errors.push(`Home Assistant integration: missing or invalid ${label}`);
}

const jsFiles = files.filter(file => [".js", ".mjs"].includes(extname(file)));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) errors.push(`${file}: JavaScript syntax error\n${result.stderr}`);
}

const architecture = await checkArchitecture({ root });
for (const violation of architecture.violations) errors.push(`${violation.file}: ${violation.rule} (${violation.import})`);

if (errors.length) {
  console.error(`Validation failed with ${errors.length} issue(s):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Validated ${htmlFiles.length} HTML pages, ${refsChecked} local references, and ${jsFiles.length} JavaScript files.`);
console.log(`Architecture boundaries passed for ${architecture.filesChecked} JavaScript files.`);
console.log("Static validation passed.");
