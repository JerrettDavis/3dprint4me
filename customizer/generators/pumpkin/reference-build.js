import { referencePumpkin } from './reference.js';
import { buildTopper } from './toppers/index.js';
import { integratedSupports } from './toppers/supports.js';

export default function buildReference(p, ctx) {
  const solids = [], temps = [];
  const t = o => { temps.push(o); return o; };
  const supportedHat = ['witch', 'santa', 'baseball'].includes(p.topper) && p.export_parts !== 'pumpkin';
  let success = false;
  try {
    if (p.export_parts !== 'hat' || ctx.presentation) {
      const body = referencePumpkin(ctx.wasm);
      solids.push({ name: 'Pumpkin · original happy', solid: body, color: p.body_color });
    }
    if (p.topper !== 'none' && (p.export_parts !== 'pumpkin' || ctx.presentation)) {
      const assembled = t(buildTopper(ctx.wasm, p.topper, { clearance: p.hat_clearance_mm, crownDiameter:p.cap_crown_mm }));
      const bb = assembled.boundingBox();
      const mask = t(buildTopper(ctx.wasm,p.topper,{clearance:p.hat_clearance_mm,crownDiameter:p.cap_crown_mm,trim:true}));
      const trim = t(assembled.intersect(mask));
      const main = t(assembled.subtract(mask));
      const delta = ctx.presentation ? [0,0,0] : [p.export_parts === 'hat' ? 0 : 32 - bb.min[0], 0, -bb.min[2]];
      solids.push({ name: `Hat · ${p.topper}`, solid: main.translate(delta), color: p.hat_color });
      if (!trim.isEmpty()) solids.push({ name: `Hat trim · ${p.topper}`, solid: trim.translate(delta), color: p.hat_trim_color });
      if (p.topper === 'baseball') {
        const r = (4-p.hat_clearance_mm)/2;
        const lead = t(ctx.wasm.Manifold.cylinder(.8,r-.25,r,64));
        const shaft = t(t(ctx.wasm.Manifold.cylinder(6,r,r,64)).translate([0,0,.8]));
        const pin = t(lead.add(shaft));
        // Pin is assembled through the unchanged body socket, but laid beside the cap for printing.
        const pinAt = ctx.presentation ? [0,0,24.7] : [bb.max[0]+delta[0]+5,0,0];
        solids.push({ name: 'Mount pin · baseball · insert into cap and pumpkin', solid: pin.translate(pinAt), color: p.hat_color });
      }
      if(p.hat_supports && !ctx.presentation) {
        const support=integratedSupports(ctx.wasm,assembled);
        if(support) { t(support); solids.push({name:`Support · ${p.topper} · remove after printing`,solid:support.translate(delta),color:p.hat_color}); }
      }
    }
    if (!solids.length) throw new Error('Choose a hat or include the pumpkin in your download.');
    success = true;
    return {
      solids,
      title: `Happy pumpkin${p.topper === 'none' ? '' : ` · ${p.topper} hat`}`,
      filenameBase: `happy-pumpkin-${p.topper}-${p.export_parts}`,
      warnings: [
        'Original happy pumpkin: 45.95 × 45.99 × 29.95 mm, unchanged round 4 mm socket. The round peg has adjustable diameter clearance; physical fit has not been print-tested.',
        ...(supportedHat ? ['The flat outer hat base surrounds an internal pumpkin mould with 0.2 mm vertical clearance. The recess and hanging details may need supports when printed upright.' + (p.topper === 'baseball' ? ' The cap uses a separate mounting pin; glue its cap end if needed.' : '')] : []),
        'Size and planning figures describe the laid-out download parts. Realistic preview shows how they assemble.',
        p.export_parts === 'pumpkin' || p.topper === 'none' ? 'The pumpkin prints without added supports. Inspect bridges and overhangs in the layer preview.' : p.hat_supports ? 'Removable support posts are included beneath the hat seat, brim and hanging details. Print at 0.16 mm layers and remove the support solids after printing. The pumpkin has no added supports. Finished preview hides supports; physical removal has not been tested.' : 'Hat supports are omitted. Inspect the hat seat, brim and hanging details in your slicer and add supports where needed. The pumpkin has no added supports.',
        'Use an LED light only, never a flame.'
      ],
      slicerSettings: { enable_support: supportedHat && !p.hat_supports ? '1' : '0', support_type: 'tree(auto)', support_on_build_plate_only: '0' }
    };
  } finally {
    temps.forEach(o => o.delete());
    if (!success) solids.forEach(s => s.solid.delete());
  }
}
