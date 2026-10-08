// "Surprise me": re-rolls the look of a model without touching its content or its safety.
// Only appearance and proportion settings move (colors, curated fonts, styles, sizes close to
// where they are now); text, secrets, the customer's own font or image and the QR code are never
// changed, a locked setting stays exactly as it is, and the result is accepted only when it
// passes the same validation the server applies. Pure: no DOM, no storage, no network.
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { FONT_INHERIT, fontNeedsLicense } from "../../public/assets/js/customize/fonts.js";
import { isFieldVisible } from "./form.js";

const ATTEMPTS = 120;
// A size moves at most this share of its allowed range away from where it is.
const NUMBER_BAND = 0.2;

/** Whether the Randomize button may change this field at all (the lock button is offered for the same fields). */
export function isRandomizable(def) {
  if (!def || def.sensitive || def.transient || def.randomize === false || def.locationFont) return false;
  return def.type === "color" || def.type === "bool" || def.type === "number" || def.type === "int" || (def.type === "enum" && enumChoices(def).length > 1);
}

function enumChoices(def) {
  const skip = new Set(def.randomizeExclude ?? []);
  return (def.options ?? []).map(o => o.value).filter(v => !skip.has(v) && v !== FONT_INHERIT && !(def.picker === "font" && fontNeedsLicense(v)));
}

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = n => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

// Each color is independently dark or light with some saturation; the contrast rules a generator
// declares (rules()) reject draws whose colors are too close, and the loop below draws again.
function randomColor(rng) {
  const dark = rng() < 0.5;
  return hsl(Math.floor(rng() * 360), 45 + Math.floor(rng() * 40), dark ? 22 + Math.floor(rng() * 18) : 72 + Math.floor(rng() * 20));
}

function randomNumber(def, current, limits, rng) {
  const [lo0, hi0] = limits ?? [def.min, def.max];
  const lo = Math.max(def.min, lo0), hi = Math.min(def.max, hi0);
  const span = def.max - def.min;
  const center = Number.isFinite(current) ? current : def.default;
  const from = Math.max(lo, center - span * NUMBER_BAND), to = Math.min(hi, center + span * NUMBER_BAND);
  if (!(to > from)) return current;
  const raw = from + rng() * (to - from);
  if (!def.step) return def.type === "int" ? Math.round(raw) : Number(raw.toFixed(2));
  const base = def.min ?? 0;
  return Number((base + Math.round((raw - base) / def.step) * def.step).toFixed(6));
}

/**
 * Returns { ok, params, changed } where `changed` lists the keys that took a new value. When no
 * valid draw is found (every setting locked, or the locks leave no valid combination) `ok` is
 * false and `params` is the unchanged input.
 */
export function randomizeParams(generator, current, { locked = new Set(), rng = Math.random } = {}) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const next = { ...current };
    let colorIndex = 0;
    for (const [key, def] of Object.entries(generator.schema)) {
      if (locked.has(key) || !isRandomizable(def) || !isFieldVisible(def, next)) continue;
      if (def.type === "color") next[key] = randomColor(rng);
      else if (def.type === "bool") next[key] = rng() < 0.5;
      else if (def.type === "enum") next[key] = pick(enumChoices(def), rng);
      else next[key] = randomNumber(def, current[key], generator.rules?.(next).limits?.[key], rng);
      if (generator.onParamChange) Object.assign(next, generator.onParamChange(key, next) ?? {});
    }
    const clamped = clampParams(generator, next);
    // Locked settings win over a derived change (onParamChange, clamping).
    for (const key of locked) if (Object.hasOwn(current, key)) clamped[key] = current[key];
    // A secret is never touched, so it is judged as the server would: withheld.
    if (!validateParams(generator, clamped, { skipSensitive: true }).ok) continue;
    const changed = Object.keys(clamped).filter(k => JSON.stringify(clamped[k]) !== JSON.stringify(current[k]));
    if (changed.length) return { ok: true, params: clamped, changed };
  }
  return { ok: false, params: current, changed: [] };
}

/**
 * Like randomizeParams, but a draw is accepted only when `tryBuild(params)` (async, true when the
 * model builds) agrees: some draws are valid settings that still do not fit (a wide font on a long
 * caption). Gives up after `attempts` draws and returns { ok: false, params: current }.
 */
export async function randomizeUntilBuilds(generator, current, { locked = new Set(), rng = Math.random, tryBuild, attempts = 8, signal } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) break;
    const draw = randomizeParams(generator, current, { locked, rng });
    if (!draw.ok) return draw;
    if (await tryBuild(draw.params)) return { ...draw, tries: i + 1 };
  }
  return { ok: false, params: current, changed: [], tries: attempts };
}
