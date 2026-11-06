import { referencePumpkin } from './reference.js';
import { buildTopper } from './toppers/index.js';
import { trimMask } from './toppers/trim.js';
import { integratedSupports } from './toppers/supports.js';

export default function buildReference(p, ctx) {
  const solids = [], temps = [];
  const t = o => { temps.push(o); return o; };
  let success = false;
  try {
    if (p.export_parts !== 'hat' || ctx.presentation) {
      const body = referencePumpkin(ctx.wasm);
      solids.push({ name: 'Pumpkin · original happy', solid: body, color: p.body_color });
      if (p.hat_supports && !ctx.presentation) {
        const support = integratedSupports(ctx.wasm,body);
        if(support) solids.push({ name:'Support · pumpkin · remove after printing', solid:support, color:p.body_color });
      }
    }
    if (p.topper !== 'none' && (p.export_parts !== 'pumpkin' || ctx.presentation)) {
      const assembled = t(buildTopper(ctx.wasm, p.topper, { clearance: p.hat_clearance_mm, crownDiameter:p.cap_crown_mm }));
      const bb = assembled.boundingBox();
      const mask = t(trimMask(ctx.wasm,p.topper,{crownDiameter:p.cap_crown_mm}));
      const trim = t(assembled.intersect(mask));
      const main = t(assembled.subtract(mask));
      const delta = ctx.presentation ? [0,0,0] : [p.export_parts === 'hat' ? 0 : 32 - bb.min[0], 0, -bb.min[2]];
      solids.push({ name: `Hat · ${p.topper}`, solid: main.translate(delta), color: p.hat_color });
      if (!trim.isEmpty()) solids.push({ name: `Hat trim · ${p.topper}`, solid: trim.translate(delta), color: p.hat_trim_color });
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
        'Size and planning figures describe the laid-out download parts. Realistic preview shows how they assemble.',
        p.hat_supports ? 'Removable support posts are included in the download beneath the moulded seat, brim, hanging details and hollow pumpkin roof. Print at 0.16 mm layers; remove the support solids after printing. Realistic preview shows the finished parts with supports removed. Inspect the layer preview and support access; removal has not been physically tested.' : 'Supports are omitted. Add supports in your slicer under the moulded seat, brim, hanging details and hollow roof; inspect the layer preview.',
        'Use an LED light only, never a flame.'
      ],
      slicerSettings: { enable_support: p.hat_supports ? '0' : '1', support_type: 'tree(auto)', support_on_build_plate_only: '0' }
    };
  } finally {
    temps.forEach(o => o.delete());
    if (!success) solids.forEach(s => s.solid.delete());
  }
}
