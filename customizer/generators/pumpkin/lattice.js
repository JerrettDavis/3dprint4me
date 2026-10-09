// Lattice: rows of diamond, round or slot holes cut through a hollow pumpkin. Each hole is a
// prism along the surface normal at its place, sized from the local spacing so the bars between
// holes stay at least MIN_BAR wide, and holes shrink toward the poles with the circumference.
import { meridian } from "../../../public/assets/js/customize/pumpkin-shape.js";

const TAU = Math.PI * 2;
export const MIN_BAR = 1.6;
const BOTTOM_KEEP = 3.5;       // solid band left above the flat base
const TOP_PHI = 0.75;          // radians from the top pole kept free of holes (stem dimple)

/** Union of all hole prisms as a Manifold (the caller owns it), or null when none fit. */
export function latticeCutter(wasm, p, g, zBase, wall, t) {
  const { CrossSection, Manifold } = wasm;
  const { rings } = meridian(g, 400);
  const arcAt = pred => { const r = rings.find(pred); return r ? r.arc : null; };
  const arcLo = arcAt(r => r.phi > Math.PI / 2 * 0.3 && r.z >= zBase + 4);
  const arcHi = arcAt(r => r.phi >= Math.PI - TOP_PHI);
  if (arcLo == null || arcHi == null || arcHi <= arcLo) return null;
  const rows = p.lattice_rows, cols = p.lattice_cols, open = p.lattice_open_pct / 100;
  const pitchV = (arcHi - arcLo) / rows;
  const ringAtArc = arc => {
    let lo = 0;
    while (lo < rings.length - 2 && rings[lo + 1].arc < arc) lo++;
    const a = rings[lo], b = rings[lo + 1], f = (arc - a.arc) / ((b.arc - a.arc) || 1);
    const mix = k => a[k] + (b[k] - a[k]) * f;
    const nr = mix("nr"), nz = mix("nz"), len = Math.hypot(nr, nz) || 1;
    return { rho: mix("rho"), z: mix("z"), phi: mix("phi"), nr: nr / len, nz: nz / len };
  };
  const kind = p.lattice_shape;
  const prisms = [];
  const lenIn = wall + 4, lenOut = 4;
  for (let j = 0; j < rows; j++) {
    const row = ringAtArc(arcLo + (j + 0.5) * pitchV);
    const pitchU = TAU * row.rho / cols;
    const stagger = kind === "slot" ? 0 : (j % 2 ? 0.5 : 0);
    let cs;
    if (kind === "diamond") {
      const w = Math.min(open * pitchU, pitchU - MIN_BAR), h = Math.min(open * 2 * pitchV, 2 * pitchV - MIN_BAR * 1.4);
      if (w < 3 || h < 3) continue;
      cs = t(CrossSection.ofPolygons([[[w / 2, 0], [0, h / 2], [-w / 2, 0], [0, -h / 2]]]));
    } else if (kind === "round") {
      const dist = Math.min(pitchU, Math.hypot(pitchU / 2, pitchV));
      const d = Math.min(open * pitchU, dist - MIN_BAR);
      if (d < 3) continue;
      cs = t(CrossSection.circle(d / 2, 28));
    } else {
      const w = Math.min(open * pitchU * 0.6, pitchU - MIN_BAR);
      if (w < 2.4) continue;
      cs = t(CrossSection.square([w, pitchV * 1.25], true));
    }
    const prism = t(cs.extrude(lenIn + lenOut));
    for (let i = 0; i < cols; i++) {
      const th = TAU * (i + stagger) / cols - g.twist * (row.phi / Math.PI - 0.5);
      const c = Math.cos(th), s = Math.sin(th);
      const n = [row.nr * c, row.nr * s, row.nz];
      const m = [-row.nz * c, -row.nz * s, row.nr];
      const px = row.rho * c * (1 + g.ob) - n[0] * lenIn, py = row.rho * s * (1 - g.ob) - n[1] * lenIn, pz = row.z - n[2] * lenIn;
      prisms.push(t(prism.transform([-s, c, 0, 0, m[0], m[1], m[2], 0, n[0], n[1], n[2], 0, px, py, pz, 1])));
    }
  }
  if (!prisms.length) return null;
  const all = t(Manifold.union(prisms));
  const keepAbove = t(all.trimByPlane([0, 0, 1], zBase + BOTTOM_KEEP));
  return keepAbove.trimByPlane([0, 0, -1], -g.profile(Math.PI - TOP_PHI).z);
}
