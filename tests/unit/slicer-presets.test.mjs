import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { flattenPreset, indexVendorPresets, stripPrivatePresetKeys } from "../../lib/print-estimation/slicer-presets.js";
import { flattenToDirectory } from "../../scripts/flatten-slicer-presets.mjs";

async function vendorTree() {
  const root = await mkdtemp(join(tmpdir(), "3dp-presets-"));
  const put = async (vendor, type, body) => {
    await mkdir(join(root, vendor, type), { recursive: true });
    await writeFile(join(root, vendor, type, `${body.name}.json`), JSON.stringify({ type, from: "system", ...body }));
  };
  await put("BBL", "machine", { name: "fdm_machine_common", printable_height: "250", machine_start_gcode: "base", nozzle_diameter: ["0.4"] });
  await put("BBL", "machine", { name: "Printer template start", instantiation: "false", machine_start_gcode: "templated" });
  await put("BBL", "machine", { name: "Printer 0.4 nozzle", inherits: "fdm_machine_common", include: ["Printer template start"], printable_height: "325", instantiation: "true" });
  await put("Other", "machine", { name: "fdm_machine_common", printable_height: "999" });
  await put("BBL", "process", { name: "fdm_process_common", layer_height: "0.2", wall_loops: "2" });
  await put("BBL", "process", { name: "0.16mm Fine", inherits: "fdm_process_common", layer_height: "0.16" });
  await put("BBL", "filament", { name: "Generic PLA @base", filament_density: ["1.24"], filament_type: ["PLA"] });
  await put("BBL", "filament", { name: "Generic PLA @Printer", inherits: "Generic PLA @base", nozzle_temperature: ["220"] });
  await put("BBL", "filament", { name: "Loop A", inherits: "Loop B" });
  await put("BBL", "filament", { name: "Loop B", inherits: "Loop A" });
  return root;
}

test("vendor presets flatten parent chain, includes, then own keys within the same vendor", async () => {
  const root = await vendorTree();
  try {
    const index = await indexVendorPresets(root);
    const machine = flattenPreset(index, { type: "machine", preset: "Printer 0.4 nozzle" });
    assert.equal(machine.printable_height, "325", "child wins over parent");
    assert.equal(machine.machine_start_gcode, "templated", "includes override the parent");
    assert.deepEqual(machine.nozzle_diameter, ["0.4"]);
    assert.equal(machine.inherits, "");
    assert.equal("include" in machine, false);
    assert.equal(flattenPreset(index, { type: "process", preset: "0.16mm Fine" }).wall_loops, "2");
    assert.equal(flattenPreset(index, { type: "filament", preset: "Generic PLA @Printer" }).filament_density[0], "1.24");
    assert.throws(() => flattenPreset(index, { type: "filament", preset: "Loop A" }), /cycle/);
    assert.throws(() => flattenPreset(index, { type: "process", preset: "missing" }), /not found/);

    // User presets keep `inherits` (the CLI uses it as the system name) and lose LAN/account keys.
    const user = stripPrivatePresetKeys(flattenPreset(index, { type: "machine", preset: { name: "My Printer", from: "User", inherits: "Printer 0.4 nozzle", print_host: "192.0.2.10", printhost_apikey: "k", printable_height: "300" } }));
    assert.deepEqual({ name: user.name, inherits: user.inherits, height: user.printable_height, start: user.machine_start_gcode }, { name: "My Printer", inherits: "Printer 0.4 nozzle", height: "300", start: "templated" });
    assert.equal("print_host" in user, false);
    assert.equal("printhost_apikey" in user, false);

    const out = join(root, "out");
    const written = await flattenToDirectory({ profiles: root, out, machine: "Printer 0.4 nozzle", process: "0.16mm Fine", filaments: { pla: "Generic PLA @Printer" } });
    assert.deepEqual(written.map(item => item.file), ["machine.json", "process.json", "filament-pla.json"]);
    assert.equal(JSON.parse(await readFile(join(out, "process.json"), "utf8")).layer_height, "0.16");
  } finally { await rm(root, { recursive: true, force: true }); }
});
