// Deterministic stand-in for the Bambu Studio / OrcaSlicer CLI. It replays output captured
// from a real BambuStudio 02.08.04.57 slice of cube-20mm-binary.stl (X2D, 0.16 mm, Generic PLA).
// The mode comes from the machine preset's "fake_mode" key so the adapter's argv is unchanged.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const fixture = name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
if (args.includes("--help")) { console.log("BambuStudio-02.08.04.57:\nUsage: bambu-studio [ OPTIONS ] [ file.3mf/file.stl ... ]"); process.exit(0); }
const value = flag => args[args.indexOf(flag) + 1];
const [machinePath] = value("--load-settings").split(";");
const mode = JSON.parse(readFileSync(machinePath, "utf8")).fake_mode ?? "ok";
const outputDir = value("--outputdir");
const model = args.at(-1);
readFileSync(model);
mkdirSync(outputDir, { recursive: true });
const result = JSON.parse(fixture("bambu-result.json"));
const writeResult = (code, message) => writeFileSync(join(outputDir, "result.json"), JSON.stringify({ ...result, return_code: code, error_string: message, sliced_plates: code ? [] : result.sliced_plates }));

const filament = JSON.parse(readFileSync(value("--load-filaments"), "utf8"));
if (filament.fake_needs_bed && !args.includes("--curr-bed-type")) { writeResult(-61, "Filaments are not compatible with the plate type."); process.exit(195); }
if (mode === "reject") { writeResult(-50, "One of the plate is empty or has no object fully inside it."); process.exit(206); }
if (mode === "config") { writeResult(-5, "The input preset file is invalid and can not be parsed."); process.exit(251); }
if (mode === "crash") { console.error("segfault with private detail"); process.exit(139); }
if (mode === "hang") setTimeout(() => {}, 60_000);
else if (mode === "empty") writeResult(0, "Success.");
else {
  const header = fixture("bambu-plate-header.gcode");
  if (mode === "header-only") {
    // Without result.json the adapter must fall back to the G-code header (Orca-style version line).
    writeFileSync(join(outputDir, "plate_1.gcode"), header.replace("; BambuStudio 02.08.04.57", "; OrcaSlicer 2.4.2"));
  } else {
    // A test filament preset may carry "fake_grams" so tests can see which file was loaded.
    const grams = filament.fake_grams;
    if (grams) result.sliced_plates[0].filaments[0].total_used_g = grams;
    writeResult(0, "Success.");
    writeFileSync(join(outputDir, "plate_1.gcode"), `${header}\nG1 X0 Y0\n`);
  }
}
