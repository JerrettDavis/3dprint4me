// Run each potentially expensive hollow build in its own process with a hard
// operational budget, so a pathological morphology cannot hang verification.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import generator from '../public/assets/js/customize/generators/vase.js';
import { validateParams } from '../public/assets/js/customize/schema.js';
import build from '../customizer/generators/vase/build.js';
import { loadEngine } from '../customizer/framework/engine.js';
import { buildModel } from '../customizer/framework/model.js';
import { analyzeModelOnServer } from '../lib/print-estimation/geometry/analyze-model.js';

const script = fileURLToPath(import.meta.url);
if (process.argv[2] === '--child') {
  const design = process.argv[3], construction = process.argv[4];
  if (!Object.hasOwn(generator.presets, design)) throw new Error('Unknown vase design.');
  const checked = validateParams(generator, { ...generator.presets[design], construction });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const wasm = await loadEngine(), started = performance.now();
  try {
    const output = build(checked.value, { wasm });
    const exported = await buildModel({ ...generator, build: () => output }, checked.value, { wasm });
    const { metrics } = await analyzeModelOnServer({ name: exported.filename, bytes: exported.data });
    if (metrics.degenerateTriangles || metrics.signedVolumeMm3 <= 0
      || Math.abs(metrics.dimensionsMm[2] - checked.value.height_mm) > 0.001) {
      throw new Error('Exported vase failed independent geometry analysis.');
    }
    const directory = fileURLToPath(new URL('../.superpowers/vase-fixtures/', import.meta.url));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${design}-${construction}.3mf`), exported.data);
    console.log(JSON.stringify({ design, construction, ok: true,
      milliseconds: Math.round(performance.now() - started), triangles: metrics.triangleCount,
      dimensionsMm: metrics.dimensionsMm, volumeMm3: metrics.volumeMm3, warnings: metrics.warnings }));
  } catch (error) {
    console.log(JSON.stringify({ design, construction, ok: false, error: error.message }));
    process.exitCode = 1;
  }
} else {
  const selected = process.argv.slice(2);
  const designs = selected.length ? selected : Object.keys(generator.presets);
  for (const design of designs) for (const construction of ['solid', 'hollow']) {
    if (!Object.hasOwn(generator.presets, design)) throw new Error(`Unknown vase design: ${design}`);
    const result = spawnSync(process.execPath, [script, '--child', design, construction], {
      encoding: 'utf8', timeout: 22000, windowsHide: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.error) console.log(JSON.stringify({ design, construction, ok: false, error: result.error.code }));
    if (result.status !== 0 || result.error) process.exitCode = 1;
  }
}
