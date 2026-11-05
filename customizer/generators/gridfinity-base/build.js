import { cellCenters, GRIDFINITY } from '../../../public/assets/js/customize/gridfinity.js';
import { gridFoot, roundedLoft } from '../gridfinity/shared.js';

export default function build(p, { wasm }) {
  const { Manifold } = wasm;
  const temps = [];
  const t = value => { temps.push(value); return value; };
  try {
    const cells = cellCenters(p.columns, p.rows);
    const floor = p.style === 'magnetic' ? 3.2 : 0;
    const height = floor + GRIDFINITY.footHeight;
    const block = t(Manifold.cube([p.columns * 42, p.rows * 42, height]));
    const outer = t(block.translate([-p.columns * 21, -p.rows * 21, 0]));
    const socket = t(gridFoot(wasm, p.clearance_mm));
    const cuts = cells.map(([x, y]) => t(socket.translate([x, y, floor])));
    if (p.style === 'light') {
      // Keep the complete seating height: shortening the plate would make the
      // feet hit the table before the mating chamfer could seat. Relieve only
      // the lower rails; the upper chamfer remains at its standard world Z.
      const relief = t(roundedLoft(wasm, [0, 3.5].map(z => ({
        z, width: 39 + 2 * p.clearance_mm, depth: 39 + 2 * p.clearance_mm,
        radius: 2.5 + p.clearance_mm
      }))));
      for (const [x, y] of cells) cuts.push(t(relief.translate([x, y, 0])));
    }
    if (floor) {
      const pocket = t(Manifold.cylinder(p.magnet_depth_mm, p.magnet_diameter_mm / 2, p.magnet_diameter_mm / 2, 32));
      for (const [x, y] of cells) for (const dx of [-13, 13]) for (const dy of [-13, 13]) {
        cuts.push(t(pocket.translate([x + dx, y + dy, 0])));
      }
    }
    const holes = t(Manifold.union(cuts));
    const cut = t(outer.subtract(holes));
    const solid = cut.translate([0, 0, 0]);
    return {
      solids: [{ name: 'Gridfinity baseplate', color: p.color, solid }],
      filenameBase: `gridfinity-base-${p.columns}x${p.rows}-${p.style}`,
      warnings: ['Print flat without supports. Check bed size and print a 1 × 1 fit sample before making a full grid.', ...(floor ? [`Glue in 6 × 2 mm magnets after printing; check polarity. Pocket roofs require a ${p.magnet_diameter_mm} mm bridge.`] : [])]
    };
  } finally { temps.reverse().forEach(s => s.delete()); }
}
