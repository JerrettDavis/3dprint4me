import { referencePumpkin } from './reference.js';
import { buildTopper } from './toppers/index.js';
import { trimMask } from './toppers/trim.js';

export default function buildReference(p, ctx) {
  const solids = [], temps = [];
  const t = o => { temps.push(o); return o; };
  let success = false;
  try {
    if (p.export_parts !== 'hat' || ctx.presentation) {
      const body = referencePumpkin(ctx.wasm);
      solids.push({ name: 'Pumpkin · original happy', solid: body, color: p.body_color });
    }
    if (p.topper !== 'none' && (p.export_parts !== 'pumpkin' || ctx.presentation)) {
      const assembled = t(buildTopper(ctx.wasm, p.topper, { clearance: p.hat_clearance_mm }));
      const bb = assembled.boundingBox();
      const mask = t(trimMask(ctx.wasm,p.topper));
      const trim = t(assembled.intersect(mask));
      const main = t(assembled.subtract(mask));
      const delta = ctx.presentation ? [0,0,0] : [p.export_parts === 'hat' ? 0 : 32 - bb.min[0], 0, -bb.min[2]];
      solids.push({ name: `Hat · ${p.topper}`, solid: main.translate(delta), color: p.hat_color });
      if (!trim.isEmpty()) solids.push({ name: `Hat trim · ${p.topper}`, solid: trim.translate(delta), color: p.hat_trim_color });
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
        'Print the hat separately with supports under its moulded seat, brim and hanging details. Use 0.16 mm layers for the raised detail; inspect supports and layer preview before printing.',
        'The hollow pumpkin roof needs removable internal supports. Use an LED light only, never a flame.'
      ],
      slicerSettings: { enable_support: '1', support_type: 'tree(auto)', support_on_build_plate_only: '0' }
    };
  } finally {
    temps.forEach(o => o.delete());
    if (!success) solids.forEach(s => s.solid.delete());
  }
}
