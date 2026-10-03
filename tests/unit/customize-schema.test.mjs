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
  const secret = "hunter2";
  const redacted = redactSensitive(gen, { secret, name: "x" });
  assert.equal(redacted.secret, "[redacted]");
  // Verify secret appears nowhere in output
  const jsonStr = JSON.stringify(redacted);
  assert(!jsonStr.includes(secret), `Secret '${secret}' should not appear in redacted output`);
  assert.equal(redactSensitive(gen, { name: "x" }).secret, undefined);
  const r = validateParams(gen, { secret: "[redacted]" }, { skipSensitive: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.secret, "[redacted]");
});

test("clampParams pulls values into range using rule limits", () => {
  const g = { ...gen, rules: p => ({ limits: { width: [10, p.count * 10] } }) };
  assert.equal(clampParams(g, { width: 90, count: 3 }, "count").width, 30);
});

// NEW TESTS FOR DEFECT FIXES

test("array input produces error message", () => {
  const r = validateParams(gen, [1, 2, 3]);
  assert.equal(r.ok, false);
  assert(r.errors.some(e => e.includes("object")), "Should mention 'object' in error");
});

test("code-point counting discriminates from UTF-16 units", () => {
  // 🚽 is 1 code point but 2 UTF-16 units
  const emoji = "🚽";
  assert.equal([...emoji].length, 1, "Should be 1 code point");
  assert.equal(emoji.length, 2, "Should be 2 UTF-16 units");
  // 7 emoji = 7 code points, max is 12, should pass
  assert.equal(validateParams(gen, { name: emoji.repeat(7) }).ok, true);
  // 13 emoji = 13 code points, max is 12, should fail
  assert.equal(validateParams(gen, { name: emoji.repeat(13) }).ok, false);
});

test("control chars rejected in non-multiline text", () => {
  // Tab, newline, carriage return should all be rejected in non-multiline
  assert.equal(validateParams(gen, { name: "a\tb" }).ok, false, "Tab should be rejected");
  assert.equal(validateParams(gen, { name: "a\nb" }).ok, false, "Newline should be rejected");
  assert.equal(validateParams(gen, { name: "a\rb" }).ok, false, "Carriage return should be rejected");
  assert.equal(validateParams(gen, { name: "a\u0085b" }).ok, false, "U+0085 should be rejected");
  assert.equal(validateParams(gen, { name: "a b" }).ok, false, "U+2028 should be rejected");
  assert.equal(validateParams(gen, { name: "a b" }).ok, false, "U+2029 should be rejected");
});

test("multiline text allows newlines but rejects tab and other controls", () => {
  const genMultiline = { ...gen, schema: { ...gen.schema, name: { ...gen.schema.name, multiline: true } } };
  // Newline should be allowed
  assert.equal(validateParams(genMultiline, { name: "a\nb" }).ok, true, "Newline should be allowed in multiline");
  // CRLF should be normalized and allowed
  assert.equal(validateParams(genMultiline, { name: "a\r\nb" }).ok, true, "CRLF should be allowed in multiline");
  // Tab should be rejected
  assert.equal(validateParams(genMultiline, { name: "a\tb" }).ok, false, "Tab should be rejected in multiline");
  // Other controls should be rejected
  assert.equal(validateParams(genMultiline, { name: "a\u0085b" }).ok, false, "U+0085 should be rejected in multiline");
});

test("zero-width characters only treated as blank", () => {
  // Zero-width characters: U+200B-U+200D, U+2060, U+FEFF
  assert.equal(validateParams(gen, { name: "​" }).ok, false, "ZWJ only should be blank");
  assert.equal(validateParams(gen, { name: "‌" }).ok, false, "ZWNJ only should be blank");
  assert.equal(validateParams(gen, { name: "‍" }).ok, false, "ZWM only should be blank");
  assert.equal(validateParams(gen, { name: "⁠" }).ok, false, "Word joiner only should be blank");
  assert.equal(validateParams(gen, { name: "﻿" }).ok, false, "BOM only should be blank");
  // But visible char with zero-width should work
  assert.equal(validateParams(gen, { name: "a​" }).ok, true, "Visible char with ZW should pass");
});

test("rules() not invoked when field error exists", () => {
  let rulesCalled = false;
  const g = {
    ...gen,
    rules: p => { rulesCalled = true; return { errors: [] }; }
  };
  // Call with invalid width (out of range)
  rulesCalled = false;
  validateParams(g, { width: 200 });
  assert.equal(rulesCalled, false, "rules() should not be called when field validation fails");

  // Call with valid params
  rulesCalled = false;
  validateParams(g, { width: 50 });
  assert.equal(rulesCalled, true, "rules() should be called when all fields are valid");
});

test("step validation with fractional min", () => {
  const g = {
    id: "step-test", version: 1,
    schema: {
      val: { type: "number", label: "V", min: 2.4, max: 10, step: 0.5, default: 2.4 }
    }
  };
  // 2.9 = 2.4 + 0.5 (one step), should be valid
  assert.equal(validateParams(g, { val: 2.9 }).ok, true, "2.9 should be on step (2.4 + 1*0.5)");
  // 2.5 = 2.4 + 0.1, off-step, should be invalid
  assert.equal(validateParams(g, { val: 2.5 }).ok, false, "2.5 should be off-step");
  // 3.4 = 2.4 + 2*0.5, should be valid
  assert.equal(validateParams(g, { val: 3.4 }).ok, true, "3.4 should be on step (2.4 + 2*0.5)");
});

test("changedKey clamps first and shrinks dependent values", () => {
  const g = {
    id: "t", version: 1,
    schema: {
      count: { type: "int", label: "N", min: 1, max: 10, default: 5 },
      width: { type: "number", label: "W", min: 10, max: 100, step: 1, default: 50 }
    },
    rules: p => ({ limits: { width: [10, p.count * 10] } })
  };
  // When count is the changedKey and equals 3, width limit becomes [10, 30]
  // width: 90 gets clamped to 30
  const result = clampParams(g, { count: 3, width: 90 }, "count");
  assert.equal(result.count, 3, "changedKey stays as-is when within range");
  assert.equal(result.width, 30, "Width should clamp to count*10 = 30");
});

test("changedKey keeps value while others yield", () => {
  const g = {
    id: "t", version: 1,
    schema: {
      a: { type: "number", label: "A", min: 0, max: 100, step: 1, default: 50 },
      b: { type: "number", label: "B", min: 0, max: 100, step: 1, default: 50 }
    },
    rules: p => {
      // If a > 80, b is limited to 20
      return { limits: { b: p.a > 80 ? [0, 20] : [0, 100] } };
    }
  };
  // If a is changedKey and stays at 90, and b is 100 (exceeds limit), b should be clamped
  const result = clampParams(g, { a: 90, b: 100 }, "a");
  assert.equal(result.a, 90, "Changed key 'a' should keep its value");
  assert.equal(result.b, 20, "Other key 'b' should be clamped to rule limit");
});

test("clampParams output passes validateParams checks (invariant test)", () => {
  const g = {
    id: "inv", version: 1,
    schema: {
      x: { type: "number", label: "X", min: 2.4, max: 20, step: 0.5, default: 5 },
      y: { type: "int", label: "Y", min: 1, max: 10, default: 5 },
      z: { type: "number", label: "Z", min: 0, max: 100, default: 50 }
    },
    rules: p => ({ limits: { z: [0, p.y * 10] } })
  };

  // Seed a simple PRNG for reproducibility
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % (2 ** 31);
    return seed / (2 ** 31);
  };

  // 200+ iterations with random params
  for (let i = 0; i < 250; i++) {
    const params = {
      x: 2.4 + random() * 17.6,  // 2.4 to 20
      y: 1 + Math.floor(random() * 10),  // 1 to 10
      z: random() * 100  // 0 to 100
    };

    const clamped = clampParams(g, params);
    const validated = validateParams(g, clamped);
    assert.equal(validated.ok, true, `Iteration ${i}: clamped params should pass validation: ${JSON.stringify(clamped)}`);
  }
});
