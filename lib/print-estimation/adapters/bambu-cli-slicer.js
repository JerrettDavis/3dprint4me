// Bambu Studio / OrcaSlicer headless CLI adapter. Both share the Slic3r-derived Bambu
// command line: `--slice 0 --load-settings "machine.json;process.json" --load-filaments
// filament.json --outputdir <dir> <model>`, which writes `plate_<n>.gcode` files plus a
// `result.json` with a numeric return code. Presets must be self-contained (see
// lib/print-estimation/slicer-presets.js): the CLI does not resolve `inherits` chains.
//
// The model is written to a private temporary directory, the binary runs without a
// shell and with a hard timeout, and only bounded fields are read from the output.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { SliceError } from "../slicer-contract.js";
import { parseDuration, parseGcodeSummary } from "./local-cli-slicer.js";

const HEADER_BYTES = 64 * 1024;
const RESULT_BYTES = 256 * 1024;

// Bambu CLI return codes (src/libslic3r/Utils.hpp). The model itself cannot be sliced on
// this printer: retrying will not help, so these are permanent "unsupported" failures.
const MODEL_REJECTED = new Set([-6, -10, -16, -18, -21, -24, -25, -50, -52, -58, -59, -60, -63, -64, -65, -104]);
// Worker misconfiguration (bad preset files, environment): retry once the owner fixes it.
const MISCONFIGURED = new Set([-1, -5, -7, -15, -17, -20, -23, -61, -66, -68]);

export function categorizeReturnCode(code) {
  if (MODEL_REJECTED.has(code)) return "unsupported";
  if (MISCONFIGURED.has(code)) return "unavailable";
  return "slicer_failed";
}

function run(file, args, { timeoutMs, cwd, env }) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, cwd, env, windowsHide: true, shell: false }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

const sumList = value => value == null ? null : value.split(",").map(Number).filter(Number.isFinite).reduce((total, item) => total + item, 0);

/** Reads the HEADER_BLOCK summary Bambu Studio / OrcaSlicer write at the top of each plate's G-code. */
export function parseBambuGcodeHeader(source) {
  const pick = pattern => { const match = source.match(pattern); return match ? match[1].trim() : null; };
  const generic = parseGcodeSummary(source);
  const versionMatch = source.match(/^;\s*(BambuStudio|OrcaSlicer)[\s-]+v?(\d[\w.+-]*)\s*$/im);
  return {
    elapsedSeconds: parseDuration(pick(/^;.*?total estimated time:\s*([^;\n]+?)\s*(?:;|$)/im) ?? "") ?? generic.elapsedSeconds,
    materialGrams: sumList(pick(/^;\s*total filament weight \[g\]\s*:\s*(.+)$/im)) ?? generic.materialGrams,
    materialMm: sumList(pick(/^;\s*total filament length \[mm\]\s*:\s*(.+)$/im)) ?? generic.materialMm,
    layerCount: Number(pick(/^;\s*total layer number:\s*(\d+)/im)) || generic.layerCount,
    version: versionMatch ? `${versionMatch[1]} ${versionMatch[2]}` : generic.version
  };
}

/** Reads the CLI's result.json (return code, per-plate time prediction and filament grams). */
export function parseBambuResult(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const plates = Array.isArray(parsed.sliced_plates) ? parsed.sliced_plates : [];
  const finite = value => (Number.isFinite(Number(value)) ? Number(value) : null);
  const total = (values) => { const numbers = values.filter(value => value != null); return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null; };
  return {
    returnCode: Number.isInteger(parsed.return_code) ? parsed.return_code : null,
    plateCount: plates.length,
    elapsedSeconds: total(plates.map(plate => finite(plate.total_predication))),
    materialGrams: total(plates.flatMap(plate => (Array.isArray(plate.filaments) ? plate.filaments : []).map(item => finite(item.total_used_g)))),
    toolChanges: total(plates.map(plate => finite(plate.filament_change_times))) ?? 0,
    layerHeight: finite(parsed.layer_height)
  };
}

async function readHead(path, bytes) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, bytes));
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8");
  } finally { await handle.close(); }
}

/**
 * @param {object} config
 * @param {string} config.bin            Slicer executable (AppRun of an extracted AppImage).
 * @param {string} config.machinePath    Flattened machine preset JSON.
 * @param {string} config.processPath    Flattened process preset JSON.
 * @param {Record<string,string>} config.filamentPaths  Material key -> flattened filament JSON; `default` is the fallback.
 * @param {string} [config.bedType]     Build plate, e.g. "Textured PEI Plate" (filaments are validated against it).
 */
export function createBambuCliSlicer({ bin, machinePath, processPath, filamentPaths = {}, engine = "bambu-studio-cli", engineVersion = null, timeoutMs = 300_000, profileId = null, bedType = null, extraArgs = [] }) {
  if (!bin) throw new TypeError("SLICER_BIN is required for the Bambu/Orca CLI slicer.");
  if (!machinePath || !processPath) throw new TypeError("SLICER_MACHINE_PROFILE and SLICER_PROCESS_PROFILE are required for the Bambu/Orca CLI slicer.");
  const fallbackFilament = filamentPaths.default ?? filamentPaths.pla ?? Object.values(filamentPaths)[0];
  if (!fallbackFilament) throw new TypeError("At least one filament profile is required for the Bambu/Orca CLI slicer.");
  const scripted = [".js", ".mjs"].includes(extname(bin).toLowerCase());
  const command = scripted ? process.execPath : bin;
  const prefix = scripted ? [bin] : [];
  let cachedVersion = engineVersion;

  async function version(cwd, env) {
    if (cachedVersion) return cachedVersion;
    try {
      const { stdout } = await run(command, [...prefix, "--help"], { timeoutMs: 20_000, cwd, env });
      cachedVersion = (stdout.match(/(?:BambuStudio|OrcaSlicer)[-\s]v?(\d[\w.+-]*)/i)?.[1] ?? "unknown").replace(/:$/, "").slice(0, 80);
    } catch { cachedVersion = "unknown"; }
    return cachedVersion;
  }

  return {
    engine,
    async estimateSlice({ bytes, filename, options = {}, timeoutMs: limit = timeoutMs }) {
      const directory = await mkdtemp(join(tmpdir(), "3dp-slice-"));
      try {
        const outputDir = join(directory, "out");
        const home = join(directory, "home");
        const model = join(directory, `model${extname(filename ?? "").toLowerCase() === ".3mf" ? ".3mf" : ".stl"}`);
        await writeFile(model, bytes, { mode: 0o600 });
        const material = typeof options.material === "string" ? options.material : null;
        const materialFilament = material && filamentPaths[material] ? filamentPaths[material] : null;
        const filament = materialFilament ?? fallbackFilament;
        const args = [
          ...prefix, "--slice", "0", "--arrange", "1", "--orient", "0",
          "--load-settings", `${machinePath};${processPath}`, "--load-filaments", filament,
          "--outputdir", outputDir, ...(bedType ? ["--curr-bed-type", bedType] : []), ...extraArgs, model
        ];
        // Minimal environment: the slicer never sees worker secrets (DATABASE_URL, Blob token), and a
        // private HOME/XDG tree keeps the app's config/cache writes inside the job directory.
        const inherited = Object.fromEntries(["PATH", "TMPDIR", "SystemRoot", "SYSTEMROOT"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
        const env = { ...inherited, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_RUNTIME_DIR: home, LC_ALL: "C" };
        await mkdir(outputDir, { recursive: true });
        await mkdir(home, { recursive: true, mode: 0o700 });

        let failure = null;
        try { await run(command, args, { timeoutMs: limit, cwd: directory, env }); }
        catch (error) {
          if (error.code === "ENOENT") throw new SliceError("unavailable", "The slicer binary was not found.");
          if (error.killed || error.signal === "SIGKILL") throw new SliceError("timeout", `The slicer exceeded ${limit} ms.`);
          failure = error;
        }

        const resultText = await readHead(join(outputDir, "result.json"), RESULT_BYTES).catch(() => null);
        const result = resultText ? parseBambuResult(resultText) : null;
        if (failure || (result?.returnCode != null && result.returnCode !== 0)) {
          const code = result?.returnCode ?? (Number.isInteger(failure?.code) ? failure.code : null);
          throw new SliceError(code != null && result?.returnCode != null ? categorizeReturnCode(code) : "slicer_failed", `The slicer exited with code ${code ?? "unknown"}.`);
        }

        const gcodes = (await readdir(outputDir).catch(() => [])).filter(name => /^plate_\d+\.gcode$/.test(name)).sort();
        if (!gcodes.length) throw new SliceError("invalid_output", "The slicer produced no G-code.");
        const headers = await Promise.all(gcodes.map(async name => parseBambuGcodeHeader(await readHead(join(outputDir, name), HEADER_BYTES))));
        const sumHeaders = key => { const values = headers.map(header => header[key]).filter(value => value != null); return values.length ? values.reduce((total, value) => total + value, 0) : null; };
        // result.json carries unrounded values; the G-code header is the fallback when result.json is absent.
        const grams = result?.materialGrams > 0 ? result.materialGrams : sumHeaders("materialGrams");
        const seconds = result?.elapsedSeconds > 0 ? result.elapsedSeconds : sumHeaders("elapsedSeconds");
        const headerVersion = headers.find(header => header.version)?.version?.match(/(\d[\w.+-]*)/)?.[1];
        const baseProfile = profileId ?? [machinePath, processPath].map(path => path.split(/[\\/]/).pop()).join("+");
        return {
          engine,
          engineVersion: headerVersion ?? await version(directory, env),
          profileId: materialFilament ? `${baseProfile}:${material}` : baseProfile,
          elapsedSeconds: seconds == null ? null : Math.round(seconds * 100) / 100,
          materialGrams: grams == null ? null : Math.round(grams * 100) / 100,
          materialMm: sumHeaders("materialMm"),
          purgeGrams: null,
          supportGrams: null,
          toolChanges: result?.toolChanges ?? 0,
          layerCount: sumHeaders("layerCount"),
          warnings: gcodes.length > 1 ? [`Model was arranged across ${gcodes.length} plates.`] : []
        };
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  };
}

