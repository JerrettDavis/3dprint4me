// Free text placement for the display sign: a block of one to several lines, in the built-in block
// font or a real font, sized by capital-letter height, aligned to an anchor, shrunk to a maximum
// width, rotated about the anchor and moved to (x, y). The anchor's x is the text's left edge,
// middle or right edge; its y is the middle of the capital-letter band of the whole block.
// `t` registers temporaries; the result is registered too.
import { blockLineAtBaseline, capRatio, fontDrawable, fontLineAtBaseline, unsupportedBlockChars } from "../../framework/text.js";

const BLOCK_CAP_UNITS = 7;     // the block font's capital height in cell units
const LINE_PITCH = 1.5;        // distance between baselines, in capital heights

/**
 * Returns { cs, cap, skipped, substituted }: `cap` is the printed capital height in mm (0 when
 * nothing is drawable), `skipped` is true when a real font lacked some characters,
 * `substituted` is true when the block font replaced some with '?'.
 */
export function placeText(CrossSection, face, raw, { size, align, fit, rot, x, y }, t) {
  const source = String(raw ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  const capUnits = face ? capRatio(face) * 1000 : BLOCK_CAP_UNITS;
  let skipped = false, substituted = false;
  const rows = [];
  for (const line of source) {
    let cs = null;
    if (face) {
      const drawable = fontDrawable(line, face);
      skipped ||= drawable.skipped;
      if (drawable.text.trim()) cs = fontLineAtBaseline(CrossSection, face, drawable.text.trim());
    } else {
      const folded = line.normalize("NFD").replace(/\p{M}/gu, "");
      substituted ||= unsupportedBlockChars(folded).length > 0;
      cs = blockLineAtBaseline(CrossSection, folded);
    }
    if (cs) rows.push(t(cs));
  }
  if (!rows.length) return { cs: t(CrossSection.union([])), cap: 0, skipped, substituted };
  const pitch = capUnits * LINE_PITCH;
  const placed = rows.map((row, i) => {
    const b = row.bounds();
    const dx = align === "left" ? -b.min[0] : align === "right" ? -b.max[0] : -(b.min[0] + b.max[0]) / 2;
    return t(row.translate([dx, -i * pitch]));
  });
  const block = t(CrossSection.union(placed));
  const bb = block.bounds();
  let k = size / capUnits;
  const width = (bb.max[0] - bb.min[0]) * k;
  if (fit > 0 && width > fit) k *= fit / width;
  const middle = (capUnits - (rows.length - 1) * pitch) / 2;
  let out = t(t(block.translate([0, -middle])).scale([k, k]));
  if (rot) out = t(out.rotate(rot));
  return { cs: t(out.translate([x, y])), cap: capUnits * k, skipped, substituted };
}
