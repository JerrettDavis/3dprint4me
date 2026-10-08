// Sections: which part of the model a setting belongs to. Pure and isomorphic.
//
// A definition may export
//   sections: { key: "Label", ... }                 ORDERED; the Settings panel's "Section" grouping
//   focus:    [{ part: "<name or prefix>", section: "<key>" }, ...]
// and every schema field may carry `section` (a key of `sections`). Fields without one go to
// "General". `group` stays the CATEGORY (text, size, colors...). All of it is optional.
export const GENERAL = "general";
export const GENERAL_LABEL = "General";

const titleCase = key => String(key).replace(/[-_]+/g, " ").replace(/^./, c => c.toUpperCase());
const plain = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

/** The section a field belongs to: its `section`, else "general". */
export const fieldSection = def => (typeof def?.section === "string" && def.section ? def.section : GENERAL);

/** True when at least one field names a section (otherwise the Section grouping adds nothing). */
export const hasSections = generator => Object.values(generator?.schema ?? {}).some(def => typeof def?.section === "string" && def.section);

/**
 * Ordered [{ key, label }] for the sections in use: declared ones first, in declared order
 * (only those that have fields or parts), then any section key a field uses that was not
 * declared (title-cased), then "General" last unless `sections` places it (a `general` key).
 */
export function sectionList(generator) {
  const declared = plain(generator?.sections);
  const used = new Set(Object.values(generator?.schema ?? {}).map(fieldSection));
  for (const entry of generator?.focus ?? []) if (entry?.section) used.add(entry.section);
  const list = [];
  const seen = new Set();
  for (const [key, label] of Object.entries(declared)) {
    if (!used.has(key) && key !== GENERAL) continue;
    if (key === GENERAL && !used.has(GENERAL)) continue;
    list.push({ key, label: String(label) });
    seen.add(key);
  }
  for (const key of used) {
    if (seen.has(key) || key === GENERAL) continue;
    list.push({ key, label: titleCase(key) });
    seen.add(key);
  }
  if (used.has(GENERAL) && !seen.has(GENERAL)) list.push({ key: GENERAL, label: GENERAL_LABEL });
  return list;
}

export const sectionLabel = (generator, key) => sectionList(generator).find(s => s.key === key)?.label ?? (key === GENERAL ? GENERAL_LABEL : titleCase(key));

/**
 * The section a built part belongs to, or null. `focus` entries match a part whose name equals
 * `part` or starts with it; an exact match beats a prefix, and a longer prefix beats a shorter
 * one (ties: first listed).
 */
export function partSection(generator, name) {
  const text = String(name ?? "");
  let best = null;
  let bestScore = -1;
  for (const entry of generator?.focus ?? []) {
    if (!entry || typeof entry.part !== "string" || !entry.part || !entry.section) continue;
    const score = text === entry.part ? Infinity : text.startsWith(entry.part) ? entry.part.length : -1;
    if (score > bestScore) { best = entry.section; bestScore = score; }
  }
  return best;
}

/** Names from `names` that belong to `section`. */
export const partsOfSection = (generator, names, section) => names.filter(name => partSection(generator, name) === section);
