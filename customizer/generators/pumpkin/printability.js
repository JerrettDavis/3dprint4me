// Planar face checks in the exported upright orientation (+Y becomes +Z). Design heuristics,
// not a slicer or a promise about the curved shell's complete support requirements.
const EPS = 1e-5;
const signedArea = points => points.reduce((a, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length];
  return a + x * ny - nx * y;
}, 0) / 2;

export function faceOverhangs(cs) {
  let shallowRoofMm = 0, islands = 0, hangingTips = 0;
  for (const points of cs?.toPolygons() ?? []) {
    if (signedArea(points) < 0) { islands++; continue; }
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i], [nx, ny] = points[(i + 1) % points.length];
      // On a CCW opening contour, a right-to-left edge has pumpkin material above it.
      const span = x - nx;
      if (span > EPS && Math.abs(ny - y) + EPS < span) shallowRoofMm += span;
      const [px, py] = points[(i + points.length - 1) % points.length];
      // A downward tooth can have perfectly steep sides and still begin in mid-air.
      // Detect local minima along the roof, independently of the edge-angle check.
      if (px > x + EPS && nx < x - EPS && py > y + EPS && ny > y + EPS) hangingTips++;
    }
  }
  return { shallowRoofMm, islands, hangingTips };
}

export function printableFeature(CrossSection, cs, t) {
  const pieces = cs.decompose().map(t);
  const adapted = pieces.map(piece => {
    // Convexity removes hanging teeth/interior islands. A downward 90° cone at the top
    // clips every roof to at least 45°. Adapt disconnected features independently.
    const hull = t(piece.hull());
    const { min, max } = hull.bounds();
    const top = hull.toPolygons().flat().filter(([, y]) => Math.abs(y - max[1]) < EPS);
    const apexX = top.reduce((sum, [x]) => sum + x, 0) / top.length;
    const reach = 2 * (max[0] - min[0] + max[1] - min[1] + 1);
    const roof = t(CrossSection.ofPolygons([[
      [apexX, max[1]], [apexX - reach, max[1] - reach], [apexX + reach, max[1] - reach]
    ]]));
    return t(hull.intersect(roof));
  });
  return t(CrossSection.union(adapted));
}

export function facePrintWarnings(p, faceStyle, parts, glueIn) {
  const warnings = [];
  if (faceStyle === 'none') return warnings;
  if (faceStyle === 'cutout' && p.optimize_cutouts !== false) {
    warnings.push('Cutouts are reshaped with peaked roofs of at least 45° for upright printing; hanging teeth and concave details are simplified. This does not make the whole pumpkin support-free: check the curved shell and face in your slicer preview.');
  }
  const risk = faceOverhangs(parts.main);
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
