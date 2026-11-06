// Reproducible printability fixtures from the same models customers download.
// Usage: node scripts/export-gridfinity-print-fixtures.mjs <private-output-dir>
// STL allows a second slicer to verify geometry independently of Bambu metadata.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEngine } from '../customizer/framework/engine.js';
import { buildModel } from '../customizer/framework/model.js';
import { validateParams } from '../public/assets/js/customize/schema.js';
import { GENERATORS } from '../public/assets/js/customize/registry.js';
import { loadBuilder } from '../customizer/generators/index.js';

const dir = resolve(process.argv[2] ?? '.superpowers/gridfinity-printability');
await mkdir(dir, { recursive: true });
const wasm = await loadEngine();
const cases = [
  ['base-standard', 'gridfinity-base', { columns: 1, rows: 1 }],
  ['base-light', 'gridfinity-base', { columns: 1, rows: 1, style: 'light' }],
  ['base-magnetic', 'gridfinity-base', { columns: 1, rows: 1, style: 'magnetic', magnet_diameter_mm: 6.4, magnet_depth_mm: 2.4 }],
  ['base-magnetic-light', 'gridfinity-base', { columns: 1, rows: 1, style: 'magnetic-light' }],
  ['base-magnetic-light-thin-wide', 'gridfinity-base', { columns: 2, rows: 2, style: 'magnetic-light', light_base_mm: 2.4, magnet_depth_mm: 2, light_opening_mm: 39.6, light_tab_wall_mm: 0.8, light_magnet_diameter_mm: 6.6 }],
  ['base-magnetic-light-closed', 'gridfinity-base', { columns: 1, rows: 1, style: 'magnetic-light', light_through_holes: false, light_magnet_diameter_mm: 6.09 }],
  ['bin-standard', 'gridfinity-bin', { columns: 1, rows: 1 }],
  ['bin-thin', 'gridfinity-bin', { columns: 1, rows: 1, wall_mm: 1.2, stacking_lip: false }],
  ['bin-labeled-divided-magnetic', 'gridfinity-bin', { label_shelf: true, compartments_x: 2, compartments_y: 2, magnets: true, magnet_diameter_mm: 6.4, magnet_depth_mm: 2.4 }],
  ['vase-shell', 'gridfinity-bin', { style: 'vase', stacking_lip: false }],
  ['vase-adapter', 'gridfinity-bin', { style: 'vase', stacking_lip: false, vase_part: 'adapter' }]
];
const manifest = [];
for (const [name, id, input] of cases) {
  const g = GENERATORS[id];
  const checked = validateParams(g, input);
  if (!checked.ok) throw new Error(`${name}: ${checked.errors.join('; ')}`);
  const { default: build } = await loadBuilder[id]();
  const out = await buildModel({ ...g, build }, checked.value, { wasm });
  let stl = `solid ${name}\n`;
  for (const part of out.parts) for (const triangle of part.mesh.triangles) {
    stl += 'facet normal 0 0 0\nouter loop\n';
    for (const index of triangle) stl += `vertex ${part.mesh.vertices[index].join(' ')}\n`;
    stl += 'endloop\nendfacet\n';
  }
  stl += `endsolid ${name}\n`;
  await writeFile(join(dir, `${name}.stl`), stl);
  await writeFile(join(dir, `${name}.3mf`), out.data);
  manifest.push({ name, id, params: checked.value, triangles: out.metrics.triangles, sha256: createHash('sha256').update(out.data).digest('hex'), stlSha256: createHash('sha256').update(stl).digest('hex'), warnings: out.warnings });
}
await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Exported ${manifest.length} Gridfinity fixture pairs to ${dir}`);
