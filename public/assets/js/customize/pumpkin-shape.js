// Pumpkin shape math. Pure and isomorphic (no Manifold, no DOM): the definition's rules use it to
// keep settings printable and the builder uses it to lay out the surface. The body is a closed
// surface of rings (poles at the ends): a superellipse meridian with a stem dimple and pear taper,
// `segments` lobes modulated around it, an optional texture along the surface normal, and a plan
// stretch. Units are mm; z is up with the center of the unflattened body at 0.
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const mod = (i, n) => ((i % n) + n) % n;

function rng(seed) {
  let s = (Math.trunc(seed) >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MIN_BASE_RADIUS_MM = 15;       // flat base at least 30 mm across (bed adhesion)
export const TEALIGHT_OPENING_MM = 41;      // 38 mm tealight + clearance
export const TEALIGHT_HEIGHT_MM = 17;
const DIP_WIDTH = 0.42;                     // stem dimple width (radians from the top pole)
const FADE_FROM = 0.1;                      // texture fades out below this fraction of the radius

/** Derived dimensions and sampling functions for a validated parameter set. */
export function geometry(p) {
  const a = p.diameter_mm / 2;
  const H = p.diameter_mm * p.height_pct / 100;
  const b = H / 2;
  const e = 2 / (2 + 3 * p.boxiness_pct / 100);
  const taper = p.taper_pct / 100;
  const ob = p.oblong_pct / 100;
  const dip = p.dimple_pct / 100 * H;
  const k = p.segments | 0;
  const depth = p.rib_depth_pct / 100;
  const pw = p.rib_sharpness;
  const twist = p.twist_deg * Math.PI / 180;
  const irr = p.irregularity_pct / 100;
  const rand = rng((p.seed | 0) * 7919 + k);
  const depthTab = Array.from({ length: k }, () => 1 + irr * (rand() - 0.5) * 1.2);
  const sizeTab = Array.from({ length: k }, () => 1 + irr * (rand() - 0.5) * 0.16);

  const deco = p.decoration;
  const textured = deco === "ridges" || deco === "knit";
  const tex = textured ? p.texture_depth_mm : 0;
  const cols = deco === "knit" ? k * p.knit_per_lobe : deco === "ridges" ? k * p.fine_ridges : 0;
  const colPitch = cols ? TAU * a / cols : 1;
  const rowPitch = colPitch * 0.9;

  /** Meridian point at angle phi from the bottom pole (0) to the top pole (pi). */
  function profile(phi) {
    const s = Math.sin(phi), c = Math.cos(phi);
    const rho = a * Math.pow(Math.max(s, 0), e) * (1 + taper * c);
    const u = Math.PI - phi;
    const z = -b * Math.sign(c) * Math.pow(Math.abs(c), e) - dip * Math.exp(-((u / DIP_WIDTH) ** 2));
    return { rho, z };
  }

  /** Lobe multiplier (1 at a crest, 1 - depth in a groove) at azimuth theta and phi. */
  function lobe(theta, phi) {
    const th = theta + twist * (phi / Math.PI - 0.5);
    const x = th * k / TAU;
    const i0 = Math.floor(x), sm = smooth(x - i0);
    const dv = depthTab[mod(i0, k)] * (1 - sm) + depthTab[mod(i0 + 1, k)] * sm;
    const sv = sizeTab[mod(i0, k)] * (1 - sm) + sizeTab[mod(i0 + 1, k)] * sm;
    const groove = Math.pow(Math.cos(Math.PI * x) ** 2, pw);
    return (1 - depth * dv * groove) * sv;
  }

  function stitch(u, v) {
    // Two legs of a V in mm inside one cell (u across, v up); neighbours are checked so legs
    // continue across the cell edge.
    const thick = 0.2 * colPitch;
    let best = Infinity;
    for (const du of [-1, 0, 1]) {
      const px = (u + du) * colPitch, py = v * rowPitch;
      for (const sign of [-1, 1]) {
        const ax = 0.5 * colPitch, ay = 0;
        const bx = (0.5 + sign * 0.36) * colPitch, by = rowPitch;
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
      }
    }
    return smooth(1 - best / thick);
  }

  /** Outward texture displacement (mm) at azimuth theta, phi, arc length and local radius. */
  function texture(theta, phi, arc, rho) {
    if (!tex) return 0;
    const fade = smooth((rho / a - FADE_FROM) / 0.2);
    if (!fade) return 0;
    const th = theta + twist * (phi / Math.PI - 0.5);
    if (deco === "ridges") return -tex * (0.5 - 0.5 * Math.cos(cols * th)) * fade;
    const u = th * cols / TAU;
    return tex * (stitch(u - Math.floor(u), (arc / rowPitch) % 1) - 0.4) * fade;
  }

  return { a, b, H, k, depth, ob, dip, e, taper, tex, cols, rowPitch, profile, lobe, texture, deco, twist };
}

/** Rings spaced evenly by arc length along the meridian: phi, rho, z, outward normal, arc. */
export function meridian(g, count) {
  const N = 1440;
  const arcs = new Float64Array(N + 1);
  let prev = g.profile(0);
  for (let i = 1; i <= N; i++) {
    const cur = g.profile(Math.PI * i / N);
    arcs[i] = arcs[i - 1] + Math.hypot(cur.rho - prev.rho, cur.z - prev.z);
    prev = cur;
  }
  const total = arcs[N];
  const rings = [];
  let j = 0;
  for (let r = 0; r <= count; r++) {
    const target = total * r / count;
    while (j < N - 1 && arcs[j + 1] < target) j++;
    const span = arcs[j + 1] - arcs[j];
    const phi = Math.PI * (j + (span > 0 ? (target - arcs[j]) / span : 0)) / N;
    const pt = g.profile(phi);
    const h = 1e-4;
    const lo = g.profile(Math.max(0, phi - h)), hi = g.profile(Math.min(Math.PI, phi + h));
    const dr = hi.rho - lo.rho, dz = hi.z - lo.z, len = Math.hypot(dr, dz) || 1;
    rings.push({ phi, rho: pt.rho, z: pt.z, nr: dz / len, nz: -dr / len, arc: target });
  }
  return { rings, total };
}

/** Samples around and rows along the surface needed for the lobes and the texture. */
export function resolution(p) {
  const k = p.segments | 0;
  const spp = clamp(8 + 3 * p.rib_sharpness, 14, 36);
  let perLobe = spp, rows = 56;
  if (p.decoration === "knit") perLobe = Math.max(spp, p.knit_per_lobe * 8);
  if (p.decoration === "ridges") perLobe = Math.max(spp, p.fine_ridges * 8);
  while (k * perLobe * rows > 90000 && perLobe > 12) perLobe--;
  let nu = k * perLobe;
  if (p.decoration === "knit") {
    const g = geometry(p);
    const { total } = meridian(g, 200);
    rows = clamp(Math.round(total / g.rowPitch) * 8, 56, 320);
    while (nu * rows > 90000 && rows > 60) rows -= 4;
  }
  return { nu, rows };
}

/**
 * The closed surface as flat arrays: positions (xyz triples) and triangle indices, counter
 * clockwise from outside. Ring 0 and the last ring are single pole vertices.
 */
export function surfaceMesh(g, { nu, rows }, { withTexture = true } = {}) {
  const { rings } = meridian(g, rows);
  const verts = 2 + (rows - 1) * nu;
  const pos = new Float32Array(verts * 3);
  const idx = new Uint32Array((2 * nu + 2 * (rows - 2) * nu) * 3);
  pos.set([0, 0, rings[0].z], 0);
  const ringBase = j => (j === 0 ? 0 : j === rows ? verts - 1 : 1 + (j - 1) * nu);
  for (let j = 1; j < rows; j++) {
    const r = rings[j];
    for (let i = 0; i < nu; i++) {
      const th = TAU * i / nu;
      let rho = r.rho * g.lobe(th, r.phi), z = r.z;
      if (withTexture) { const d = g.texture(th, r.phi, r.arc, r.rho); rho += d * r.nr; z += d * r.nz; }
      const o = (ringBase(j) + i) * 3;
      pos[o] = rho * Math.cos(th) * (1 + g.ob);
      pos[o + 1] = rho * Math.sin(th) * (1 - g.ob);
      pos[o + 2] = z;
    }
  }
  pos.set([0, 0, rings[rows].z], (verts - 1) * 3);
  let t = 0;
  const tri = (a, b, c) => { idx[t++] = a; idx[t++] = b; idx[t++] = c; };
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    tri(0, ringBase(1) + i1, ringBase(1) + i);
    for (let j = 1; j < rows - 1; j++) {
      const a = ringBase(j) + i, b = ringBase(j) + i1, c = ringBase(j + 1) + i1, d = ringBase(j + 1) + i;
      tri(a, b, c); tri(a, c, d);
    }
    tri(verts - 1, ringBase(rows - 1) + i, ringBase(rows - 1) + i1);
  }
  return { pos, idx };
}

/** phi (0..pi/2) where the body is `radius` wide, searched from the bottom pole upwards. */
function lowerCrossing(g, radius) {
  let lo = 0, hi = Math.PI / 2;
  if (g.profile(hi).rho <= radius) return hi;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; (g.profile(mid).rho < radius ? (lo = mid) : (hi = mid)); }
  return (lo + hi) / 2;
}

/** The flat-base plane: the height where the body is as wide as the base should be. */
export function baseCut(p, g = geometry(p)) {
  const radius = clamp(Math.max(MIN_BASE_RADIUS_MM, p.flat_base_pct / 100 * g.a), 1, g.a * 0.94);
  const phi = lowerCrossing(g, radius);
  return { z: g.profile(phi).z, radius };
}

/** The upper plane for an opening of the given width: first crossing from the equator up. */
export function openCut(p, g = geometry(p)) {
  const radius = p.opening_pct / 100 * g.a;
  let lo = Math.PI / 2, hi = Math.PI;
  if (g.profile(lo).rho <= radius) return { z: g.profile(lo).z, radius };
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; (g.profile(mid).rho > radius ? (lo = mid) : (hi = mid)); }
  return { z: g.profile((lo + hi) / 2).z, radius };
}

/** The bowl/lid split plane: a fraction of the height above the flat base. */
export function splitCut(p, g = geometry(p)) {
  const base = baseCut(p, g).z;
  const top = g.b;
  return { z: base + (top - base) * p.split_pct / 100 };
}

/** Per-axis scale of the inner copy that leaves roughly `wall` mm of shell. */
export function cavityScale(p, g = geometry(p)) {
  const w = p.wall_mm;
  return [1 - w / (g.a * (1 + g.ob)), 1 - w / (g.a * (1 - g.ob)), 1 - w / g.b];
}

/** Whether the model is hollow and where it opens. */
export function openings(p) {
  const hollow = p.style === "hollow" || p.style === "bowl";
  return { hollow, bottom: p.style === "hollow" && p.opening === "bottom", top: p.style === "hollow" && p.opening === "top" };
}

/** Narrowest cavity width where a tealight sits (just above the floor) and the cavity height. */
export function tealightFit(p) {
  const g = geometry(p);
  const sc = cavityScale(p, g);
  const base = baseCut(p, g).z;
  const floor = Math.max(base, -g.b * sc[2]) + 0.6;
  let lo = 0, hi = Math.PI / 2;
  const level = phi => sc[2] * g.profile(phi).z;
  if (level(hi) < floor) return { opening: 0, height: 0 };
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; (level(mid) < floor ? (lo = mid) : (hi = mid)); }
  const rho = Math.min(sc[0], sc[1]) * g.profile((lo + hi) / 2).rho * (1 - g.depth * 1.15);
  const ceiling = sc[2] * (g.b - g.dip);
  return { opening: 2 * rho, height: ceiling - base };
}

/** Smallest diameter (mm) at which the tealight fits with every other setting unchanged. */
export function minTealightDiameter(p, max = 200) {
  for (let d = 50; d <= max; d++) {
    const fit = tealightFit({ ...p, diameter_mm: d });
    if (fit.opening >= TEALIGHT_OPENING_MM && fit.height >= TEALIGHT_HEIGHT_MM) return d;
  }
  return null;
}

/** Face metrics shared by the rules and the builder (mm). */
export function faceBox(p, g = geometry(p)) {
  const width = p.face_size_pct / 100 * p.diameter_mm * 0.75;
  const base = baseCut(p, g).z;
  const centerZ = base + p.face_height_pct / 100 * (g.b - base);
  return { width, centerZ, top: centerZ + width * 0.32, bottom: centerZ - width * 0.42 };
}
