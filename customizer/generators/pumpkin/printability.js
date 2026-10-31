// Planar face checks in the exported upright orientation (+Y becomes +Z). Design heuristics,
// not a slicer or a promise about the curved shell's complete support requirements.
const EPS = 1e-5;
export const BRIDGE_SPAN_MM = 10;
export const FACE_RIB_MM = 1.2;
export const BREAKAWAY_CONTACT_MM = 0.45;
const signedArea = points => points.reduce((a, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length];
  return a + x * ny - nx * y;
}, 0) / 2;

export function faceOverhangs(cs, { bridges = false } = {}) {
  let shallowRoofMm = 0, islands = 0, hangingTips = 0;
  for (const points of cs?.toPolygons() ?? []) {
    if (signedArea(points) < 0) { islands++; continue; }
    let shallowSpan = 0;
    // Start at a non-roof edge so a roof crossing index zero is counted together.
    const start = points.findIndex(([x], i) => x <= points[(i + 1) % points.length][0] + EPS);
    for (let k = 0; k <= points.length; k++) {
      const i = (Math.max(0, start) + k) % points.length;
      const [x, y] = points[i], [nx, ny] = points[(i + 1) % points.length];
      // On a CCW opening contour, a right-to-left edge has pumpkin material above it.
      const span = x - nx;
      if (span > EPS && Math.abs(ny - y) + EPS < span) shallowSpan += span;
      else {
        if (!bridges || shallowSpan > BRIDGE_SPAN_MM + EPS) shallowRoofMm += shallowSpan;
        shallowSpan = 0;
      }
      const [px, py] = points[(i + points.length - 1) % points.length];
      // A downward tooth can have perfectly steep sides and still begin in mid-air.
      // Detect local minima along the roof, independently of the edge-angle check.
      if (k < points.length && px > x + EPS && nx < x - EPS && py > y + EPS && ny > y + EPS) hangingTips++;
    }
  }
  return { shallowRoofMm, islands, hangingTips };
}

export function printableFeature(CrossSection, cs, t) {
  const pieces = cs.decompose().map(t);
  const adapted = pieces.map(piece => {
    // Keep the outline. Material ribs support downward teeth and islands; short
    // roofs bridge between their original sides instead of becoming peaked cones.
    const { min, max } = piece.bounds();
    const ribs = [];
    const rib = (x, top) => {
      if (top <= min[1] + EPS) return;
      // Find the actual roof at this column, not the component bounding box.
      // A narrow neck at that roof makes the support removable after printing.
      const hits = [];
      for (const points of piece.toPolygons()) for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
        if ((ax <= x && bx > x) || (bx <= x && ax > x)) hits.push(ay + (by - ay) * (x - ax) / (bx - ax));
      }
      const roofs = hits.filter(y => y <= top + EPS);
      const roof = roofs.length ? Math.max(...roofs) : top;
      const neck = Math.max(min[1], roof - 0.8);
      ribs.push(t(CrossSection.ofPolygons([[
        [x - FACE_RIB_MM / 2, min[1] - 1], [x + FACE_RIB_MM / 2, min[1] - 1],
        [x + FACE_RIB_MM / 2, neck - 0.4], [x + BREAKAWAY_CONTACT_MM / 2, neck],
        [x + BREAKAWAY_CONTACT_MM / 2, roof + 0.05], [x - BREAKAWAY_CONTACT_MM / 2, roof + 0.05],
        [x - BREAKAWAY_CONTACT_MM / 2, neck], [x - FACE_RIB_MM / 2, neck - 0.4]
      ]])));
    };
    for (const points of piece.toPolygons()) {
      if (signedArea(points) < 0) {
        const bottom = points.reduce((a, b) => b[1] < a[1] ? b : a);
        rib(bottom[0], bottom[1] + FACE_RIB_MM);
        continue;
      }
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i], [px, py] = points[(i + points.length - 1) % points.length], [nx, ny] = points[(i + 1) % points.length];
        if (px > x + EPS && nx < x - EPS && py > y + EPS && ny > y + EPS) rib(x, y + FACE_RIB_MM);
        // A horizontal bottom on a downward detail also starts in mid-air.
        if (x > nx + EPS && Math.abs(ny - y) < EPS) {
          const after = points[(i + 2) % points.length];
          if (py > y + EPS && after[1] > y + EPS) rib((x + nx) / 2, y + FACE_RIB_MM);
        }
      }
    }
    if (max[0] - min[0] > BRIDGE_SPAN_MM && faceOverhangs(piece).shallowRoofMm > EPS) {
      const count = Math.ceil((max[0] - min[0]) / BRIDGE_SPAN_MM);
      for (let i = 1; i < count; i++) rib(min[0] + (max[0] - min[0]) * i / count, max[1] + 1);
    }
    return ribs.length ? t(piece.subtract(t(CrossSection.union(ribs)))) : piece;
  });
  return t(CrossSection.union(adapted));
}

export function facePrintWarnings(p, faceStyle, parts, glueIn) {
  const warnings = [];
  if (faceStyle === 'none') return warnings;
  if (faceStyle === 'cutout' && p.optimize_cutouts !== false) {
    warnings.push('Cutouts preserve the original curves and details, using bridges up to 10 mm and break-away supports for wider roofs and hanging details. Remove the narrow supports from the face openings after printing; their 0.45 mm roof contacts are designed to snap away. Bridge quality and support removal depend on material, cooling and slicer settings. Curved roof overhangs may still need slicer supports. This does not make the whole pumpkin support-free: inspect the curved shell, face bridges and support removal in your slicer preview.');
  }
  const risk = faceOverhangs(parts.main, { bridges: faceStyle === 'cutout' && p.optimize_cutouts !== false });
  if (faceStyle !== 'cutout') {
    const accentRisk = faceOverhangs(parts.accent);
    risk.shallowRoofMm += accentRisk.shallowRoofMm;
    risk.islands += accentRisk.islands;
    risk.hangingTips += accentRisk.hangingTips;
  }
  if (risk.shallowRoofMm <= EPS && !risk.islands && !risk.hangingTips) return warnings;
  if (faceStyle === 'cutout') {
    warnings.push('Unsupported face roof: this outline has shallow overhangs or hanging details when printed upright. Turn on Optimize cutouts for printing, or add and inspect supports in the slicer. Build-plate-only trees may not reach face roofs; allow supports on the model where needed and check that they can be removed through an opening.');
  } else if (glueIn) {
    warnings.push('The glue-in face leaves empty pockets while the pumpkin prints: pocket roofs can overhang, and a full-depth pocket in a hollow wall can need supports. The loose pieces do not support these roofs during printing. Inspect supports and access before slicing.');
  } else if (faceStyle === 'engraved') {
    warnings.push('The engraved recess has a roof that prints as a short cantilever over its depth. Inspect these face overhangs in the slicer; reduce engraving depth or add removable supports if needed.');
  }
  return warnings;
}
