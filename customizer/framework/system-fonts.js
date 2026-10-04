// Fonts installed on the customer's computer, through the Local Font Access API
// (window.queryLocalFonts: Chromium desktop only). The browser asks the customer for
// permission, and only from a click. The font bytes are read here, handed to the build worker
// and never uploaded or stored. Pure of the DOM so it can be tested in Node.
export const MAX_FONT_BYTES = 15 * 1024 * 1024;
export const LIST_LIMIT = 60;

export const INSTALLED_UNSUPPORTED = "This browser can't list installed fonts. Use Chrome or Edge on a computer, or choose \"My own font file\".";
export const INSTALLED_DENIED = "Permission to list installed fonts wasn't given. Allow it in your browser's site settings to use an installed font, or choose \"My own font file\".";
export const INSTALLED_EMPTY = "No installed fonts were found.";
export const INSTALLED_TOO_LARGE = "That font file is too large (over 15 MB).";
export const INSTALLED_UNREADABLE = "That installed font couldn't be read. Try another font, or choose \"My own font file\".";

/** True when this browser can list installed fonts. */
export const installedFontsSupported = (scope = globalThis) => typeof scope?.queryLocalFonts === "function";

/** Installed fonts as sorted, de-duplicated { id, family, label, data } entries (id = PostScript name). */
export async function listInstalledFonts(query = () => globalThis.queryLocalFonts()) {
  let found;
  try {
    found = await query();
  } catch (error) {
    // NotAllowedError / SecurityError: the customer (or a policy) refused.
    throw Object.assign(new Error(INSTALLED_DENIED), { code: "denied", cause: error });
  }
  const seen = new Set();
  const list = [];
  for (const data of found ?? []) {
    const id = String(data?.postscriptName || data?.fullName || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const family = String(data.family || data.fullName || id);
    list.push({ id, family, label: String(data.fullName || `${family} ${data.style ?? ""}`.trim()), data });
  }
  if (!list.length) throw Object.assign(new Error(INSTALLED_EMPTY), { code: "empty" });
  return list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** The entries whose name contains every word of `term`, capped at `limit`; { shown, total }. */
export function filterFonts(list, term = "", limit = LIST_LIMIT) {
  const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length ? list.filter(f => words.every(w => f.label.toLowerCase().includes(w))) : list;
  return { shown: matches.slice(0, limit), total: matches.length };
}

/** Reads one entry's font bytes: { bytes, key, label }. The key identifies it for the worker's parse cache. */
export async function readInstalledFont(entry, { maxBytes = MAX_FONT_BYTES } = {}) {
  let blob;
  try {
    blob = await entry.data.blob();
  } catch (error) {
    throw Object.assign(new Error(INSTALLED_UNREADABLE), { cause: error });
  }
  if (blob.size > maxBytes) throw new Error(INSTALLED_TOO_LARGE);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), key: `system:${entry.id}`, label: entry.label };
}
