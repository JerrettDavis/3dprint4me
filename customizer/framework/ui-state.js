// Per-user layout preferences for the generator pages (panel collapsed state, the Settings
// grouping mode, collapsed groups). localStorage only, always wrapped: a private window or
// blocked storage just means defaults. Nothing here is ever sent anywhere, and no parameter
// values are stored (those live in the sessionStorage draft, minus sensitive fields).
const KEY = "3dp-customize:ui:v1";

function read() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** The stored preferences object (never throws; {} when unavailable). */
export const loadUi = () => read();

/** Merges `patch` (shallow, one level deep for plain objects) into the stored preferences. */
export function saveUi(patch) {
  try {
    const current = read();
    for (const [key, value] of Object.entries(patch)) {
      current[key] = value && typeof value === "object" && !Array.isArray(value) && current[key] && typeof current[key] === "object" ? { ...current[key], ...value } : value;
    }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch { /* A layout preference is a convenience only. */ }
}
