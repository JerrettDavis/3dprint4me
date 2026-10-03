// Name plate geometry. The name is fitted into a box `height_mm` tall and at most 150 mm wide,
// then stacked on a plate:
//   plate "pill" / "rect": a rounded plate 3 mm larger than the name on every side;
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
const BRIDGE_OVERLAP = 1;     // a backing bridge reaches this far into each piece it joins (mm)
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

/**
 * Joins the pieces of a no-plate backing (letters a word gap apart, or letters whose closing
 * didn't meet) with horizontal bars at the name's vertical centre: a band max(2 × rim,
 * 0.25 × name height) tall spans each gap between neighbouring pieces, left to right, reaching
 * 1 mm into each. Only the backing changes; the letters stay as designed. Pieces that never
 * cross the centre band (stacked vertically) stay apart, and the caller reports them.
 * `t` registers temporaries; the result is registered too.
 */
export function bridgeBacking(CrossSection, backing, { cy, height }, t) {
  const pieces = backing.decompose();
  try {
    if (pieces.length < 2) return backing;
    const half = Math.max(2 * BACKING, 0.25 * height) / 2;
    const bb = backing.bounds();
    const band = t(t(CrossSection.square([bb.max[0] - bb.min[0] + 2, 2 * half], false)).translate([bb.min[0] - 1, cy - half]));
    const spans = [];
    for (const piece of pieces) {
      const part = t(piece.intersect(band));
      if (!part.isEmpty()) { const b = part.bounds(); spans.push([b.min[0], b.max[0]]); }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const bars = [];
    for (let i = 1; i < spans.length; i++) {
      const [left, right] = [spans[i - 1], spans[i]];
      if (right[0] <= left[1]) continue;   // already side by side across the band
      const x0 = left[1] - BRIDGE_OVERLAP, x1 = right[0] + BRIDGE_OVERLAP;
      bars.push(t(t(CrossSection.square([x1 - x0, 2 * half], false)).translate([x0, cy - half])));
    }
    return bars.length ? t(CrossSection.union([backing, ...bars])) : backing;
  } finally {
    pieces.forEach(free);
  }
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
    } else if (p.plate === "pill") {
      plate = t(pillAround(CrossSection, text, PAD));
    } else {
      plate = t(t(roundedRect(CrossSection, w + 2 * PAD, h + 2 * PAD, RECT_RADIUS)).translate([cx, cy]));
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
