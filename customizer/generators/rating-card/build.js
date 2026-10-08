// Rating card geometry. A business-card plate (85.6 × 54 mm) with three raised zones that never
// touch: the icon (left), five stars (right of the icon) and the caption (bottom band). Each
// colored part rises `relief_mm` from the plate's top, so the total height is `thickness_mm`.
// Empty stars are the star row minus the filled (full or half) stars, so the two star colors
// never overlap. buildModel frees the returned solids; everything else is freed here.
import { roundedRect, star, partialStar, circle } from "../../framework/shapes.js";
import { locationFont, fitCrossSection, splitBlockLines, blockTextLines, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING, fontTextLines, FONT_CHARS_SKIPPED } from "../../framework/text.js";
import { iconCrossSection } from "../../framework/icons.js";
import { imageCrossSection } from "../../framework/image-trace.js";
import { safeName } from "../../framework/model.js";
import { contrastRatio } from "../../../public/assets/js/customize/color.js";
import { FONT_BLOCK, FONT_NOT_LOADED, fontNeededMessage } from "../../../public/assets/js/customize/fonts.js";

export const CARD = Object.freeze({ w: 85.6, h: 54 });
const MARGIN = 4;            // clear border inside the card edge (mm)
const GAP = 2.5;             // clearance between the icon, star and caption zones (mm)
const CAPTION_H = 11;        // caption band height (mm): one line, or two when one would be small
const ICON_ZONE = 31;        // icon zone (square, mm), at most; it shrinks when decorations take the room
const RIM_CLEAR = 0.8;       // clearance between the innermost decoration and the content (mm)
const FRAME_GAP = 0.8;       // clearance between a border and the inner frame line (mm)
const MIN_GROOVE_WEB = 0.6;  // card base kept under an engraved line (mm)
const BUILTIN_ICON = 28;     // built-in icons are fitted into this square (mm)
const IMAGE_MAX_PCT = 120;   // a custom image at 120 % fills the icon zone
const STAR_GAP = 1.4;        // tip-to-tip gap between neighbouring stars (mm), at least 1.0
const STAR_MAX_R = 4.5;
const STAR_W = 2 * Math.sin((72 * Math.PI) / 180);   // star width / outer radius
const STAR_DROP = Math.cos((36 * Math.PI) / 180);    // lowest points / outer radius
const SPLIT_BELOW = 4;       // split the caption onto two lines below this cap height (mm)
const MIN_TEXT = 2.5;        // below this cap height the caption is not legible: fail
const SMALL_TEXT = 3.5;      // warn below this cap height
const MIN_FEATURE = 0.8;     // thinnest printable part of a traced image (mm)
const STAR_PAIR_CONTRAST = 1.5; // below this, filled and empty stars may look alike: warn
const CLIP_INSET = 1;        // relief is clipped to the card inset by this much (safety net only)

const TOO_LONG = "The caption is too long to print legibly on the card. Shorten it, or split it into words.";
const NO_IMAGE = "Choose an image first, or pick a built-in icon.";
const TOO_THIN = "The traced image is too thin to print at this size: its parts must be at least 0.8 mm wide. Make it larger, adjust the threshold, or choose a bolder image.";

/** Decoration settings with the schema defaults for anything a caller left out. */
export function decor(p) {
  const border = p.border_style ?? "none", frame = p.frame_style ?? "none";
  const inset = p.border_inset_mm ?? 1, bw = p.border_width_mm ?? 1.2, fw = p.frame_width_mm ?? 0.8;
  // Distances from the card edge: the border [inset, inset + bw], then the frame line after a gap.
  const borderBand = border !== "none" ? [inset, inset + bw] : null;
  const frameFrom = borderBand ? borderBand[1] + FRAME_GAP : inset;
  const frameBand = frame !== "none" ? [frameFrom, frameFrom + fw] : null;
  const extent = frameBand ? frameBand[1] : borderBand ? borderBand[1] : 0;
  return {
    border, frame, borderBand, frameBand, extent,
    groove: p.groove_depth_mm ?? 0.4, divider: p.divider ?? "none",
    divW: p.divider_width_mm ?? 1, divPct: p.divider_length_pct ?? 80
  };
}

/** Zone boxes { x0, x1, y0, y1 } (mm, card centered on the origin, +Y up). Pure. */
export function planLayout(p) {
  const d = decor(p);
  // Decorations push the content in from the edge; with none the margin is the fixed MARGIN.
  const margin = Math.max(MARGIN, d.extent ? d.extent + RIM_CLEAR : 0);
  const left = -CARD.w / 2 + margin, right = CARD.w / 2 - margin;
  const bottom = -CARD.h / 2 + margin, top = CARD.h / 2 - margin;
  const caption = { x0: left, x1: right, y0: bottom, y1: bottom + CAPTION_H };
  const zoneY0 = caption.y1 + GAP, zoneCy = (zoneY0 + top) / 2;
  const iconZone = Math.min(ICON_ZONE, top - zoneY0);
  const showStars = p.show_stars !== false;
  const iconCx = showStars ? left + iconZone / 2 : 0;
  const icon = { x0: iconCx - iconZone / 2, x1: iconCx + iconZone / 2, y0: zoneCy - iconZone / 2, y1: zoneCy + iconZone / 2 };
  let stars = null;
  if (showStars) {
    const x0 = icon.x1 + GAP, width = right - x0;
    const r = Math.min(STAR_MAX_R, (width - 4 * STAR_GAP) / (5 * STAR_W));
    const pitch = (width - STAR_W * r) / 4;
    // Center the star's visual height (tip at +r, lowest points at -r·cos 36°) in the zone.
    const cy = zoneCy - (r - r * STAR_DROP) / 2;
    const centers = Array.from({ length: 5 }, (_, i) => [x0 + (STAR_W * r) / 2 + i * pitch, cy]);
    stars = { r, pitch, centers, box: { x0, x1: x0 + 4 * pitch + STAR_W * r, y0: cy - r * STAR_DROP, y1: cy + r } };
  }
  // Divider rules sit in the GAP strips between the zones.
  const dividers = [];
  const skipped = [];
  const wantCaption = d.divider === "caption" || d.divider === "both";
  const wantIcon = d.divider === "icon" || d.divider === "both";
  if (wantCaption) {
    if (hasCaptionText(p)) dividers.push({ kind: "caption", cx: 0, cy: caption.y1 + GAP / 2, w: Math.max(d.divW, ((right - left) * d.divPct) / 100), h: d.divW });
    else skipped.push("caption");
  }
  if (wantIcon) {
    if (stars) dividers.push({ kind: "icon", cx: icon.x1 + GAP / 2, cy: zoneCy, w: d.divW, h: Math.max(d.divW, (iconZone * d.divPct) / 100) });
    else skipped.push("icon");
  }
  return { margin, gap: GAP, iconZone, icon, stars, caption, dividers, skipped };
}

const hasCaptionText = p => String(p.caption ?? "").trim().length > 0;

/** The card outline: rounded, chamfered (cut) or notched (ticket-style concave) corners. */
export function cardOutline(CrossSection, w, h, style, size) {
  if (!(size > 0)) return CrossSection.square([w, h], true);
  if (style === "chamfer") {
    const c = Math.min(size, w / 2 - 1e-3, h / 2 - 1e-3), x = w / 2, y = h / 2;
    return CrossSection.ofPolygons([[[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]]]);
  }
  if (style === "notch") {
    const base = CrossSection.square([w, h], true);
    const disc = circle(CrossSection, size);
    const cutters = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sy]) => disc.translate([sx * w / 2, sy * h / 2]));
    disc.delete();
    try {
      let out = base;
      for (const c of cutters) { const next = out.subtract(c); if (out !== base) out.delete(); out = next; }
      return out;
    } finally { base.delete(); for (const c of cutters) c.delete(); }
  }
  return roundedRect(CrossSection, w, h, size);
}

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export const NONE_AVAILABLE = "None of the characters in the caption are available in this font. Choose another font.";

export default async function build(p, { wasm, font = null, fonts = {}, imageContours = null } = {}) {
  const { CrossSection } = wasm;
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const L = planLayout(p);
    const T = p.thickness_mm, R = p.relief_mm;
    const d = decor(p);
    const card = t(cardOutline(CrossSection, CARD.w, CARD.h, p.corner_style ?? "round", p.corner_radius_mm));
    for (const k of L.skipped) warnings.push(k === "caption" ? "The divider above the caption was left out because there is no caption." : "The divider between the icon and the stars was left out because the stars are hidden.");
    const iconCx = (L.icon.x0 + L.icon.x1) / 2, iconCy = (L.icon.y0 + L.icon.y1) / 2;

    // Icon: a built-in silhouette, or the customer's traced image.
    let icon;
    if (p.icon === "custom") {
      if (!imageContours) throw new Error(NO_IMAGE);
      const size = (L.iconZone * p.image_scale_pct) / IMAGE_MAX_PCT;
      const raw = t(imageCrossSection(CrossSection, imageContours));
      if (raw.isEmpty()) throw new Error(TOO_THIN);
      const fitted = t(fitCrossSection(raw, { maxWidth: size, maxHeight: size, centerX: iconCx, centerY: iconCy }));
      // Drop every part thinner than the nozzle can print (morphological opening).
      icon = t(t(fitted.offset(-MIN_FEATURE / 2, "Round", 2, 32)).offset(MIN_FEATURE / 2, "Round", 2, 32));
      if (icon.isEmpty() || icon.area() < 1) throw new Error(TOO_THIN);
      if (icon.area() < 0.9 * fitted.area()) warnings.push("Some fine detail in your image is thinner than 0.8 mm and was left out. A larger size or a bolder image keeps more of it.");
    } else {
      const builtinIcon = (BUILTIN_ICON * L.iconZone) / ICON_ZONE;
      const raw = t(iconCrossSection(CrossSection, p.icon));
      icon = t(fitCrossSection(raw, { maxWidth: builtinIcon, maxHeight: builtinIcon, centerX: iconCx, centerY: iconCy }));
    }

    // Stars: five outlines; the filled ones (whole or half) are cut out of the empty row.
    // Printability note: star points taper to a sharp tip, so the last few tenths of a
    // millimetre of each point (and the cut edge of a half star) are thinner than a 0.4 mm
    // nozzle prints; the slicer rounds those tips off. The tips are deliberately not blunted.
    let filled = null, empty = null;
    if (L.stars) {
      const units = Math.round(p.rating * 2);    // half-star units, 0..10
      const all = [], full = [];
      L.stars.centers.forEach((c, i) => {
        all.push(t(t(star(CrossSection, L.stars.r)).translate(c)));
        const fraction = Math.max(0, Math.min(2, units - 2 * i)) / 2;
        if (fraction > 0) full.push(t(t(partialStar(CrossSection, L.stars.r, fraction)).translate(c)));
      });
      filled = t(CrossSection.union(full));
      const pair = contrastRatio(p.star_color, p.empty_star_color);
      if (pair < STAR_PAIR_CONTRAST) warnings.push(`Star color and Empty star color are very similar (${pair.toFixed(2)}:1), so filled and empty stars may look the same. Choose colors that differ more.`);
      empty = t(t(CrossSection.union(all)).subtract(filled));
    }

    // Caption: the built-in block font or a real font (curated, installed or the customer's
    // file), one line or two, shrunk to fit; too small to read is an error.
    const text = String(p.caption ?? "").trim();
    let caption = null;
    if (text) {
      // The caption's own font if set, else the main font.
      const lf = locationFont(p, { font, fonts }, "caption_font");
      const blockFont = lf.mode === FONT_BLOCK;
      if (!blockFont && !lf.font) throw new Error(lf.mode === "custom" || lf.mode === "system" ? fontNeededMessage(lf.mode) : FONT_NOT_LOADED);
      const box = { cx: 0, cy: (L.caption.y0 + L.caption.y1) / 2, maxW: L.caption.x1 - L.caption.x0, maxH: CAPTION_H };
      const block = blockFont
        ? blockTextLines(CrossSection, splitBlockLines(text, box, SPLIT_BELOW), box, t)
        : fontTextLines(CrossSection, lf.font, text, box, t, { splitBelow: SPLIT_BELOW });
      if (!block.cap) throw new Error(NONE_AVAILABLE);
      if (block.cap < MIN_TEXT) throw new Error(TOO_LONG);
      if (block.cap < SMALL_TEXT) warnings.push(`The caption prints only ${block.cap.toFixed(1)} mm tall and may be hard to read. A shorter caption prints larger.`);
      if (blockFont && unsupportedBlockChars(text).length) warnings.push(BLOCK_SUBSTITUTION_WARNING);
      if (!blockFont && block.skipped) warnings.push(FONT_CHARS_SKIPPED);
      caption = block.cs;
    }

    // Relief on the plate. The clip to the inset card is a safety net: the layout keeps every
    // zone inside the margin, and clippedArea reports anything it had to remove.
    const safe = t(card.offset(-CLIP_INSET, "Round", 2, 48));
    let clippedArea = 0;
    const raised = cs => {
      if (!cs || cs.isEmpty()) return null;
      const clipped = t(cs.intersect(safe));
      clippedArea += Math.max(0, cs.area() - clipped.area());
      return clipped.isEmpty() ? null : t(clipped.extrude(R)).translate([0, 0, T - R]);
    };
    // Border and frame line: a ring a given distance inside the outline (grown or shrunk with the
    // same corner treatment). Raised rings are not clipped to the inset card (they sit near the
    // edge by design); engraved ones are cut from the base.
    const ringAt = ([d0, d1]) => {
      const outer = t(card.offset(-d0, "Round", 2, 48));
      const inner = t(card.offset(-d1, "Round", 2, 48));
      if (outer.isEmpty() || inner.isEmpty()) throw new Error("The border does not fit this card. Reduce its width or distance from the edge.");
      return t(outer.subtract(inner));
    };
    const rings = [];
    if (d.borderBand) rings.push({ name: "Border", style: d.border, cs: ringAt(d.borderBand) });
    if (d.frameBand) rings.push({ name: "Inner frame", style: d.frame, cs: ringAt(d.frameBand) });
    const engraved = rings.filter(r => r.style === "engraved");
    if (engraved.length && T - R - d.groove < MIN_GROOVE_WEB - 1e-6) {
      throw new Error(`Engraved lines need at least ${MIN_GROOVE_WEB} mm of card under them. Lower the engraving depth, lower the relief or make the card thicker.`);
    }
    // Results below are not registered with `t`: they are the output.
    let base = card.extrude(T - R);
    if (engraved.length) {
      const cut = t(CrossSection.union(engraved.map(r => r.cs)));
      const groove = t(t(cut.extrude(d.groove + 1)).translate([0, 0, T - R - d.groove]));
      const grooved = base.subtract(groove);
      base.delete();
      base = grooved;
    }
    solids.push({ name: "Card base", solid: base, color: p.base_color });
    const push = (name, cs, color) => { const solid = raised(cs); if (solid) solids.push({ name, solid, color }); };
    push("Icon", icon, p.icon_color);
    push("Empty stars", empty, p.empty_star_color);
    push("Filled stars", filled, p.star_color);
    push("Caption", caption, p.text_color);
    for (const r of rings) if (r.style === "raised") solids.push({ name: r.name, solid: t(r.cs.extrude(R)).translate([0, 0, T - R]), color: p.icon_color });
    for (const dv of L.dividers) push(`Divider (${dv.kind})`, t(t(roundedRect(CrossSection, dv.w, dv.h, Math.min(dv.w, dv.h) / 2)).translate([dv.cx, dv.cy])), p.icon_color);

    ok = true;
    // The title is plain text (the 3MF writer escapes it); the filename is sanitized and short.
    return {
      solids, warnings, clippedArea,
      title: text ? `Rating card - ${text}` : "Rating card",
      filenameBase: text ? safeName(`rating-card-${safeName(text)}`.slice(0, 40)) : "rating-card"
    };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
