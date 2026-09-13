import assert from "node:assert/strict";
import test from "node:test";
import { smokeLive } from "../../scripts/smoke-live.mjs";

function siteResponse(url, { missingEmail = false, publicSource = false } = {}) {
  const path = new URL(url).pathname;
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'self'",
    "strict-transport-security": "max-age=31536000",
    "cache-control": "no-store",
    "content-type": path === "/api/health" ? "application/json" : "text/html"
  };
  const privatePath = ["/.env", "/lib/notifications.js", "/data/dev-requests.ndjson"].includes(path);
  const status = privatePath && !publicSource ? 404 : 200;
  const body = path === "/api/health"
    ? JSON.stringify({ ok: true, service: "3dprint4.me", integrations: { supabase: true, email: !missingEmail } })
    : "<main>3dprint4.me</main>";
  const response = new Response(body, { status, headers });
  Object.defineProperty(response, "url", { value: String(url) });
  return response;
}

test("live smoke accepts a deployed site with private source paths and configured intake", async () => {
  const result = await smokeLive("https://3dprint4.me", { fetchImpl: url => siteResponse(url) });
  assert.equal(result.checked.length, 15);
  assert.deepEqual(result.failures, []);
});

test("live smoke fails on missing email intake and publicly exposed source", async () => {
  const result = await smokeLive("https://3dprint4.me", {
    fetchImpl: url => siteResponse(url, { missingEmail: true, publicSource: true })
  });
  assert.ok(result.failures.some(failure => failure.includes("email is not configured")));
  assert.ok(result.failures.some(failure => failure.includes("private source path returned HTTP 200")));
});
