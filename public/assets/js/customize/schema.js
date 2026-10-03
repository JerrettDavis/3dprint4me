// Parameter schema runtime shared by the browser (form + clamping) and the server (re-validation).
const REDACTED = "[redacted]";
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EPS = 1e-9;

export const sensitiveKeys = generator => Object.entries(generator.schema).filter(([, d]) => d.sensitive).map(([k]) => k);

const onStep = (v, def) => {
  if (!def.step) return true;
  const base = def.min ?? 0;
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
      if (CONTROL.test(raw)) return { error: `${label} contains unsupported characters.` };
      const value = def.multiline ? raw.replace(/\r\n/g, "\n").split("\n").map(s => s.trim()).join("\n").trim() : raw.trim();
      if ([...value].length > def.max) return { error: `${label} must be at most ${def.max} characters.` };
      if (!value && !def.optional) return { error: `${label} is required.` };
      return { value };
    }
    default: return { error: `${label} has an unknown field type.` };
  }
}

export function validateParams(generator, input, { skipSensitive = false } = {}) {
  const errors = [];
  const value = {};
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const key of Object.keys(source)) if (!(key in generator.schema)) errors.push(`Unknown parameter "${String(key).slice(0, 40)}".`);
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.sensitive && skipSensitive) { value[key] = REDACTED; continue; }
    const raw = key in source ? source[key] : def.default;
    const result = checkField(key, def, raw);
    if (result.error) errors.push(result.error); else value[key] = result.value;
  }
  if (!errors.length && generator.rules) errors.push(...(generator.rules(value).errors ?? []));
  return { ok: errors.length === 0, errors, value };
}

export function redactSensitive(generator, params) {
  const out = { ...params };
  for (const key of sensitiveKeys(generator)) if (key in out) out[key] = REDACTED;
  return out;
}

const round = (v, step) => step ? Math.round(v / step) * step : v;

// Pull every numeric value into its (possibly rule-dependent) range; the just-changed key wins.
export function clampParams(generator, params, changedKey) {
  const out = { ...params };
  const limits = generator.rules?.(out).limits ?? {};
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.type !== "number" && def.type !== "int") continue;
    const [lo, hi] = limits[key] ?? [def.min, def.max];
    if (key === changedKey) { out[key] = Math.min(hi, Math.max(lo, out[key])); continue; }
    out[key] = Math.min(hi, Math.max(lo, out[key]));
  }
  for (const [key, def] of Object.entries(generator.schema)) {
    if ((def.type === "number" || def.type === "int") && def.step) out[key] = Number(round(out[key], def.step).toFixed(6));
  }
  return out;
}
