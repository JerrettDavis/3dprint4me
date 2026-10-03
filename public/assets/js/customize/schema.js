// Parameter schema runtime shared by the browser (form + clamping) and the server (re-validation).
const REDACTED = "[redacted]";
const CONTROL_NONMULTILINE = new RegExp("[\u0000-\u001f\u007f\u0085  ]");
const CONTROL_MULTILINE = new RegExp("[\u0000-\u0009\u000b-\u001f\u007f\u0085  ]");
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EPS = 1e-9;

export const sensitiveKeys = generator => Object.entries(generator.schema).filter(([, d]) => d.sensitive).map(([k]) => k);

const stepBase = def => def.min ?? 0;

const onStep = (v, def) => {
  if (!def.step) return true;
  const base = stepBase(def);
  const n = (v - base) / def.step;
  return Math.abs(n - Math.round(n)) < 1e-6;
};

function checkField(key, def, raw) {
  const label = def.label ?? key;
  switch (def.type) {
    case "number": case "int": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: `${label} must be a number.` };
      if (def.type === "int" && !Number.isInteger(raw)) return { error: `${label} must be a whole number.` };
      if (raw < def.min - EPS || raw > def.max + EPS) return { error: `${label} must be ${def.min}–${def.max}${def.unit ? ` ${def.unit}` : ""}.` };
      if (!onStep(raw, def)) return { error: `${label} must move in steps of ${def.step}.` };
      return { value: raw };
    }
    case "enum": return def.options.some(o => o.value === raw) ? { value: raw } : { error: `${label} has an unsupported value.` };
    case "bool": return typeof raw === "boolean" ? { value: raw } : { error: `${label} must be on or off.` };
    case "color": return typeof raw === "string" && COLOR.test(raw) ? { value: raw.toLowerCase() } : { error: `${label} must be a #rrggbb color.` };
    case "text": {
      if (typeof raw !== "string") return { error: `${label} must be text.` };
      if (raw.length > def.max * 4) return { error: `${label} must be at most ${def.max} characters.` };
      let value;
      if (def.multiline) {
        const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        if (CONTROL_MULTILINE.test(normalized)) return { error: `${label} contains unsupported characters.` };
        value = normalized.split("\n").map(s => s.trim()).join("\n").trim();
      } else {
        if (CONTROL_NONMULTILINE.test(raw)) return { error: `${label} contains unsupported characters.` };
        // preserveWhitespace: the exact characters matter (a Wi-Fi password may start or end with a space).
        value = def.preserveWhitespace ? raw : raw.trim();
      }
      const visibleValue = value.replace(ZERO_WIDTH, "");
      if ([...visibleValue].length > def.max) return { error: `${label} must be at most ${def.max} characters.` };
      // Whitespace alone never satisfies a required field, even when the stored value keeps it.
      if (!visibleValue.trim() && !def.optional) return { error: `${label} is required.` };
      return { value };
    }
    default: return { error: `${label} has an unknown field type.` };
  }
}

// Returns { ok, errors, value, fieldErrors }. `errors` lists every message (form summary);
// `fieldErrors` maps a field key to its first message so the form can show it next to the
// control. rules() may return its own `fieldErrors: { key: message }`; a rule error without
// a key appears only in `errors`.
export function validateParams(generator, input, { skipSensitive = false } = {}) {
  const errors = [];
  const fieldErrors = {};
  const value = {};
  let source = {};
  if (Array.isArray(input)) {
    errors.push("Parameters must be an object.");
  } else if (input && typeof input === "object") {
    source = input;
  }
  for (const key of Object.keys(source)) if (!Object.hasOwn(generator.schema, key)) errors.push(`Unknown parameter "${String(key).slice(0, 40)}".`);
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.sensitive && skipSensitive) { value[key] = REDACTED; continue; }
    const raw = Object.hasOwn(source, key) ? source[key] : def.default;
    const result = checkField(key, def, raw);
    if (result.error) { errors.push(result.error); fieldErrors[key] ??= result.error; } else value[key] = result.value;
  }
  if (!errors.length && generator.rules) {
    const ruled = generator.rules(value) ?? {};
    errors.push(...(ruled.errors ?? []));
    for (const [key, message] of Object.entries(ruled.fieldErrors ?? {})) {
      if (Object.hasOwn(generator.schema, key) && typeof message === "string") fieldErrors[key] ??= message;
    }
  }
  return { ok: errors.length === 0, errors, value, fieldErrors };
}

export function redactSensitive(generator, params) {
  const out = { ...params };
  for (const key of sensitiveKeys(generator)) if (Object.hasOwn(out, key)) out[key] = REDACTED;
  return out;
}

const snapToStep = (v, def, lo, hi) => {
  if (!def.step) return Math.min(hi, Math.max(lo, v));
  const base = stepBase(def);
  const n = (v - base) / def.step;
  let snapped = base + Math.round(n) * def.step;
  if (snapped > hi + EPS) {
    snapped = base + Math.floor((hi - base) / def.step + 1e-6) * def.step;
  } else if (snapped < lo - EPS) {
    snapped = base + Math.ceil((lo - base) / def.step - 1e-6) * def.step;
  }
  if (snapped < lo - EPS) return lo;
  if (snapped > hi + EPS) return hi;
  return Number(snapped.toFixed(6));
};

// generator.onParamChange(changedKey, params) may return values derived from a committed edit
// (e.g. a format's own defaults when the format changes). It runs only for that edit.
export function clampParams(generator, params, changedKey) {
  const out = { ...params };
  if (changedKey && generator.onParamChange) Object.assign(out, generator.onParamChange(changedKey, out) ?? {});
  const initialLimits = generator.rules?.(out).limits ?? {};

  if (changedKey) {
    const def = generator.schema[changedKey];
    if (def && (def.type === "number" || def.type === "int")) {
      const v = out[changedKey];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out[changedKey] = def.default;
      } else {
        // Clamp changedKey against field's own limits, not rule limits
        const [lo, hi] = [def.min ?? -Infinity, def.max ?? +Infinity];
        out[changedKey] = snapToStep(v, def, lo, hi);
      }
    }
    const updatedLimits = generator.rules?.(out).limits ?? {};
    for (const [key, def] of Object.entries(generator.schema)) {
      if (key === changedKey) continue;
      if (def.type !== "number" && def.type !== "int") continue;
      const v = out[key];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out[key] = def.default;
      } else {
        const [lo, hi] = updatedLimits[key] ?? [def.min ?? -Infinity, def.max ?? +Infinity];
        out[key] = snapToStep(v, def, lo, hi);
      }
    }
  } else {
    for (const [key, def] of Object.entries(generator.schema)) {
      if (def.type !== "number" && def.type !== "int") continue;
      const v = out[key];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        out[key] = def.default;
      } else {
        const [lo, hi] = initialLimits[key] ?? [def.min ?? -Infinity, def.max ?? +Infinity];
        out[key] = snapToStep(v, def, lo, hi);
      }
    }
  }
  return out;
}
