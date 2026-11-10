import { buildHingeTools, buildSocketSweep } from './hinge.js';

// A small fit sample using the same socket and connector as the future assembly.
// Not registered publicly until production folding and slicing checks are complete.
export function buildHingeCoupon(wasm, h) {
  const { Manifold } = wasm;
  const tools = buildHingeTools(wasm, h);
  const temps = [];
  const t = s => { temps.push(s); return s; };
  const solids = [];
  try {
    const z = h.barrelRadius;
    const connector = tools.connector.translate([0, 0, z]);
    solids.push({ name: 'Double-pivot fit connector', color: '#d6a052', solid: connector });
    const bodyDepth = h.pinLength + 2 * (h.clearance + h.wall);
    const height = h.thickness + h.clearance + h.wall;
    const bodyWidth = h.pivotSpacing / 2 + h.barrelRadius + h.clearance + h.wall;
    const gap = 2 * h.clearance;
    for (const sign of [-1, 1]) {
      const blank = t(Manifold.cube([bodyWidth, bodyDepth, height]));
      const shifted = t(blank.translate([sign < 0 ? -bodyWidth - gap / 2 : gap / 2, -bodyDepth / 2, 0]));
      // A neutral-pose pocket alone locks at about 47 degrees. Reserve the moving
      // link's whole quarter-turn envelope around this body's own pin.
      const localSweep = t(buildSocketSweep(wasm, h, sign));
      const sweep = t(localSweep.translate([0, 0, z]));
      const solid = shifted.subtract(sweep);
      solids.push({ name: sign < 0 ? 'Left fit socket' : 'Right fit socket', color: '#315b6c', solid });
    }
    return { solids, filenameBase: 'infinity-fidget-hinge-fit', warnings: [
      'Engineering fit sample. Slicing and a physical print are required before claiming printable movement.',
      `Nominal radial and axial clearance: ${h.clearance} mm. Check free movement and pin retention before a complete fidget.`
    ] };
  } catch (error) {
    solids.forEach(s => s.solid.delete());
    throw error;
  } finally {
    temps.reverse().forEach(s => s.delete());
    tools.dispose();
  }
}
