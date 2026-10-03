// Slices one model with the provider configured by SLICER_* env vars and prints the contract result as JSON.
// Usage: node scripts/slicer-smoke.mjs <model.3mf|.stl> [colors=3] [material=pla]
import { readFile } from "node:fs/promises";
import { createSlicerFromEnv } from "../lib/print-estimation/runtime.js";
const [, , path, colors = "3", material = "pla"] = process.argv;
if (!path) { console.error("Usage: slicer-smoke.mjs <model> [colors] [material]"); process.exit(2); }
const slicer = createSlicerFromEnv();
if (!slicer) { console.error("No slicer configured (set SLICER_PROVIDER)."); process.exit(2); }
const bytes = new Uint8Array(await readFile(path));
try {
  const result = await slicer.estimateSlice({ bytes, filename: path, options: { material, colors: Number(colors) } });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: { name: error.name, category: error.category ?? "unknown", message: String(error.message ?? "").slice(0, 300) } }, null, 2));
  process.exit(1);
}
