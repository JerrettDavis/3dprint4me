import assert from "node:assert/strict";
import test from "node:test";
import { clampParams, redactSensitive, sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

const gen = {
  id: "t", version: 1,
  schema: {
    width: { type: "number", label: "W", min: 10, max: 100, step: 0.5, default: 50 },
    count: { type: "int", label: "N", min: 1, max: 5, default: 2 },
    mode: { type: "enum", label: "M", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
    on: { type: "bool", label: "On", default: false },
    name: { type: "text", label: "Name", max: 12, default: "Hi" },
    secret: { type: "text", label: "Pw", max: 20, default: "", sensitive: true, optional: true },
    color: { type: "color", label: "C", default: "#112233" }
  },
  rules: p => ({ errors: p.width > 90 && p.count > 3 ? ["Too wide for that many."] : [] })
};

test("defaults fill missing fields", () => {
  const r = validateParams(gen, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { width: 50, count: 2, mode: "a", on: false, name: "Hi", secret: "", color: "#112233" });
});

test("rejects unknown keys, bad enums, out-of-range numbers and bad colors", () => {
  const r = validateParams(gen, { width: 5, mode: "z", color: "red", extra: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
});

test("text is trimmed, bounded, and control characters are rejected", () => {
  assert.equal(validateParams(gen, { name: "x".repeat(13) }).ok, false);
  assert.equal(validateParams(gen, { name: "a\u0000b" }).ok, false);
  assert.equal(validateParams(gen, { name: "  Hi  " }).value.name, "Hi");
  assert.equal(validateParams(gen, { name: "日本語 🚽" }).ok, true);
  assert.equal(validateParams(gen, { name: "   " }).ok, false);   // required text may not be blank
});

test("numbers must be finite and respect step", () => {
  assert.equal(validateParams(gen, { width: NaN }).ok, false);
  assert.equal(validateParams(gen, { width: "50" }).ok, false);   // no string coercion server-side
  assert.equal(validateParams(gen, { width: 50.3 }).ok, false);
});

test("cross-field rules run after field checks", () => {
  assert.deepEqual(validateParams(gen, { width: 95, count: 4 }).errors, ["Too wide for that many."]);
});

test("sensitive fields are listed, redacted, and skippable on the server", () => {
  assert.deepEqual(sensitiveKeys(gen), ["secret"]);
  assert.equal(redactSensitive(gen, { secret: "hunter2", name: "x" }).secret, "[redacted]");
  assert.equal(redactSensitive(gen, { name: "x" }).secret, undefined);
  const r = validateParams(gen, { secret: "[redacted]" }, { skipSensitive: true });
  assert.equal(r.ok, true);
});

test("clampParams pulls values into range using rule limits", () => {
  const g = { ...gen, rules: p => ({ limits: { width: [10, p.count * 10] } }) };
  assert.equal(clampParams(g, { width: 90, count: 3 }, "count").width, 30);
});
