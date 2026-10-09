// Pumpkin stem: a lofted, fluted, curled column on a round flange (local z = 0 is the flange's
// flat underside), optionally with a D-keyed peg below it. The same flange outline cuts the pocket
// in the pumpkin, so a stem fits flush whether it is printed attached or plugged in.
import { solidFromMesh } from "./mesh.js";

const TAU = Math.PI * 2;
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Outline numbers shared by the stem, its pocket and the peg hole. */
export function stemSizes(p, pocketDepth) {
  const w = p.stem_width_mm;
  const pegR = p.peg_diameter_mm / 2;
  const flangeR = Math.max(w / 2 * 1.35, p.stem === "peg" ? pegR + 3 : 0);
  return { w, pegR, flangeR, flangeH: pocketDepth + 1.5, height: p.stem_height_mm };
}

// Outline radius of a circle with a flat on the -X side (a "D"), so a peg only goes in one way.
const KEY_FLAT = 0.72;
const dRadius = (r, th) => { const c = Math.cos(th); return c < -KEY_FLAT ? r * KEY_FLAT / -c : r; };

/**
 * The stem as a Manifold: flange underside at z = 0, optionally with the keyed peg built into the
 * same surface below it (no boolean on the flat underside, so no sliver triangles there).
 */
export function stemBody(wasm, p, pocketDepth, withPeg = false) {
  const { w, pegR, flangeR, flangeH, height } = stemSizes(p, pocketDepth);
  const ridges = p.stem_ridges, bend = p.stem_bend_pct / 100;
  const rings = [];
  if (withPeg) rings.push({ z: -p.peg_length_mm, r: pegR * 0.86, cx: 0, amp: 0, key: true }, { z: 0, r: pegR, cx: 0, amp: 0, key: true });
  rings.push({ z: 0, r: flangeR, cx: 0, amp: 0 }, { z: flangeH, r: flangeR, cx: 0, amp: 0 });
  const zb = flangeH + Math.max(0.5, flangeR - w / 2);
  rings.push({ z: zb, r: w / 2, cx: 0, amp: 0 });
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    rings.push({ z: zb + u * height, r: (w / 2) * (1 - 0.22 * u) * (1 + 0.14 * smooth((u - 0.88) / 0.12)), cx: bend * height * 0.35 * u * u, amp: smooth(u / 0.12) });
  }
  const nu = Math.max(48, ridges * 8);
  const verts = rings.length * nu + 2;
  const pos = new Float32Array(verts * 3);
  rings.forEach((ring, j) => {
    for (let i = 0; i < nu; i++) {
      const th = TAU * i / nu;
      const flute = 1 - 0.1 * ring.amp * (0.5 - 0.5 * Math.cos(ridges * th));
      const radius = ring.key ? dRadius(ring.r, th) : ring.r * flute;
      const o = (j * nu + i) * 3;
      pos[o] = ring.cx + radius * Math.cos(th);
      pos[o + 1] = radius * Math.sin(th);
      pos[o + 2] = ring.z;
    }
  });
  const bottom = rings.length * nu, top = bottom + 1;
  pos.set([0, 0, rings[0].z], bottom * 3);
  const last = rings[rings.length - 1];
  pos.set([last.cx, 0, last.z], top * 3);
  const idx = new Uint32Array(((rings.length - 1) * nu * 2 + nu * 2) * 3);
  let t = 0;
  const tri = (a, b, c) => { idx[t++] = a; idx[t++] = b; idx[t++] = c; };
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    tri(bottom, i1, i);
    for (let j = 0; j < rings.length - 1; j++) {
      const a = j * nu + i, b = j * nu + i1, c = (j + 1) * nu + i1, d = (j + 1) * nu + i;
      tri(a, b, c); tri(a, c, d);
    }
    const lo = (rings.length - 1) * nu;
    tri(top, lo + i, lo + i1);
  }
  return solidFromMesh(wasm, { pos, idx }, "stem");
}

// A circle with a flat on the -X side, so the peg only goes in one way.
function keyedPeg(CrossSection, r, t) {
  const disc = t(CrossSection.circle(r, 40));
  const keep = t(t(CrossSection.square([(1 + KEY_FLAT) * r, 2.4 * r], false)).translate([-KEY_FLAT * r, -1.2 * r]));
  return t(disc.intersect(keep));
}

/** The hole for the peg, from z = 0 downward `depth` mm (opened a little upward to cut clean). The caller owns the result. */
export function pegHole(wasm, p, depth, t) {
  const { CrossSection } = wasm;
  const profile = keyedPeg(CrossSection, p.peg_diameter_mm / 2, t);
  const grown = t(profile.offset(p.peg_clearance_mm, "Round", 2, 24));
  return t(grown.extrude(depth + 1)).translate([0, 0, -depth]);
}
