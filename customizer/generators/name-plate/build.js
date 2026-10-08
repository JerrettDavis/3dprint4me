// Name plate geometry. The name is fitted into a box `height_mm` tall and at most 150 mm wide,
// then stacked on a plate:
//   plate "hug" (default): a contour stroke around the letters, `plate_margin_mm` (3 mm) wide, with
//     the valleys between tall and short letters filled so its top and bottom edges stay level at
//     that margin above the highest and below the lowest ink (see hugAround);
//   plate "pill" / "rect": a rounded plate `plate_margin_mm` larger than the name on every side;
//   plate "none": a thin backing that follows the letters (a morphological closing of the
//     name: grown far enough to bridge the gaps between letters, then shrunk back to a 1.6 mm
//     rim), so the letters print as one cut-out piece.
// Styles (T = total thickness, R = letter relief; colored parts never overlap):
//   raised:  plate T-R thick, letters R tall on top;
//   outline: raised, plus a 1.2 mm ring around the letters at letter height (outline color);
//   shadow:  raised, plus the letters shifted down-right, R/2 tall, under them (outline color);
//   inlay:   plate T thick with the letters inset R deep and filled flush (needs a plate).
// The keychain loop (outer radius 6, hole radius 2.75) sits at the left end: the ring never
// overlaps a letter, the loop reaches at least 3 mm into the plate (with a short bridge when the
// letters push the ring further left), and the hole is cut from every part. The plate (with the loop) must be one connected piece, or the build fails
// with a readable message. buildModel frees the returned solids; everything else is freed here.
import { roundedRect } from "../../framework/shapes.js";
import { blockText, fontText, fitCrossSection, unsupportedBlockChars } from "../../framework/text.js";
import { safeName } from "../../framework/model.js";

const MAX_WIDTH = 150;        // the name never gets wider than this (mm)
const PAD = 3;                // plate margin around the name (mm)
const RECT_RADIUS = 3;        // corner radius of the rectangle plate (mm)
const BACKING = 1.6;          // rim of the no-plate backing around the letters (mm)
const BRIDGE = [0.12, 6];     // no-plate backing bridges gaps up to 2 × min(0.12 × name height, 6) mm
const OUTLINE = 1.2;          // outline ring width (mm)
const SHADOW = [0.035, 0.9, 1.5]; // shadow shift: 0.035 × name height, clamped to 0.9–1.5 mm
const MIN_FEATURE = 0.4;      // shadow slivers thinner than this are dropped (mm)
const MIN_HEIGHT = 4;         // a name printed shorter than this is not legible: fail
const LOOP = Object.freeze({ outerR: 6, holeR: 2.75, overlap: 3 });
const SEGMENTS = 24;

export const SKIPPED = "Some characters aren't in this font and were skipped.";
export const NONE_AVAILABLE = "None of these characters are available in this font.";
export const SAME_COLOR = "With no plate, the backing is printed in the outline color too, so the outline or shadow shows only as a step in height. Choose a plate to give it its own color.";
export const DISCONNECTED = "The letters aren't connected — choose a plate or a bolder font.";
export const DISCONNECTED_BLOCK = "The letters aren't connected — choose a plate.";
export const THIN_STROKES = "Some strokes are thinner than 0.8 mm and may not print cleanly; increase the height or pick a bolder font.";
const MIN_STROKE = 0.8;       // strokes thinner than this may not print cleanly: warn
const THIN_LOSS = 0.02;       // ... when opening the letters by MIN_STROKE loses more than 2 % of their area
const NO_FILE = "Choose a font file below, or pick one of the listed fonts.";
const NOT_LOADED = "The selected font isn't loaded. Try again, or pick another font.";
const tooSmall = h => `The name would print only ${h.toFixed(1)} mm tall at the ${MAX_WIDTH} mm width limit, too small to read. Shorten it.`;

/**
 * The characters of `name` the font can draw, and whether any were left out. The block font
 * folds accents first (Zoë -> ZOE); a real font keeps a character only when it has a glyph for
 * it, so the font's "missing glyph" box is never drawn.
 */
export function drawableName(name, font) {
  const source = font ? String(name) : String(name).normalize("NFD").replace(/\p{M}/gu, "");
  const kept = [...source].filter(ch => (font ? font.charToGlyph(ch).index > 0 : unsupportedBlockChars(ch).length === 0));
  const skipped = kept.length !== [...source].length;
  return { text: kept.join("").trim(), skipped };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const MIN_OVERLAP = 0.4;      // a bridge must survive eroding by this: it overlaps both pieces, not just touches
const MIN_PIECE_AREA = 0.01;  // smaller "pieces" are numeric slivers, not geometry (mm²)
const BRIDGE_STEP = 0.5;     // closing radius resolution (mm), and the extra radius added to the one that just joins

// The connected pieces of a cross-section. Offsets leave zero-area slivers behind as extra
// "pieces"; those are dropped (and freed) here.
function solidPieces(cs) {
  const all = cs.decompose();
  return all.filter(piece => (piece.area() > MIN_PIECE_AREA ? true : (free(piece), false)));
}

/**
 * Joins the pieces of a no-plate backing (letters a word gap apart, or letters whose closing
 * didn't meet). Neighbouring pieces that both cross the name's centre band (max(2 × rim,
 * 0.25 × name height) tall) are joined by a morphological closing of just that pair: the gap
 * between them is filled from their own outlines, so a slanted letter (A, V, W...) is overlapped
 * along its whole edge, not only where the edge happens to be furthest out. The closing radius
 * is the smallest (plus a little) that joins them with real overlap rather than a touching corner,
 * and a closing never leaves the pair's convex hull, so nothing protrudes above or below the letters. Only the backing changes. Pieces that
 * never cross the centre band (stacked vertically) stay apart, and the caller reports them.
 * `t` registers temporaries; the result is registered too.
 */
export function bridgeBacking(CrossSection, backing, { cy, height }, t) {
  const pieces = solidPieces(backing);
  try {
    if (pieces.length < 2) return backing;
    const half = Math.max(2 * BACKING, 0.25 * height) / 2;
    const bb = backing.bounds();
    const band = t(t(CrossSection.square([bb.max[0] - bb.min[0] + 2, 2 * half], false)).translate([bb.min[0] - 1, cy - half]));
    const inBand = pieces
      .filter(piece => !t(piece.intersect(band)).isEmpty())
      .sort((a, b) => a.bounds().min[0] - b.bounds().min[0]);
    const limit = Math.max(2 * height, 12);
    const bridges = [];
    for (let i = 1; i < inBand.length; i++) {
      const pair = t(CrossSection.union([inBand[i - 1], inBand[i]]));
      const closing = r => t(t(pair.offset(r, "Round", 2, SEGMENTS)).offset(-r, "Round", 2, SEGMENTS));
      // Joined in earnest (not corner to corner) once one piece of the eroded closing holds
      // eroded parts of both.
      const coreA = t(inBand[i - 1].offset(-MIN_OVERLAP, "Round", 2, SEGMENTS));
      const coreB = t(inBand[i].offset(-MIN_OVERLAP, "Round", 2, SEGMENTS));
      const joined = r => {
        const parts = solidPieces(t(closing(r).offset(-MIN_OVERLAP, "Round", 2, SEGMENTS)));
        try { return parts.some(part => !t(part.intersect(coreA)).isEmpty() && !t(part.intersect(coreB)).isEmpty()); } finally { parts.forEach(free); }
      };
      // A closing only grows with its radius, so double until joined, then bisect.
      let hi = BRIDGE_STEP;
      while (hi <= limit && !joined(hi)) hi *= 2;
      if (hi > limit && !joined(limit)) continue;
      hi = Math.min(hi, limit);
      let lo = hi / 2;
      while (hi - lo > BRIDGE_STEP / 2) { const mid = (lo + hi) / 2; if (joined(mid)) hi = mid; else lo = mid; }
      bridges.push(closing(hi + BRIDGE_STEP));
    }
    if (!bridges.length) return backing;
    const joined = t(CrossSection.union([backing, ...bridges]));
    // Drop the zero-area slivers the offsets leave, so they cannot extrude into stray bodies.
    const solid = solidPieces(joined);
    try { return t(CrossSection.union(solid)); } finally { solid.forEach(free); }
  } finally {
    pieces.forEach(free);
  }
}

/**
 * The "contour" plate: a stroke around the whole name. The letters are grown by `margin` (round
 * joins) and a morphological closing with radius max(margin, ½ × name height) then fills the
 * valleys between tall and short letters, so a short letter next to tall ones gets no deep notch
 * and the top and bottom edges run almost straight at the margin above the highest and below the
 * lowest ink (a closing never leaves the convex hull of what it closes). The result is clipped to
 * exactly that band, every interior hole is filled (the plate is one solid body), and any pieces
 * left apart (a very wide word gap) are bridged like the no-plate backing.
 * `t` registers temporaries; the result is registered too.
 */
export function hugAround(CrossSection, text, margin, t) {
  const b = text.bounds();
  const h = b.max[1] - b.min[1];
  const grown = t(text.offset(margin, "Round", 2, SEGMENTS));
  const radius = Math.max(margin, 0.5 * h);
  // (The union keeps the margin exact even where the polygon approximation of the closing arcs shaves it.)
  const closed = t(CrossSection.union([grown, t(t(grown.offset(radius, "Round", 2, SEGMENTS)).offset(-radius, "Round", 2, SEGMENTS))]));
  const band = t(t(CrossSection.square([b.max[0] - b.min[0] + 2 * margin + 4, h + 2 * margin], false)).translate([b.min[0] - margin - 2, b.min[1] - margin]));
  const clipped = t(closed.intersect(band));
  // Keep outer contours only: fills every hole (counters of O, e, a...).
  const solid = clipped.toPolygons().filter(poly => poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return a + x * y2 - x2 * y; }, 0) > 2 * MIN_PIECE_AREA);
  const filled = t(CrossSection.ofPolygons(solid, "NonZero"));
  return bridgeBacking(CrossSection, filled, { cy: (b.min[1] + b.max[1]) / 2, height: h }, t);
}

/**
 * The shortest pill (height = name height + 2 pad, fully round ends) that keeps every point of
 * the name at least `pad` inside its edge. Each end's circle center is placed from the outline
 * itself, so letters near the rounded ends never poke out and short names get a round plate.
 */
export function pillAround(CrossSection, text, pad) {
  const b = text.bounds();
  const cy = (b.min[1] + b.max[1]) / 2, r = (b.max[1] - b.min[1]) / 2;
  let left = Infinity, right = -Infinity;
  for (const polygon of text.toPolygons()) for (const [x, y] of polygon) {
    const reach = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
    left = Math.min(left, x + reach);
    right = Math.max(right, x - reach);
  }
  if (left > right) left = right = (left + right) / 2;
  const R = r + pad;
  const shape = roundedRect(CrossSection, right - left + 2 * R, 2 * R, R);
  try { return shape.translate([(left + right) / 2, cy]); } finally { shape.delete(); }
}
const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export default async function build(p, { wasm, font = null } = {}) {
  const { CrossSection } = wasm;
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    if (p.font === "custom" && !font) throw new Error(NO_FILE);
    if (p.font !== "block" && p.font !== "custom" && !font) throw new Error(NOT_LOADED);
    const face = p.font === "block" ? null : font;
    const T = p.thickness_mm, R = p.relief_mm;
    const margin = p.plate_margin_mm ?? PAD;   // plate margin around the name (hug, pill, rect)

    // ---- The name, fitted into its box ----
    const { text: drawable, skipped } = drawableName(p.name, face);
    if (!drawable) throw new Error(NONE_AVAILABLE);
    if (skipped) warnings.push(SKIPPED);
    if (p.plate === "none" && (p.style === "outline" || p.style === "shadow")) warnings.push(SAME_COLOR);
    const raw = t(face ? fontText(CrossSection, face, drawable, { fillRule: "NonZero" }) : blockText(CrossSection, drawable));
    if (raw.isEmpty()) throw new Error(NONE_AVAILABLE);
    const text = t(fitCrossSection(raw, { maxWidth: MAX_WIDTH, maxHeight: p.height_mm, centerX: 0, centerY: 0 }));
    const tb = text.bounds();
    const w = tb.max[0] - tb.min[0], h = tb.max[1] - tb.min[1];
    if (h < MIN_HEIGHT) throw new Error(tooSmall(h));
    const cx = (tb.min[0] + tb.max[0]) / 2, cy = (tb.min[1] + tb.max[1]) / 2;
    // Strokes thinner than the nozzle comfortably prints vanish under an opening (erode, then
    // dilate, by half the minimum stroke): warn when that loses a noticeable share of the area.
    const opened = t(t(text.offset(-MIN_STROKE / 2, "Round", 2, SEGMENTS)).offset(MIN_STROKE / 2, "Round", 2, SEGMENTS));
    if (text.area() - opened.area() > THIN_LOSS * text.area()) warnings.push(THIN_STROKES);

    // ---- Plate (or backing) outline ----
    let plate;
    if (p.plate === "none") {
      const grow = clamp(BRIDGE[0] * h, BACKING, BRIDGE[1]);
      const closed = t(t(text.offset(grow, "Round", 2, SEGMENTS)).offset(-(grow - BACKING), "Round", 2, SEGMENTS));
      plate = bridgeBacking(CrossSection, closed, { cy, height: h }, t);
    } else if (p.plate === "hug") {
      plate = hugAround(CrossSection, text, margin, t);
    } else if (p.plate === "pill") {
      plate = t(pillAround(CrossSection, text, margin));
    } else {
      plate = t(t(roundedRect(CrossSection, w + 2 * margin, h + 2 * margin, RECT_RADIUS)).translate([cx, cy]));
    }

    // ---- Keychain loop ----
    let loop = null, hole2d = null;
    if (p.keychain_loop) {
      // Leftmost point of `cs` within a horizontal band around the loop's axis.
      const leftIn = (cs, half) => {
        const pb = plate.bounds();
        const band = t(t(CrossSection.square([pb.max[0] - pb.min[0] + 100, 2 * half], false)).translate([pb.min[0] - 50, cy - half]));
        const part = t(cs.intersect(band));
        return part.isEmpty() ? null : part.bounds().min[0];
      };
      const plateLeft = leftIn(plate, 0.25) ?? plate.bounds().min[0];
      // The ring never overlaps a letter (so the hole, 3.25 mm inside it, keeps well clear).
      const lettersLeft = leftIn(text, LOOP.outerR) ?? tb.min[0];
      // 3 mm into the plate, or further left when the letters are in the way.
      const lx = Math.min(plateLeft - LOOP.overlap, lettersLeft - LOOP.outerR);
      const parts = [t(t(CrossSection.circle(LOOP.outerR, 48)).translate([lx, cy]))];
      let reach = lx + LOOP.outerR;
      if (reach < plateLeft + LOOP.overlap) {
        // The letters pushed the loop left: a short bridge carries it 3 mm into the plate.
        reach = plateLeft + LOOP.overlap;
        parts.push(t(t(CrossSection.square([reach - lx, 7], false)).translate([lx, cy - 3.5])));
      }
      hole2d = t(t(CrossSection.circle(LOOP.holeR, 48)).translate([lx, cy]));
      plate = t(t(CrossSection.union([plate, ...parts])).subtract(hole2d));
      loop = { cx: lx, cy, outerR: LOOP.outerR, holeR: LOOP.holeR, reach };
    }

    // ---- Solids ----
    const at = (cs, height, z) => t(t(cs.extrude(height)).translate([0, 0, z]));
    let base;
    if (p.style === "inlay") {
      // Plate at full thickness with the name's pocket; the letters fill it flush.
      base = t(at(plate, T, 0).subtract(at(text, R + 1, T - R)));
    } else {
      base = at(plate, T - R, 0);
    }
    const pieces = base.decompose();
    const count = pieces.length;
    pieces.forEach(free);
    if (count !== 1) throw new Error(face ? DISCONNECTED : DISCONNECTED_BLOCK);

    const extras = [];
    if (p.style === "outline") {
      const ring = t(t(t(text.offset(OUTLINE, "Round", 2, SEGMENTS)).subtract(text)).intersect(plate));
      extras.push({ name: "Outline", solid: at(ring, R, T - R), color: p.outline_color });
    } else if (p.style === "shadow") {
      const d = clamp(SHADOW[0] * h, SHADOW[1], SHADOW[2]);
      const shifted = t(t(t(text.translate([d, -d])).subtract(text)).intersect(plate));
      // Drop slivers too thin to print (where a stroke runs along the shadow's direction).
      const shadow = t(t(shifted.offset(-MIN_FEATURE / 2, "Round", 2, SEGMENTS)).offset(MIN_FEATURE / 2, "Round", 2, SEGMENTS));
      if (!shadow.isEmpty()) extras.push({ name: "Shadow", solid: at(t(shadow.intersect(shifted)), R / 2, T - R), color: p.outline_color });
    }
    const letters = at(text, R, T - R);

    // Every part gets the hole (only the plate actually reaches it). Results are the output.
    const hole3d = hole2d ? at(hole2d, T + 2, -1) : null;
    const finish = solid => (hole3d ? solid.subtract(hole3d) : solid.translate([0, 0, 0]));
    solids.push({ name: p.plate === "none" ? "Backing" : "Plate", solid: finish(base), color: p.plate === "none" ? p.outline_color : p.plate_color });
    for (const e of extras) solids.push({ ...e, solid: finish(e.solid) });
    solids.push({ name: "Name", solid: finish(letters), color: p.text_color });

    ok = true;
    // The title is plain text (the 3MF writer escapes it); the filename is sanitized and short.
    return {
      solids, warnings, loop,
      title: `Name plate - ${p.name}`,
      filenameBase: safeName(`name-plate-${safeName(p.name)}`)
    };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
