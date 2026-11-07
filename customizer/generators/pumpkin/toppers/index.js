import { referenceCrown, referencePumpkin } from '../reference.js';
import witch from './witch.js';
import santa from './santa.js';
import baseball from './baseball.js';
import { contourSeat } from './seat.js';
import { trimMask } from './trim.js';

export const TOPPER_BUILDERS = Object.freeze({ witch, santa, baseball });

// Both faces of the lower hat follow the reference crown. The exact mould
// removes interpolation error on the inside and leaves 0.2 mm vertical clearance.
export function buildTopper(wasm, style, { clearance = .3, crownDiameter = 36, trim = false } = {}) {
  const builder = TOPPER_BUILDERS[style];
  if (!builder) throw new Error('Choose a supported pumpkin hat.');
  if (!Number.isFinite(clearance) || clearance < .1 || clearance > .6) throw new Error('Peg clearance must be between 0.1 and 0.6 mm.');
  const temps = [], t = o => { temps.push(o); return o; };
  try {
    let raw = builder(wasm,t,{crownDiameter});
    if(trim) {
      const b=raw.boundingBox(), size=b.max.map((v,i)=>v-b.min[i]+4);
      const box=t(t(wasm.Manifold.cube(size)).translate(b.min.map(v=>v-2)));
      raw=t(t(trimMask(wasm,style,{crownDiameter})).intersect(box));
    }

    const crown=t(t(referencePumpkin(wasm)).add(t(referenceCrown(wasm,0))));
    const refined=t(raw.refineToLength(.5));
    const shaped=t(refined.warp(contourSeat(crown,style)));
    if(trim) return shaped.translate([0,0,0]);
    const mould=t(crown.add(t(crown.translate([0,0,.2]))));
    const seated=t(shaped.subtract(mould));
    if (style === 'baseball') {
      const bore=t(t(wasm.Manifold.cylinder(4,2,2,64)).translate([0,0,28.2]));
      const result=t(seated.subtract(bore));

      // Boolean cuts can isolate tiny unprintable specks at mesh tangencies.
      const pieces=result.decompose().map(t), kept=pieces.filter(p=>p.volume()>.001);
      if(kept.length!==1) throw new Error('The fitted cap must remain one connected piece.');
      return kept[0].translate([0,0,0]);
    }

    const r = (4-clearance)/2;
    const lead = t(t(wasm.Manifold.cylinder(.8,r-.25,r,64)).translate([0,0,24.7]));
    const peg = t(t(wasm.Manifold.cylinder(6,r,r,64)).translate([0,0,25.5]));
    return wasm.Manifold.union([seated,lead,peg]);
  } finally { for (const o of temps) o.delete(); }
}
