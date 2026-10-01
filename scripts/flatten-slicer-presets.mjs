// Writes self-contained Bambu Studio / OrcaSlicer presets for the headless slicer worker.
//
//   node scripts/flatten-slicer-presets.mjs --profiles <app>/resources/profiles --vendor BBL \
//     --out <dir> --machine "Bambu Lab X2D 0.4 nozzle" --process "0.16mm High Quality @BBL X2D" \
//     --filament pla="Generic PLA @BBL X2D 0.4 nozzle" --filament petg=./my-user-preset.json
//
// A value ending in .json is read as a (user) preset file; anything else is a vendor
// preset name. Output: <out>/machine.json, <out>/process.json, <out>/filament-<key>.json.
// Account/LAN keys (print_host, API keys, user ids) are never written.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { flattenPreset, indexVendorPresets, stripPrivatePresetKeys } from "../lib/print-estimation/slicer-presets.js";

async function source(value) {
  return value.toLowerCase().endsWith(".json") ? JSON.parse(await readFile(value, "utf8")) : value;
}

export async function flattenToDirectory({ profiles, vendor = "BBL", out, machine, process: processPreset, filaments }) {
  const index = await indexVendorPresets(profiles);
  await mkdir(out, { recursive: true });
  const write = async (file, type, preset) => {
    const flattened = stripPrivatePresetKeys(flattenPreset(index, { type, preset: await source(preset), vendor }));
    await writeFile(join(out, file), `${JSON.stringify(flattened, null, 2)}\n`);
    return { file, name: flattened.name };
  };
  const written = [await write("machine.json", "machine", machine), await write("process.json", "process", processPreset)];
  for (const [key, preset] of Object.entries(filaments)) {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`Invalid filament key "${key}".`);
    written.push(await write(`filament-${key}.json`, "filament", preset));
  }
  return written;
}

async function main() {
  const { values } = parseArgs({
    options: {
      profiles: { type: "string" }, vendor: { type: "string", default: "BBL" }, out: { type: "string" },
      machine: { type: "string" }, process: { type: "string" }, filament: { type: "string", multiple: true, default: [] }
    }
  });
  if (!values.profiles || !values.out || !values.machine || !values.process || !values.filament.length) {
    throw new Error("Usage: --profiles <dir> --out <dir> --machine <name|file> --process <name|file> --filament key=<name|file> [...]");
  }
  const filaments = Object.fromEntries(values.filament.map(entry => {
    const at = entry.indexOf("=");
    if (at < 1) throw new Error(`--filament expects key=<name|file>, got "${entry}".`);
    return [entry.slice(0, at), entry.slice(at + 1)];
  }));
  const written = await flattenToDirectory({ ...values, filaments });
  for (const { file, name } of written) console.log(`${file}: ${name}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
