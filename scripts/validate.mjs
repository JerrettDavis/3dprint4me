import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(root, "public");
const operatorRoot = resolve(root, "operator");
const errors = [];
const requiredPublic = ["index.html", "services.html", "portfolio.html", "about.html", "order.html", "privacy.html", "terms.html", "404.html", "manifest.webmanifest", "robots.txt", "sitemap.xml", "favicon.svg"];
const requiredRoot = ["vercel.json", "package.json", ".env.example"];

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
const operatorFiles = await walk(operatorRoot);
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
const forbiddenBrowserSecrets = ["VAPID_PRIVATE_KEY", "PUSH_WORKER_SECRET", "DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY"];
for (const file of operatorFiles.filter(file => [".html", ".js", ".css", ".json", ".webmanifest", ".svg"].includes(extname(file)))) {
  const source = await readFile(file, "utf8");
  for (const secret of forbiddenBrowserSecrets) if (source.includes(secret)) errors.push(`${file}: browser source contains forbidden secret name ${secret}`);
}

const jsFiles = files.filter(file => [".js", ".mjs"].includes(extname(file)));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) errors.push(`${file}: JavaScript syntax error\n${result.stderr}`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} issue(s):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Validated ${htmlFiles.length} HTML pages, ${refsChecked} local references, and ${jsFiles.length} JavaScript files.`);
console.log("Static validation passed.");
