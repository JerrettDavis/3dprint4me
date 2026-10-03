export function roundedRect(CrossSection, w, h, r = 0) {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  if (rr <= 0) return CrossSection.square([w, h], true);
  const inner = CrossSection.square([w - 2 * rr, h - 2 * rr], true);
  return inner.offset(rr, "Round", 2, 48);
}

export function star(CrossSection, outerR, points = 5, innerRatio = 0.4) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : outerR * innerRatio;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return CrossSection.ofPolygons([pts]);
}

// A star clipped to the left `fraction` of its width (0..1) — for half-star ratings.
export function partialStar(CrossSection, outerR, fraction) {
  const full = star(CrossSection, outerR);
  if (fraction >= 1) return full;
  if (fraction <= 0) return CrossSection.union([]);
  const b = full.bounds();
  const x = b.min[0] + (b.max[0] - b.min[0]) * fraction;
  const keep = CrossSection.square([x - b.min[0] + 1e-6, b.max[1] - b.min[1] + 2], false).translate([b.min[0], b.min[1] - 1]);
  return full.intersect(keep);
}

export function circle(CrossSection, r, segments = 48) { return CrossSection.circle(r, segments); }
export function ring(CrossSection, outerR, innerR, segments = 48) { return circle(CrossSection, outerR, segments).subtract(circle(CrossSection, innerR, segments)); }
export function keyLoop(CrossSection, { outerR, holeR, cx, cy }) {
  return ring(CrossSection, outerR, holeR).translate([cx, cy]);
}
