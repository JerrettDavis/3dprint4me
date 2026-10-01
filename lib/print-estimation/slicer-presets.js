// Flattens Bambu Studio / OrcaSlicer preset JSON. Vendor presets (and user presets
// exported from either app) only store overrides plus an `inherits` parent name and
// optional `include` templates; the headless CLI applies a loaded file as-is, so every
// key must be resolved before slicing. Resolution order: parent chain, then includes,
// then the preset's own keys (child wins).
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const PRESET_TYPES = new Set(["machine", "process", "filament"]);
const META_KEYS = new Set(["inherits", "include", "instantiation"]);

async function* jsonFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) yield path;
  }
}

/**
 * Indexes every machine/process/filament preset under a slicer `resources/profiles`
 * directory by vendor, type, and name.
 */
export async function indexVendorPresets(profilesRoot) {
  const index = new Map();
  for await (const path of jsonFiles(profilesRoot)) {
    const parts = relative(profilesRoot, path).split(sep);
    if (parts.length < 3 || !PRESET_TYPES.has(parts[1])) continue;
    let preset;
    try { preset = JSON.parse(await readFile(path, "utf8")); } catch { continue; }
    if (!preset || typeof preset.name !== "string") continue;
    const type = PRESET_TYPES.has(preset.type) ? preset.type : parts[1];
    index.set(`${parts[0]}\u0000${type}\u0000${preset.name}`, { vendor: parts[0], type, preset });
  }
  return index;
}

function lookup(index, type, name, vendor) {
  const local = index.get(`${vendor}\u0000${type}\u0000${name}`);
  if (local) return local;
  for (const entry of index.values()) if (entry.type === type && entry.preset.name === name) return entry;
  return null;
}

function resolveEntry(index, preset, type, vendor, chain) {
  if (chain.includes(preset.name)) throw new Error(`Preset inheritance cycle: ${[...chain, preset.name].join(" -> ")}`);
  const nextChain = [...chain, preset.name];
  let merged = {};
  if (preset.inherits) {
    const parent = lookup(index, type, preset.inherits, vendor);
    if (!parent) throw new Error(`Parent ${type} preset "${preset.inherits}" was not found.`);
    merged = resolveEntry(index, parent.preset, type, parent.vendor, nextChain);
  }
  for (const name of Array.isArray(preset.include) ? preset.include : []) {
    const included = lookup(index, type, name, vendor);
    if (!included) throw new Error(`Included ${type} template "${name}" was not found.`);
    Object.assign(merged, resolveEntry(index, included.preset, type, included.vendor, nextChain));
  }
  for (const [key, value] of Object.entries(preset)) if (!META_KEYS.has(key)) merged[key] = value;
  return merged;
}

/**
 * Returns a self-contained preset. `preset` is either a vendor preset name or a parsed
 * preset object (for example a user preset exported from Bambu Studio or OrcaSlicer).
 */
export function flattenPreset(index, { type, preset, vendor = "BBL" }) {
  if (!PRESET_TYPES.has(type)) throw new TypeError(`Unknown preset type "${type}".`);
  const leaf = typeof preset === "string" ? lookup(index, type, preset, vendor) : { vendor, type, preset };
  if (!leaf) throw new Error(`${type} preset "${preset}" was not found.`);
  const flattened = resolveEntry(index, leaf.preset, type, leaf.vendor, []);
  // The CLI reads `inherits` as the system preset name for compatibility checks.
  return {
    ...flattened, type, name: leaf.preset.name, from: leaf.preset.from ?? "system",
    inherits: leaf.preset.from && leaf.preset.from.toLowerCase() === "user" ? leaf.preset.inherits ?? "" : "",
    instantiation: "true"
  };
}

/** Keys that identify a physical printer on a LAN or an account; stripped before committing presets. */
export const PRIVATE_PRESET_KEYS = Object.freeze([
  "print_host", "print_host_webui", "printhost_apikey", "printhost_cafile", "printhost_user", "printhost_password",
  "printhost_port", "printhost_authorization_type", "printhost_ssl_ignore_revoke", "user_id", "setting_id", "base_id",
  "updated_time", "sync_info", "dev_id", "print_host_upload_path"
]);

export function stripPrivatePresetKeys(preset) {
  return Object.fromEntries(Object.entries(preset).filter(([key]) => !PRIVATE_PRESET_KEYS.includes(key)));
}
