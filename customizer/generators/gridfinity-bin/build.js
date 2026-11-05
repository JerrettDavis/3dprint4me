import { cellCenters, footprint } from '../../../public/assets/js/customize/gridfinity.js';
import { gridFoot, roundedLoft } from '../gridfinity/shared.js';

export default function build(p, { wasm }) {
  const { Manifold } = wasm;
  const temps = [];
  const t = s => { temps.push(s); return s; };
  const { width: w, depth: d } = footprint(p.columns, p.rows);
  const rim = p.height_units * 7;
  const station = (z, inset = 0) => ({ z, width: w - 2 * inset, depth: d - 2 * inset, radius: Math.max(0.4, 3.75 - inset) });
  const prism = (z0, z1, inset = 0) => t(roundedLoft(wasm, [station(z0, inset), station(z1, inset)]));
  const vase = p.style === 'vase';
  const shell = vase && p.vase_part === 'shell';
  try {
    let result;
    if (shell) {
      // A positive volume, deliberately solid. The slicer creates the spiral
      // wall and floor. No feet or other objects may share its spiral job.
      result = prism(0, rim - 5.95);
    } else {
      const feet = t(gridFoot(wasm));
      const parts = cellCenters(p.columns, p.rows).map(([x, y]) => t(feet.translate([x, y, 0])));
      const top = vase ? 5.95 : rim + (p.stacking_lip ? 4.4 : 0);
      const outer = prism(4.7, top);
      let body = outer;
      if (!vase) {
        let cavity;
        if (p.stacking_lip) {
          cavity = t(roundedLoft(wasm, [
            station(5.95, p.wall_mm), station(rim - 1.4, p.wall_mm),
            station(rim, 2.6), station(rim + 0.7, 1.9),
            station(rim + 2.5, 1.9), station(rim + 4.4, 0), station(rim + 4.5, 0)
          ]));
        } else cavity = prism(5.95, top + 0.1, p.wall_mm);
        body = t(outer.subtract(cavity));
      }
      parts.push(body);
      if (!vase) {
        const addBox = (width, depth, height, x, y, z) => {
          const cube = t(Manifold.cube([width, depth, height]));
          parts.push(t(cube.translate([x - width / 2, y - depth / 2, z])));
        };
        for (let i = 1; i < p.compartments_x; i++) addBox(1.2, d - p.wall_mm, rim - 6, -w / 2 + i * w / p.compartments_x, 0, 5.9);
        for (let i = 1; i < p.compartments_y; i++) addBox(w - p.wall_mm, 1.2, rim - 6, 0, -d / 2 + i * d / p.compartments_y, 5.9);
        if (p.label_shelf) {
          const y = d / 2 - p.wall_mm + 0.1;
          const x = w / 2 - p.wall_mm;
          const pts = [];
          for (const xx of [-x, x]) pts.push([xx, y, rim - 9.2], [xx, y - 8, rim - 1.2], [xx, y - 8, rim], [xx, y, rim]);
          parts.push(t(Manifold.hull(pts)));
        }
      }
      result = t(Manifold.union(parts));
      if (p.magnets && !vase) {
        const pocket = t(Manifold.cylinder(2.2, 3.1, 3.1, 32));
        const holes = [];
        for (const [x, y] of cellCenters(p.columns, p.rows)) for (const dx of [-13, 13]) for (const dy of [-13, 13]) holes.push(t(pocket.translate([x + dx, y + dy, 0])));
        result = t(result.subtract(t(Manifold.union(holes))));
      }
    }
    // Return an owned copy; every intermediate is disposed below.
    const solid = result.translate([0, 0, 0]);
    return {
      solids: [{ name: shell ? 'Vase shell · spiral print only' : vase ? 'Vase adapter · normal print' : 'Gridfinity bin', color: p.color, solid }],
      filenameBase: `gridfinity-bin-${p.columns}x${p.rows}-${vase ? `vase-${p.vase_part}` : 'standard'}`,
      ...(shell ? { slicerSettings: { spiral_mode: '1', top_shell_layers: '0', bottom_shell_layers: '6', sparse_infill_density: '0%' } } : {}),
      warnings: vase ? [
        'Download shell and adapter separately with matching rows and columns. Glue the flat shell floor to the adapter after printing; align the outer edges.',
        shell ? 'This is a solid vase-mode input, not a solid-filled finished bin. Slice alone in spiral mode: 0.4 mm nozzle, 0.45 mm line width, 0.2 mm layers, 6 bottom layers, no top or infill. Verify the sliced toolpath.' : 'Print this adapter normally, flat without supports. Never enable spiral mode for the adapter.',
        'Only the selected component is included in a download or print request. Order the other component separately.'
      ] : ['Print upright without supports. Print a 1 × 1 fit sample before a full set.', ...(p.magnets ? ['Glue in 6 × 2 mm magnets after printing; check polarity. Pocket roofs bridge 6.2 mm.'] : [])]
    };
  } finally { temps.reverse().forEach(s => s.delete()); }
}
