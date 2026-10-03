import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GLOBAL_CSP, CUSTOMIZE_CSP, customizeCsp } from "../../scripts/csp.mjs";

const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const rule = source => vercel.headers.find(r => r.source === source);
const header = (r, key) => r?.headers.find(h => h.key === key)?.value;
const cspFor = source => header(rule(source), "Content-Security-Policy");
const GLOBAL_SOURCE = "/((?!customize/).*)";

test("the global CSP rule excludes /customize and keeps the strict policy", () => {
  const global = rule(GLOBAL_SOURCE);
  assert.ok(global, "global header rule must exclude customize/");
  const csp = header(global, "Content-Security-Policy");
  assert.ok(!csp.includes("wasm-unsafe-eval"));
  assert.ok(!csp.includes("worker-src"));
  assert.match(csp, /font-src 'self'/);
});

test("/customize/* gets its own full policy with wasm and blob workers only", () => {
  const csp = cspFor("/customize/(.*)");
  assert.ok(csp, "customize rule needs its own CSP");
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.ok(!/googleapis|gstatic|(?<!wasm-)unsafe-eval/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);
});

test("the customize rule carries the same non-CSP headers as the global rule", () => {
  const strip = r => r.headers.filter(h => h.key !== "Content-Security-Policy");
  assert.deepEqual(strip(rule("/customize/(.*)")), strip(rule(GLOBAL_SOURCE)));
});

test("scripts/csp.mjs constants equal the vercel.json policies (no drift)", () => {
  assert.equal(GLOBAL_CSP, cspFor(GLOBAL_SOURCE));
  assert.equal(CUSTOMIZE_CSP, cspFor("/customize/(.*)"));
  assert.equal(customizeCsp(), CUSTOMIZE_CSP);
});

test("Vite hashed assets are cached immutably", () => {
  assert.match(header(rule("/customize/assets/(.*)"), "Cache-Control"), /public, max-age=31536000, immutable/);
});

test("the serverless bundle includes the isomorphic customize modules", () => {
  const include = vercel.functions["api/*.js"].includeFiles;
  // Single plain glob (no brace expansion) covering print-estimation and customize.
  assert.ok(!/[{}]/.test(include), "avoid brace globs; Vercel includeFiles takes one glob");
  assert.equal(include, "public/assets/js/**");
});

test("/customize without a trailing slash redirects permanently to /customize/ (never the global CSP)", () => {
  assert.deepEqual(vercel.redirects, [{ source: "/customize", destination: "/customize/", permanent: true }]);
  assert.equal(vercel.routes, undefined, "Vercel rejects `redirects` alongside legacy `routes`");
});

test("the dev server mirrors the /customize redirect", async () => {
  const source = await readFile(new URL("../../scripts/dev-server.mjs", import.meta.url), "utf8");
  assert.match(source, /url\.pathname === "\/customize"/);
  assert.match(source, /308/);
});
