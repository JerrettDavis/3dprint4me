import { referenceCrown } from '../reference.js';
import witch from './witch.js';
import santa from './santa.js';
import baseball from './baseball.js';

export const TOPPER_BUILDERS = Object.freeze({ witch, santa, baseball });

// All styles share the untouched reference socket and exact crown mould.
// Returned geometry is assembled in reference-body coordinates (Z base=0).
export function buildTopper(wasm, style, { clearance = .3 } = {}) {
  const builder = TOPPER_BUILDERS[style];
  if (!builder) throw new Error('Choose a supported pumpkin hat.');
  if (!Number.isFinite(clearance) || clearance < .1 || clearance > .6) throw new Error('Peg clearance must be between 0.1 and 0.6 mm.');
  const temps = [], t = o => { temps.push(o); return o; };
  try {
    const raw = builder(wasm,t);
    const mould = t(referenceCrown(wasm,.2));
    const seated = t(raw.subtract(mould));
    const r = (4-clearance)/2;
    const lead = t(t(wasm.Manifold.cylinder(.8,r-.25,r,64)).translate([0,0,24.7]));
    const peg = t(t(wasm.Manifold.cylinder(6,r,r,64)).translate([0,0,25.5]));
    return wasm.Manifold.union([seated,lead,peg]);
  } finally { for (const o of temps) o.delete(); }
}
