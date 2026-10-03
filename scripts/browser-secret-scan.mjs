import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
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

const isAllowedUrl = url => allowedUrlStrings.includes(url) || sameOriginPrefixes.some(prefix => url.startsWith(prefix));
// A sink argument is local when it is relative, same-origin absolute, data: or blob:.
function isRemoteSinkTarget(target) {
  const value = target.trim();
  if (/^(?:data|blob):/i.test(value)) return false;
  if (value.startsWith("//")) return true;                     // protocol-relative: another host
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return !isAllowedUrl(value);
  return false;
}

/** Remote URLs and remote request call sites in served text under `paths`: [{ file, url, reason }]. */
export async function scanRemoteRequests(paths) {
  const findings = [];
  for (const input of paths) {
    const path = input instanceof URL ? fileURLToPath(input) : input;
    for (const file of await filesWithin(path)) {
      if (!remoteScanExtensions.has(extname(file).toLowerCase())) continue;
      const source = await readFile(file, "utf8");
      const seen = new Set();
      const add = (url, reason) => { if (!seen.has(url)) { seen.add(url); findings.push({ file, url, reason }); } };
      for (const [url] of source.matchAll(ABSOLUTE_URL)) if (!isAllowedUrl(url)) add(url, "remote URL literal");
      for (const pattern of [SINK_CALL, XHR_OPEN]) {
        for (const match of source.matchAll(pattern)) if (isRemoteSinkTarget(match[2])) add(match[2], "remote request");
      }
    }
  }
  return findings;
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
