import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const forbiddenBrowserSecrets = ["VAPID_PRIVATE_KEY", "PUSH_WORKER_SECRET", "DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "HOME_ASSISTANT_TOKEN", "SLICER_HTTP_TOKEN"];

const textExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml"]);

async function filesWithin(path) {
  const entry = await stat(path);
  if (!entry.isDirectory()) return [path];
  const files = [];
  for (const name of await readdir(path)) files.push(...await filesWithin(join(path, name)));
  return files;
}

// --- Remote requests (the /customize bundle must work with nothing but its own origin) --------
// Every absolute URL literal in served code must be one of these exact strings (XML/SVG
// namespace identifiers, which are names, not requests; opentype.js error-message links) or
// start with the site's own origin. Anything else fails, even when no call site is visible
// (`const u = "https://…"; fetch(u)`). License texts (.md, .txt) are not executed and skipped.
export const allowedUrlStrings = Object.freeze([
  "http://schemas.microsoft.com/3dmanufacturing/core/2015/02",
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://schemas.openxmlformats.org/package/2006/content-types",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "https://github.com/opentypejs/opentype.js/issues/675",
  "https://github.com/opentypejs/opentype.js/issues/183#issuecomment-1147228025"
]);
export const sameOriginPrefixes = Object.freeze(["https://3dprint4.me/"]);

const remoteScanExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".xml"]);
const ABSOLUTE_URL = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>()\\]*/gi;
const LITERAL = String.raw`(["'\x60])((?:\\.|(?!\1)[^\\])*)\1`;
// Network sinks whose first argument is a string literal, and XMLHttpRequest#open's URL.
const SINK_CALL = new RegExp(String.raw`\b(?:fetch|importScripts|import|sendBeacon|WebSocket|EventSource|Worker|SharedWorker)\s*\(\s*${LITERAL}`, "g");
const XHR_OPEN = new RegExp(String.raw`\.open\s*\(\s*["'\x60][A-Za-z]+["'\x60]\s*,\s*${LITERAL}`, "g");

// Protocol-relative URLs (`//host/...`) load from another origin with the page's scheme. A host is
// `localhost`, an IPv4/IPv6 literal, or dotted labels ending in a letter label, followed by a port,
// path, query, fragment or the end of the value. Plain paths (`/a//b`), comments (`// note`) and
// base64 (`//8A…`, no dots) never match.
const HOST = String.raw`(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9A-Fa-f:.]+\]|(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z][A-Za-z0-9-]*)(?=[:/?#"'\x60\s)>,;]|$)`;
const PROTOCOL_RELATIVE = new RegExp(String.raw`^\s*\/\/${HOST}`);
// A string literal (any quote) whose value starts with //host. The literal must close with the
// same quote before any whitespace, so a `// comment` after an empty string is not a literal.
const QUOTED_PROTOCOL_RELATIVE = new RegExp(String.raw`(["'\x60])(\/\/${HOST}[^"'\x60\s]*)\1`, "g");
// CSS: url(//host…) unquoted, and @import "//host…" / @import url(//host…).
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(["'])([^"']*)\1/gi;
// HTML URL attributes, quoted or not. srcset holds a comma-separated list of "url descriptor".
const HTML_URL_ATTRIBUTE = /\s(src|href|srcset|action|formaction|poster|data-src|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const urlCandidates = (name, value) => /srcset$/i.test(name) ? value.split(",").map(part => part.trim().split(/\s+/)[0]) : [value];

const isAllowedUrl = url => allowedUrlStrings.includes(url) || sameOriginPrefixes.some(prefix => url.startsWith(prefix));
// A sink argument is local when it is relative, same-origin absolute, data: or blob:.
function isRemoteSinkTarget(target) {
  const value = target.trim();
  if (/^(?:data|blob):/i.test(value)) return false;
  if (value.startsWith("//")) return true;                     // protocol-relative: another host
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return !isAllowedUrl(value);
  return false;
}

/**
 * Findings for one file's text: [{ url, reason }] (each URL once).
 * mode "strict" (the /customize bundle): every absolute URL literal must be allow-listed.
 * mode "requests" (shared site assets a generator page links, e.g. site.js, which renders
 * ordinary <a href> profile links): only things that make a request are checked — network sink
 * calls, protocol-relative literals, CSS url()/@import, and HTML/SVG resource attributes.
 */
export function remoteRequestsIn(source, extension, { mode = "strict" } = {}) {
  const ext = extension.toLowerCase();
  const found = new Map();
  const add = (url, reason) => { if (!found.has(url)) found.set(url, reason); };
  const isRemoteResource = value => PROTOCOL_RELATIVE.test(value) || (/^\s*(?:https?|wss?|ftp):/i.test(value) && !isAllowedUrl(value.trim()));
  if (mode === "strict") {
    for (const [url] of source.matchAll(ABSOLUTE_URL)) if (!isAllowedUrl(url)) add(url, "remote URL literal");
  } else if (ext === ".css" || ext === ".html" || ext === ".svg") {
    for (const pattern of [CSS_URL, CSS_IMPORT]) {
      for (const match of source.matchAll(pattern)) if (isRemoteResource(match[2])) add(match[2].trim(), "remote stylesheet resource");
    }
  }
  for (const pattern of [SINK_CALL, XHR_OPEN]) {
    for (const match of source.matchAll(pattern)) if (isRemoteSinkTarget(match[2])) add(match[2], "remote request");
  }
  for (const match of source.matchAll(QUOTED_PROTOCOL_RELATIVE)) add(match[2], "protocol-relative URL");
  if (ext === ".css" || ext === ".html" || ext === ".svg") {
    for (const pattern of [CSS_URL, CSS_IMPORT]) {
      for (const match of source.matchAll(pattern)) if (PROTOCOL_RELATIVE.test(match[2])) add(match[2].trim(), "protocol-relative URL");
    }
  }
  if (ext === ".html" || ext === ".svg") {
    for (const match of source.matchAll(HTML_URL_ATTRIBUTE)) {
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      for (const candidate of urlCandidates(match[1], value)) if (PROTOCOL_RELATIVE.test(candidate)) add(candidate, "protocol-relative URL");
    }
  }
  return [...found].map(([url, reason]) => ({ url, reason }));
}

/** Remote URLs and remote request call sites in served text under `paths` (files or directories): [{ file, url, reason }]. */
export async function scanRemoteRequests(paths, { mode = "strict" } = {}) {
  const findings = [];
  for (const input of paths) {
    const path = input instanceof URL ? fileURLToPath(input) : input;
    for (const file of await filesWithin(path)) {
      const extension = extname(file);
      if (!remoteScanExtensions.has(extension.toLowerCase())) continue;
      for (const finding of remoteRequestsIn(await readFile(file, "utf8"), extension, { mode })) findings.push({ file, ...finding });
    }
  }
  return findings;
}

const LOCAL_REF = /\b(?:href|src)\s*=\s*["'](\/(?!\/)[^"'#?]*)/gi;
const JS_IMPORT = /(?:\bimport\s*(?:[^'"()]*?\bfrom\s*)?|\bexport\s+[^'"]*?\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"'?#]+)/g;
const CSS_LOCAL_IMPORT = /@import\s+(?:url\()?\s*["']?(\.{1,2}\/[^"')?#]+|\/(?!\/)[^"')?#]+)/gi;

/**
 * The site assets (outside `customizeDir`) that the given HTML pages load: stylesheets, scripts,
 * icons and manifests they reference by a root-relative path, plus the modules and stylesheets
 * those import, transitively. Navigation targets (.html pages, directories) are not assets.
 */
export async function linkedSiteAssets(publicRoot, htmlFiles, { customizeDir = join(publicRoot, "customize") } = {}) {
  const assets = new Set();
  const queue = [];
  const consider = path => {
    if (!remoteScanExtensions.has(extname(path).toLowerCase()) || extname(path).toLowerCase() === ".html") return;
    if (path.startsWith(`${customizeDir}${sep}`) || !path.startsWith(`${publicRoot}${sep}`) || assets.has(path)) return;
    assets.add(path);
    queue.push(path);
  };
  for (const html of htmlFiles) {
    for (const [, ref] of (await readFile(html, "utf8")).matchAll(LOCAL_REF)) consider(join(publicRoot, decodeURIComponent(ref)));
  }
  while (queue.length) {
    const file = queue.shift();
    const source = await readFile(file, "utf8").catch(() => "");
    const ext = extname(file).toLowerCase();
    const pattern = ext === ".css" ? CSS_LOCAL_IMPORT : (ext === ".js" || ext === ".mjs") ? JS_IMPORT : null;
    if (!pattern) continue;
    for (const [, ref] of source.matchAll(pattern)) consider(ref.startsWith("/") ? join(publicRoot, ref) : resolve(dirname(file), ref));
  }
  return [...assets].sort();
}

export async function scanBrowserSecrets(paths) {
  const findings = [];
  for (const input of paths) {
    const path = input instanceof URL ? fileURLToPath(input) : input;
    for (const file of await filesWithin(path)) {
      if (!textExtensions.has(extname(file).toLowerCase())) continue;
      const source = await readFile(file, "utf8");
      for (const secret of forbiddenBrowserSecrets) {
        if (source.includes(secret)) findings.push({ file, secret });
      }
    }
  }
  return findings;
}
