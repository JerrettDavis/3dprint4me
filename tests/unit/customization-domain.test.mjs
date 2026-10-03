import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import { normalizeProjectRequest } from "../../lib/validation.js";

const base = { projectTitle: "Tag", service: "print", description: "Print it", modelUrl: "https://example.com/a.stl", contact: { name: "T", email: "t@example.com" }, consent: true };

// Test-only generator double with a sensitive field. It is injected through the resolver seam
// and never added to the real registry.
const secretTag = {
  id: "secret-tag",
  version: 2,
  schema: {
    ssid: { type: "text", label: "Network name", default: "Home", max: 32 },
    password: { type: "text", label: "Password", default: "", max: 63, optional: true, sensitive: true }
  }
};
const withDouble = { getGenerator: id => (id === secretTag.id ? secretTag : undefined) };

test("absent customization is null", () => {
  assert.equal(normalizeCustomization(undefined), null);
  assert.equal(normalizeCustomization(null), null);
});

test("a valid route-shield customization is accepted and pinned to a known version", () => {
  const out = normalizeCustomization({ generatorId: "route-shield", generatorVersion: 1, params: { top_text: "ROUTE" } });
  assert.equal(out.generatorId, "route-shield");
  assert.equal(out.generatorVersion, 1);
  assert.equal(out.params.top_text, "ROUTE");
  assert.deepEqual(out.redacted, []);
});

test("unknown generators, future versions and bad params are rejected with 400", () => {
  for (const bad of [
    { generatorId: "nope", generatorVersion: 1, params: {} },
    { generatorId: "toString", generatorVersion: 1, params: {} },
    { generatorId: "__proto__", generatorVersion: 1, params: {} },
    { generatorId: "route-shield", generatorVersion: 99, params: {} },
    { generatorId: "route-shield", generatorVersion: 0, params: {} },
    { generatorId: "route-shield", generatorVersion: "1", params: {} },
    { generatorId: "route-shield", generatorVersion: 1.5, params: {} },
    { generatorId: "route-shield", generatorVersion: 1, params: { width_mm: 9999 } },
    { generatorId: "route-shield", generatorVersion: 1, params: { __proto__: 1, toString: 1 } },
    { generatorId: "route-shield", generatorVersion: 1, params: "top_text" },
    { generatorId: "route-shield", generatorVersion: 1, params: ["ROUTE"] },
    { generatorId: "route-shield", generatorVersion: 1, params: 7 },
    "route-shield", 7, [], true
  ]) assert.throws(() => normalizeCustomization(bad), err => err.status === 400, JSON.stringify(bad));
});

test("a JSON __proto__ parameter key is an unknown parameter, not a prototype change", () => {
  const input = JSON.parse('{"generatorId":"route-shield","generatorVersion":1,"params":{"__proto__":{"top_text":"X"}}}');
  assert.throws(() => normalizeCustomization(input), err => err.status === 400);
  assert.equal({}.top_text, undefined);
});

test("oversized parameter payloads are rejected", () => {
  assert.throws(() => normalizeCustomization({ generatorId: "route-shield", generatorVersion: 1, params: { back_text: "x".repeat(20000) } }), err => err.status === 400);
});

test("the output keeps only the normalized provenance fields", () => {
  const out = normalizeCustomization({ generatorId: "route-shield", generatorVersion: 1, params: {}, extra: "<script>", generatorTitle: "Spoofed" });
  assert.deepEqual(Object.keys(out).sort(), ["generatorId", "generatorVersion", "params", "redacted"]);
});

test("sensitive values are withheld on the server even when the browser sends them", () => {
  const out = normalizeCustomization({ generatorId: "secret-tag", generatorVersion: 2, params: { ssid: "Cafe", password: "hunter2" } }, withDouble);
  assert.equal(out.params.ssid, "Cafe");
  assert.equal(out.params.password, "[redacted]");
  assert.deepEqual(out.redacted, ["password"]);
  assert.equal(JSON.stringify(out).includes("hunter2"), false);
});

test("a browser-redacted sensitive value is accepted without re-validating the secret", () => {
  const out = normalizeCustomization({ generatorId: "secret-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "[redacted]" } }, withDouble);
  assert.equal(out.params.password, "[redacted]");
  assert.equal(out.generatorVersion, 1);
});

test("the injected resolver does not leak the double into the real registry", () => {
  assert.throws(() => normalizeCustomization({ generatorId: "secret-tag", generatorVersion: 1, params: {} }), err => err.status === 400);
});

test("the request normalizer carries the customization through", () => {
  const r = normalizeProjectRequest({ ...base, customization: { generatorId: "route-shield", generatorVersion: 1, params: {} } });
  assert.equal(r.customization.generatorId, "route-shield");
  assert.equal(normalizeProjectRequest(base).customization, null);
});

test("the request normalizer rejects an invalid customization with 400", () => {
  assert.throws(() => normalizeProjectRequest({ ...base, customization: { generatorId: "nope", generatorVersion: 1, params: {} } }), err => err.status === 400);
});

test("customization is print provenance only; other services never carry it", () => {
  const r = normalizeProjectRequest({ ...base, service: "design", customization: { generatorId: "route-shield", generatorVersion: 1, params: {} } });
  assert.equal(r.customization, null);
});

test("the real wifi-tag generator withholds its password and keeps everything else", () => {
  const out = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2", security: "WEP", format: "keychain" } });
  assert.equal(out.params.ssid, "Cafe");
  assert.equal(out.params.format, "keychain");
  assert.equal(out.params.password, "[redacted]");
  assert.deepEqual(out.redacted, ["password"]);
  assert.equal(JSON.stringify(out).includes("hunter2"), false);
  // An invalid secret is never even looked at on the server: it is replaced, not validated.
  const odd = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "x".repeat(500) } });
  assert.equal(odd.params.password, "[redacted]");
});

test("wifi-tag provenance is still re-validated: a low-contrast QR is rejected with 400", () => {
  assert.throws(() => normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2", base_color: "#ffffff", qr_color: "#eeeeee" } }), err => err.status === 400 && !err.message.includes("hunter2"));
});
