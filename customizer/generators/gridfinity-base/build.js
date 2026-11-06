import { cellCenters, GRIDFINITY } from '../../../public/assets/js/customize/gridfinity.js';
import { gridFoot, roundedLoft } from '../gridfinity/shared.js';

export default function build(p, { wasm }) {
  const { Manifold } = wasm;
  const temps = [];
  const t = value => { temps.push(value); return value; };
  try {
    const cells = cellCenters(p.columns, p.rows);
    const light = p.style === 'magnetic-light';
    const floor = p.style === 'magnetic' ? 3.2 : light ? p.light_base_mm : 0;
    const height = floor + GRIDFINITY.footHeight;
    // Slightly tighter than the 3.75 mm bin corners: even maximum socket
    // clearance must leave material at the frame's nominal top plane.
    const block = light ? t(roundedLoft(wasm, [0, height].map(z => ({ z, width: p.columns * 42, depth: p.rows * 42, radius: 3.5 })))) : t(Manifold.cube([p.columns * 42, p.rows * 42, height]));
    const outer = light ? block : t(block.translate([-p.columns * 21, -p.rows * 21, 0]));
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
      const diameter = light ? p.light_magnet_diameter_mm : p.magnet_diameter_mm;
      if (light) {
        // Remove each cell center, retaining rounded corner tabs joined to both
        // adjacent rails. The inner arc is centered on the magnet, so even the
        // largest opening keeps the configured wall around the entire pocket.
        const radius = diameter / 2 + p.light_tab_wall_mm;
        const edge = GRIDFINITY.pitch / 2;
        const width = edge - GRIDFINITY.magnetOffset + radius;
        const center = (edge + GRIDFINITY.magnetOffset - radius) / 2;
        const pad = t(roundedLoft(wasm, [0, floor].map(z => ({ z, width, depth: width, radius }))));
        const pads = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) pads.push(t(pad.translate([sx * center, sy * center, 0])));
        const keep = t(Manifold.union(pads));
        const opening = t(roundedLoft(wasm, [0, floor].map(z => ({ z, width: p.light_opening_mm, depth: p.light_opening_mm, radius: 1 }))));
        const relief = t(opening.subtract(keep));
        for (const [x, y] of cells) cuts.push(t(relief.translate([x, y, 0])));
      }
      // Light pockets open up toward the seated bin; original solid-base
      // pockets retain their downward opening and documented bridge roof.
      const pocket = t(Manifold.cylinder(p.magnet_depth_mm + (light ? 0.01 : 0), diameter / 2, diameter / 2, light ? 64 : 32));
      const bore = light && p.light_through_holes ? t(Manifold.cylinder(floor, p.light_through_diameter_mm / 2, p.light_through_diameter_mm / 2, 32)) : null;
      for (const [x, y] of cells) for (const dx of [-13, 13]) for (const dy of [-13, 13]) {
        cuts.push(t(pocket.translate([x + dx, y + dy, light ? floor - p.magnet_depth_mm : 0])));
        if (bore) cuts.push(t(bore.translate([x + dx, y + dy, 0])));
      }
    }
    const holes = t(Manifold.union(cuts));
    const cut = t(outer.subtract(holes));
    const solid = cut.translate([0, 0, 0]);
    const warnings = ['Print flat without supports. Check bed size and print a 1 × 1 fit sample before making a full grid.'];
    if (light) {
      warnings.push(`Insert 6 × 2 mm magnets from above after printing; check polarity. ${p.light_magnet_diameter_mm} mm pockets need a fit sample; use glue if loose. Larger openings and thinner tabs reduce stiffness.`);
      if (p.light_through_holes) warnings.push('Small through-holes beneath the magnets allow removal or screw fastening. Check screw-head clearance before assembly.');
      if (p.light_opening_mm > 35.6 + 2 * p.clearance_mm) warnings.push('Wide cell openings leave a short bridging ledge beneath the mating rails (up to 1.9 mm). Tune bridging and cooling on a sample.');
    } else if (floor) {
      warnings.push(`Glue in 6 × 2 mm magnets after printing; check polarity. Pocket roofs require a ${p.magnet_diameter_mm} mm bridge.`);
    }
    return {
      solids: [{ name: 'Gridfinity baseplate', color: p.color, solid }],
      filenameBase: `gridfinity-base-${p.columns}x${p.rows}-${p.style}`,
      warnings
    };
  } finally { temps.reverse().forEach(s => s.delete()); }
}
