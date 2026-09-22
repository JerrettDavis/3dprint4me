import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../operator/sw.js", import.meta.url), "utf8");

test("operator service worker caches only its shell and keeps APIs network-only", () => {
  assert.match(source, /SHELL_ASSETS/);
  assert.match(source, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /event\.respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(source, /localStorage|indexedDB|customer|projectTitle/);
});

test("operator Push UI is generic and click navigation accepts only an opaque work route", () => {
  assert.match(source, /New 3dprint4\.me work request/);
  assert.match(source, /Open the work inbox to review it\./);
  assert.equal(source.includes("/^\\/work\\/[A-Za-z0-9_-]{8,128}$/"), true);
  assert.match(source, /clients\.openWindow/);
});
