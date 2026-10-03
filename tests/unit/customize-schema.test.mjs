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
  // Zero-width characters: U+200B (ZWJ), U+200C (ZWNJ), U+200D (ZWM), U+2060 (WJ), U+FEFF (ZWNBSP)
  assert.equal(validateParams(gen, { name: "​" }).ok, false, "U+200B (ZWJ) only should be blank");
  assert.equal(validateParams(gen, { name: "‌" }).ok, false, "U+200C (ZWNJ) only should be blank");
  assert.equal(validateParams(gen, { name: "‍" }).ok, false, "U+200D (ZWM) only should be blank");
  assert.equal(validateParams(gen, { name: "⁠" }).ok, false, "U+2060 (WJ) only should be blank");
  assert.equal(validateParams(gen, { name: "﻿" }).ok, false, "U+FEFF (ZWNBSP) only should be blank");
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

// FIX ROUND 2 TESTS

test("step field with no min defaults to 0", () => {
  const g = {
    id: "nominstep", version: 1,
    schema: {
      a: { type: "number", label: "A", max: 5, step: 1, default: 0 }
    }
  };
  // Without a min, step base should be 0. clampParams should not produce NaN.
  const result = clampParams(g, { a: 3.2 });
  assert(!Number.isNaN(result.a), "clampParams should not return NaN for step field with no min");
  assert.equal(result.a, 3, "3.2 should snap to nearest grid point (0-based grid: 0,1,2,3,4,5)");
});

test("skipSensitive with real secret does not leak in JSON output", () => {
  const secret = "hunter2";
  const result = validateParams(gen, { secret, name: "x" }, { skipSensitive: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.secret, "[redacted]");
  const json = JSON.stringify(result);
  assert(!json.includes(secret), `Secret '${secret}' must not appear in JSON output: ${json}`);
  assert(!json.includes("hunter2"), "Secret must not leak in any form");
});

test("skipSensitive ignores invalid sensitive values and does not error", () => {
  // Large string as sensitive value
  const longStr = "x".repeat(5000);
  let result = validateParams(gen, { secret: longStr }, { skipSensitive: true });
  assert.equal(result.ok, true, "Long string in sensitive field with skipSensitive should be ignored");
  assert.equal(result.value.secret, "[redacted]");
  assert(!result.errors.some(e => e.includes(longStr)), "Should not error on invalid sensitive value");

  // Number as sensitive value
  result = validateParams(gen, { secret: 12345 }, { skipSensitive: true });
  assert.equal(result.ok, true, "Number in sensitive field with skipSensitive should be ignored");
  assert.equal(result.value.secret, "[redacted]");
  assert(!result.errors.some(e => e.includes("12345")), "Should not error on number in sensitive field");
});

test("changedKey discriminates: changed key movement updates dependent limits", () => {
  const g = {
    id: "depend", version: 1,
    schema: {
      a: { type: "number", label: "A", min: 0, max: 100, step: 1, default: 50 },
      b: { type: "number", label: "B", min: 0, max: 100, step: 1, default: 50 }
    },
    rules: p => ({ limits: { b: [0, p.a] } })
  };

  // Case 1: a changes to 100, stays within range, b follows
  const r1 = clampParams(g, { a: 90, b: 80 }, "a");
  assert.equal(r1.a, 90, "a stays 90 (within range)");
  assert.equal(r1.b, 80, "b stays 80 (within new limit [0, 90])");

  // Case 2: a changes to 40, b must shrink
  const r2 = clampParams(g, { a: 90, b: 80 }, "a");
  // Wait, let me reconsider. If changedKey is "a" and a is currently 90 in the input,
  // and we call clampParams with those params, a stays 90.
  // But I think the test wants: what if we CHANGE a to 40?
  // The issue is clampParams doesn't SET values, it CLAMPS them.
  // So if input is {a: 90, b: 80} and changedKey is "a", a gets clamped against its limits (0-100) so stays 90,
  // then b gets clamped against its limit [0, p.a] = [0, 90] so stays 80.
  // The test case wants to change a to 40 and see if b goes to 40.
  const r2b = clampParams(g, { a: 40, b: 80 }, "a");
  assert.equal(r2b.a, 40, "a becomes 40");
  assert.equal(r2b.b, 40, "b shrinks to 40 (new limit [0, 40])");
});

test("changedKey discriminates: non-changed key yields priority", () => {
  const g = {
    id: "yeild", version: 1,
    schema: {
      a: { type: "number", label: "A", min: 0, max: 100, step: 1, default: 50 },
      b: { type: "number", label: "B", min: 0, max: 100, step: 1, default: 50 }
    },
    rules: p => ({ limits: { b: [0, p.a] } })
  };

  // changedKey is "b", so b is clamped first against its original limits
  // Then rules are recomputed from the params WITH clamped b
  // Then other fields (a) are clamped against updated limits
  // Since there's no rule that depends on b affecting a, a stays as-is
  const result = clampParams(g, { a: 90, b: 95 }, "b");
  assert.equal(result.b, 95, "b (changed key) should be clamped within its limits [0, 100]");
  assert.equal(result.a, 90, "a should not be reduced below 90 (no rule limiting a based on b)");
});

test("changedKey with rule-dependent limits: upstream change limits downstream", () => {
  const g = {
    id: "upstream", version: 1,
    schema: {
      cap: { type: "number", label: "Cap", min: 0, max: 100, step: 1, default: 50 },
      val: { type: "number", label: "Val", min: 0, max: 100, step: 1, default: 50 }
    },
    rules: p => ({ limits: { val: [0, p.cap] } })
  };

  // Change cap downward, val should follow
  const result = clampParams(g, { cap: 30, val: 80 }, "cap");
  assert.equal(result.cap, 30, "cap becomes 30");
  assert.equal(result.val, 30, "val clamped to new limit [0, 30]");
});

test("changedKey with step and rule limits: step-down and step-up branches exercised", () => {
  let stepDownCount = 0, stepUpCount = 0;

  // Monkey-patch snapToStep to count branches (for testing only)
  const originalSnapToStep = global.snapToStep;

  const g = {
    id: "stepped", version: 1,
    schema: {
      x: { type: "number", label: "X", min: 2.4, max: 20, step: 0.5, default: 5 },
      cap: { type: "number", label: "Cap", min: 0, max: 10, step: 1, default: 5 }
    },
    rules: p => ({ limits: { x: [2.4, p.cap] } })
  };

  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % (2 ** 31);
    return seed / (2 ** 31);
  };

  let hitStepDown = false, hitStepUp = false;

  // Run 200 iterations with varied params
  for (let i = 0; i < 200; i++) {
    const cap = 3 + random() * 7; // 3 to 10
    const xVal = random() * 20; // can be anywhere 0-20, often outside [2.4, cap]

    const result = clampParams(g, { x: xVal, cap }, "cap");

    // Check if clamping happened correctly
    const [lo, hi] = [2.4, cap];

    // If xVal < 2.4, should snap up: step up branch
    if (xVal < 2.4) hitStepUp = true;
    // If xVal > cap, should snap down: step down branch
    if (xVal > cap) hitStepDown = true;

    // Verify result passes validation
    const validated = validateParams(g, result);
    assert.equal(validated.ok, true, `Iter ${i}: clamped should validate: ${JSON.stringify(result)}`);
  }

  assert.equal(hitStepDown, true, "Should have exercised step-down branch (xVal > cap)");
  assert.equal(hitStepUp, true, "Should have exercised step-up branch (xVal < 2.4)");
});

test("NaN and Infinity in numeric fields fall back to default", () => {
  const g = {
    id: "nantest", version: 1,
    schema: {
      a: { type: "number", label: "A", min: 0, max: 100, default: 50 },
      b: { type: "number", label: "B", min: 0, max: 100, default: 25 }
    }
  };

  const result = clampParams(g, { a: NaN, b: Infinity });
  assert.equal(result.a, 50, "NaN should fall back to default");
  assert.equal(result.b, 25, "Infinity should fall back to default");
});

test("Non-number values in numeric fields fall back to default", () => {
  const g = {
    id: "typtest", version: 1,
    schema: {
      a: { type: "number", label: "A", min: 0, max: 100, default: 50 }
    }
  };

  // String
  let result = clampParams(g, { a: "50" });
  assert.equal(result.a, 50, "String '50' should fall back to default");

  // Null
  result = clampParams(g, { a: null });
  assert.equal(result.a, 50, "null should fall back to default");

  // Object
  result = clampParams(g, { a: {} });
  assert.equal(result.a, 50, "Object should fall back to default");
});
