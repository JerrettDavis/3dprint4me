// Route shield geometry, ported from the prototype's generator.js. Returns Manifold
// solids; buildModel handles the XY shift, meshing, 3MF packaging and freeing the solids.
import { blockText, fontText, fontDrawable, fitCrossSection, locationFont, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING, FONT_CHARS_SKIPPED } from "../../framework/text.js";
import { fontNeededMessage, FONT_NOT_LOADED } from "../../../public/assets/js/customize/fonts.js";
import { qrCrossSection } from "../../framework/qr.js";
import { qrModuleStatus } from "../../../public/assets/js/customize/qr.js";
import { safeName } from "../../framework/model.js";
import { OUTER, UPPER, LOWER, positiveContour } from "./template.js";

const TEMPLATE_WIDTH = Math.max(...OUTER.map(p => p[0])) - Math.min(...OUTER.map(p => p[0]));
const TEMPLATE_HEIGHT = Math.max(...OUTER.map(p => p[1])) - Math.min(...OUTER.map(p => p[1]));

const scalePoints = (pts, sx, sy) => pts.map(([x, y]) => [x * sx, y * sy]);

const bounds2 = pts => ({
  minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])),
  minY: Math.min(...pts.map(p => p[1])), maxY: Math.max(...pts.map(p => p[1]))
});

// `notes.skipped` is set when a real font lacked a character, so build() can warn once.
// `face` is { mode, font } from locationFont(): the font for this text location.
function makeTextCS(CrossSection, text, o, face, notes) {
  if (!String(text || "").trim()) return CrossSection.union([]);
  const { mode, font } = face;
  if (mode === "block") return blockText(CrossSection, text);
  if (!font) throw new Error(mode === "custom" || mode === "system" ? fontNeededMessage(mode) : FONT_NOT_LOADED);
  // A real font draws only the characters it has (never its "missing glyph" box).
  const drawable = fontDrawable(text, font);
  if (drawable.skipped) notes.skipped = true;
  if (!drawable.text.trim()) return CrossSection.union([]);
  // Non-zero fill: overlapping contours (script joins) stay solid instead of becoming holes.
  return fontText(CrossSection, font, drawable.text, { fillRule: "NonZero" });
}

// ---- Text layout -----------------------------------------------------------
// Size is a percent of the auto-fit box; the offset nudges text vertically.
// Placement is only valid while the text stays inside its safe region.
const WALL = 0.6;          // clearance kept between front text and its color field edge
const BACK_TEXT_TOP = 0.375, BACK_TEXT_W = 0.78, BACK_LINE_FILL = 0.75, BACK_LINE_CAP = 0.11;
const QR_GAP = 1.5;        // clearance between back text and the QR code
const QR_EDGE = 3;         // clearance between the QR code and the badge edge
// x-extent of the square bottom stem in template units (see OUTER).
const STEM_X = [-19.071, 17.9];
const FIT_EPS = 1e-3;      // mm^2 of tolerated overhang (numeric noise)

const textFits = (cs, region, t) => cs.isEmpty() || t(cs.subtract(region)).area() <= FIT_EPS;

// `t` registers a temporary for release when build() finishes.
function buildLayout(wasm, options, ctx, t, notes) {
  const { CrossSection } = wasm;
  const sx = options.width_mm / TEMPLATE_WIDTH;
  const sy = options.height_mm / TEMPLATE_HEIGHT;
  const scale = Math.min(sx, sy);
  const height = options.height_mm;
  const nominalWidth = scale * TEMPLATE_WIDTH;
  const outerPts = scalePoints(OUTER, sx, sy);
  const upperPts = scalePoints(UPPER, sx, sy);
  const lowerPts = scalePoints(LOWER, sx, sy);
  const upperB = bounds2(upperPts);
  const lowerB = bounds2(lowerPts);

  const outer = t(CrossSection.ofPolygons([positiveContour(outerPts)]));
  const upper = t(CrossSection.ofPolygons([positiveContour(upperPts)]));
  const lower = t(CrossSection.ofPolygons([positiveContour(lowerPts)]));
  if (outer.isEmpty()) throw new Error("Shield outline became empty while building the 2D cross-section.");
  if (upper.isEmpty()) throw new Error("Upper color field became empty while building the 2D cross-section.");
  if (lower.isEmpty()) throw new Error("Lower color field became empty while building the 2D cross-section.");
  // Prevent accidental cutters from touching the perimeter.
  const safeBack = t(outer.offset(-Math.max(0.8, 0.65 * scale)));

  const faceOf = key => locationFont(options, ctx, `${key}_font`);
  // The text is centered on its color field's own center (the field's bounding box); the fit step
  // centers the actual glyph ink there, so any font, size or string sits centered at offset 0.
  const frontSpec = (key, field, text, box, centerY) => ({ key, text: t(text), box, baseY: centerY, region: t(field.offset(-WALL)) });
  const front = {
    top: frontSpec("top", upper, makeTextCS(CrossSection, options.top_text, options, faceOf("top"), notes),
      { w: (upperB.maxX - upperB.minX) * 0.80, h: (upperB.maxY - upperB.minY) * 0.50 },
      (upperB.minY + upperB.maxY) / 2),
    lower: frontSpec("lower", lower, makeTextCS(CrossSection, options.lower_text, options, faceOf("lower"), notes),
      { w: (lowerB.maxX - lowerB.minX) * 0.72, h: (lowerB.maxY - lowerB.minY) * 0.58 },
      (lowerB.minY + lowerB.maxY) / 2)
  };

  const allLines = String(options.back_text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const backFace = faceOf("back");
  const lines = allLines.slice(0, 4).map(line => t(makeTextCS(CrossSection, line, options, backFace, notes)));
  const qrOn = !!options.qr_enabled;
  let qr = null;
  let qrTop = null;
  if (qrOn) {
    // The QR nestles in the square bottom stem: as wide as the stem allows with
    // QR_EDGE clearance on each side and above the bottom edge.
    const stemL = STEM_X[0] * sx, stemR = STEM_X[1] * sx;
    const bottomY = Math.min(...outerPts.map(p => p[1]));
    const maxSize = (stemR - stemL) - 2 * QR_EDGE;
    const pct = options.qr_scale_pct ?? 100;
    const size = maxSize * pct / 100;
    let q;
    try { q = qrCrossSection(CrossSection, String(options.qr_data).trim(), size); } catch (err) {
      const need = /needs about ([\d.]+) mm/.exec(String(err?.message))?.[1];
      if (pct < 100 && need) throw new Error(`The QR code is scaled too small to print: it needs about ${need} mm but is set to ${size.toFixed(1)} mm. Increase QR code size or shorten its content.`);
      throw err;
    }
    t(q.cs);
    // Centered in its slot in the stem (the slot is sized for 100%). The back is mirrored
    // left-right, so the unmirrored x is the negated stem center.
    qr = { ...q, cs: t(q.cs.translate([-(stemL + stemR) / 2, bottomY + QR_EDGE + maxSize / 2])) };
    qrTop = bottomY + QR_EDGE + maxSize;
  }
  // Back text fills the space above the QR (or a fixed band when there is no QR).
  const textTop = qrOn ? height * BACK_TEXT_TOP : height * 0.17 + height * 0.36 / Math.max(1, lines.length) / 2;
  const textBottom = qrOn ? qrTop + QR_GAP : textTop - height * 0.36;
  const step = Math.max(textTop - textBottom, 1) / Math.max(1, lines.length);
  // The back is mirrored in the model, so fit is tested in mirrored space.
  const region = qr ? t(safeBack.subtract(t(t(qr.cs.mirror([1, 0])).offset(QR_GAP)))) : safeBack;
  const back = {
    CrossSection, lines, qr, region, truncated: allLines.length > 4,
    lineCenterTop: textTop - step / 2,
    step,
    box: { w: Math.min(options.width_mm * BACK_TEXT_W, nominalWidth * 0.8), h: Math.min(nominalWidth * BACK_LINE_CAP, step * BACK_LINE_FILL) }
  };
  return { scale, height, nominalWidth, outerPts, outer, upper, lower, safeBack, front, back };
}

const pctOf = (o, key) => (o[`${key}_scale_pct`] ?? 100) / 100;
const offOf = (o, key) => o[`${key}_offset_mm`] ?? 0;

function fitFront(spec, o, t, pct = pctOf(o, spec.key), off = offOf(o, spec.key)) {
  return t(fitCrossSection(spec.text, {
    maxWidth: spec.box.w * pct, maxHeight: spec.box.h * pct, centerX: 0, centerY: spec.baseY + off
  }));
}

// Unmirrored back text (the caller mirrors it with the QR).
function fitBack(b, o, t, pct = pctOf(o, "back"), off = offOf(o, "back")) {
  return b.CrossSection.union(b.lines.map((cs, i) => t(fitCrossSection(cs, {
    maxWidth: b.box.w * pct, maxHeight: b.box.h * pct, centerX: 0,
    centerY: b.lineCenterTop + off - i * b.step
  }))));
}

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export default async function build(options, { wasm, font = null, fonts = {} } = {}) {
  const { CrossSection, Manifold } = wasm;
  const warnings = [];
  // Temporaries are freed on exit; only the returned solids outlive this call
  // (buildModel frees those). Solids built so far are freed too if we throw.
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const notes = { skipped: false };
    const layout = buildLayout(wasm, options, { font, fonts }, t, notes);
    const { outerPts, outer, upper, lower, safeBack } = layout;
    const qr = layout.back.qr;
    if (qr) { const status = qrModuleStatus(qr.module); if (status.level !== "ok") warnings.push(status.message); }
    if (layout.back.truncated) warnings.push("Back text was limited to the first four non-empty lines.");
    const blockAt = key => locationFont(options, { font, fonts }, `${key}_font`).mode === "block";
    if ([["top", options.top_text], ["lower", options.lower_text], ["back", options.back_text]].some(([key, text]) => blockAt(key) && unsupportedBlockChars(text).length)) warnings.push(BLOCK_SUBSTITUTION_WARNING);
    if (notes.skipped) warnings.push(FONT_CHARS_SKIPPED);

    // Reaching here with text that doesn't fit is an error, never a silent crop.
    const fitOrThrow = (name, cs, region) => {
      if (!textFits(cs, region, t)) throw new Error(`${name} doesn't fit at this size/position; reduce its size or move it back toward center.`);
      return cs;
    };
    const frontText = spec => spec.text.isEmpty() ? spec.text
      : fitOrThrow(`${spec.key === "top" ? "Upper" : "Lower"} text`, fitFront(spec, options, t), spec.region);
    const topText = frontText(layout.front.top);
    const lowerText = frontText(layout.front.lower);

    // Back text and optional QR are built in 2D, then mirrored left-to-right (the badge
    // is flipped like a page) so they read normally from the back.
    // The two are kept apart so each prints (and is hovered) as its own part.
    const mirrored = cs => (cs && !cs.isEmpty() ? t(t(cs.mirror([1, 0])).intersect(safeBack)) : null);
    let backTextRaw = null;
    if (layout.back.lines.length) {
      backTextRaw = t(fitBack(layout.back, options, t));
      if (!textFits(t(backTextRaw.mirror([1, 0])), layout.back.region, t)) throw new Error("Back text doesn't fit at this size/position; reduce its size or move it back toward center.");
    }
    const backTextCS = mirrored(backTextRaw);
    const qrCS = mirrored(qr?.cs);
    const backParts = [backTextCS, qrCS].filter(Boolean);
    const backCS = backParts.length ? t(CrossSection.union(backParts)) : t(CrossSection.union([]));

    // Base uses two layers in Z. The lower layer is outer minus back features;
    // the upper core is full outer. This makes perfectly flush, non-overlapping inlays.
    const bottomSkinCS = backCS.isEmpty() ? outer : t(outer.subtract(backCS));
    const bottomSkin = t(bottomSkinCS.extrude(options.inlay_depth_mm));
    const core = t(t(outer.extrude(options.base_thickness_mm - options.inlay_depth_mm)).translate([0, 0, options.inlay_depth_mm]));
    let body = t(Manifold.union([bottomSkin, core]));

    // Fixed 3dprint4.me mark on the lower vertical edge.
    const ymin = Math.min(...outerPts.map(p => p[1]));
    const edgeSpan = options.width_mm * 0.44;
    const markHeight = Math.min(options.base_thickness_mm * 0.55, 3.2);
    // Branding geometry is deliberately independent of the customer-selected font.
    const markRaw = t(blockText(CrossSection, "3dprint4.me"));
    const markCS = t(t(fitCrossSection(markRaw, { maxWidth: edgeSpan, maxHeight: markHeight, centerX: 0, centerY: 0 })).mirror([1, 0]));
    const sideMark = t(t(t(markCS.extrude(options.inlay_depth_mm)).rotate([-90, 0, 0])).translate([0, ymin, options.base_thickness_mm / 2]));
    const sideCutter = t(t(t(markCS.extrude(options.inlay_depth_mm + 0.12)).rotate([-90, 0, 0])).translate([0, ymin - 0.06, options.base_thickness_mm / 2]));
    body = t(body.subtract(sideCutter));

    // Front stack. field_height_mm > 0 raises a color layer of that thickness above
    // the base top; < 0 recesses a layer of that thickness so its top sits |f| below
    // the base top (leaving an |f| lip) in a pocket 2|f| deep. text_height_mm > 0
    // raises text above the color; < 0 cuts it |t| into the color's top surface.
    const T = options.base_thickness_mm;
    const fieldH = options.field_height_mm;
    const textH = options.text_height_mm;
    const fieldThickness = Math.abs(fieldH);
    const frontZ = T + fieldH; // top surface of the color layer

    if (fieldH < 0) {
      const pocketParts = [upper, lower].map(cs => t(cs.extrude(2 * fieldThickness + 0.1)));
      const pocket = t(t(Manifold.union(pocketParts)).translate([0, 0, T - 2 * fieldThickness]));
      body = t(body.subtract(pocket));
    }

    // Results of translate()/union() below are not registered with `t`: they are the output.
    solids.push({ name: "Shield body", solid: body.translate([0, 0, 0]), color: options.base_color });
    const frontLayer = (label, fieldCS, textCS, fieldColor) => {
      const fieldZ = fieldH < 0 ? T + 2 * fieldH : T;
      let colorSolid = t(fieldCS.extrude(fieldThickness)).translate([0, 0, fieldZ]);
      if (textH < 0 && !textCS.isEmpty()) {
        // Text is cut into the color, flush with its top: only the top |textH| of
        // the color is removed (color stays under the text), and the text fills it.
        const cutCS = t(textCS.intersect(fieldCS));
        if (!cutCS.isEmpty()) {
          const cutZ = frontZ + textH;
          const cutDepth = -textH;
          const cutter = t(t(cutCS.extrude(cutDepth + 0.1)).translate([0, 0, cutZ]));
          const trimmed = colorSolid.subtract(cutter);
          free(colorSolid);
          colorSolid = trimmed;
          solids.push({ name: `${label} text`, solid: t(cutCS.extrude(cutDepth)).translate([0, 0, cutZ]), color: options.text_color });
        }
      } else if (!textCS.isEmpty()) {
        solids.push({ name: `${label} text`, solid: t(textCS.extrude(textH)).translate([0, 0, frontZ]), color: options.text_color });
      }
      solids.splice(1, 0, { name: `${label} color field`, solid: colorSolid, color: fieldColor });
    };
    frontLayer("Lower", lower, lowerText, options.lower_color);
    frontLayer("Upper", upper, topText, options.upper_color);
    // Named parts of the back inlay (one color, so they print as one filament).
    if (backTextCS) solids.push({ name: "Back text", solid: backTextCS.extrude(options.inlay_depth_mm), color: options.back_color });
    if (qrCS) solids.push({ name: "QR code", solid: qrCS.extrude(options.inlay_depth_mm), color: options.back_color });
    solids.push({ name: "3dprint4.me mark", solid: sideMark.translate([0, 0, 0]), color: options.back_color });

    ok = true;
    return {
      solids, warnings,
      title: `Route shield - ${options.top_text} ${options.lower_text}`.trim(),
      filenameBase: `route-shield-${safeName(options.top_text)}-${safeName(options.lower_text)}`
    };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
