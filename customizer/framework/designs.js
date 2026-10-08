// Ready-made designs: a generator lists them as `designs: [{ id, label, blurb, group?, params }]`
// (partial parameter sets over the schema defaults). Choosing one replaces the look and the
// sample text; it never carries or removes a secret (a Wi-Fi password stays as typed).
import { clampParams, sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

export const designsOf = generator => generator.designs ?? [];

/** The groups in first-seen order, each { label, designs }; an ungrouped design goes under "Designs". */
export function designGroups(generator) {
  const groups = new Map();
  for (const d of designsOf(generator)) {
    const label = d.group ?? "Designs";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(d);
  }
  return [...groups].map(([label, designs]) => ({ label, designs }));
}

/**
 * The parameters after choosing `design`: schema defaults, then the design, then clamped. Sensitive
 * values are kept from `current`. Returns null when the result would not validate (a broken design).
 */
export function applyDesign(generator, design, current = {}) {
  const defaults = validateParams(generator, {}).value;
  const merged = { ...defaults, ...design.params };
  for (const key of sensitiveKeys(generator)) if (Object.hasOwn(current, key)) merged[key] = current[key];
  const clamped = clampParams(generator, merged);
  // Judged as the server would with the secret withheld: a design never needs one.
  return validateParams(generator, clamped, { skipSensitive: true }).ok ? clamped : null;
}

/** Up to five distinct colors of a design, for its card swatch. */
export function designSwatches(generator, design) {
  const params = applyDesign(generator, design) ?? {};
  const seen = [];
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.type === "color" && typeof params[key] === "string" && !seen.includes(params[key])) seen.push(params[key]);
  }
  return seen.slice(0, 5);
}
