// Rating card geometry. A business-card plate (85.6 × 54 mm) with three raised zones that never
// touch: the icon (left), five stars (right of the icon) and the caption (bottom band). Each
// colored part rises `relief_mm` from the plate's top, so the total height is `thickness_mm`.
// Empty stars are the star row minus the filled (full or half) stars, so the two star colors
// never overlap. buildModel frees the returned solids; everything else is freed here.
import { roundedRect, star, partialStar } from "../../framework/shapes.js";
import { fitCrossSection, splitBlockLines, blockTextLines, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING } from "../../framework/text.js";
import { iconCrossSection } from "../../framework/icons.js";
import { imageCrossSection } from "../../framework/image-trace.js";
import { safeName } from "../../framework/model.js";
import { contrastRatio } from "../../../public/assets/js/customize/color.js";

export const CARD = Object.freeze({ w: 85.6, h: 54 });
const MARGIN = 4;            // clear border inside the card edge (mm)
const GAP = 2.5;             // clearance between the icon, star and caption zones (mm)
const CAPTION_H = 11;        // caption band height (mm): one line, or two when one would be small
const ICON_ZONE = 31;        // icon zone (square, mm)
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

/** Zone boxes { x0, x1, y0, y1 } (mm, card centered on the origin, +Y up). Pure. */
export function planLayout(p) {
  const left = -CARD.w / 2 + MARGIN, right = CARD.w / 2 - MARGIN;
  const bottom = -CARD.h / 2 + MARGIN, top = CARD.h / 2 - MARGIN;
  const caption = { x0: left, x1: right, y0: bottom, y1: bottom + CAPTION_H };
  const zoneY0 = caption.y1 + GAP, zoneCy = (zoneY0 + top) / 2;
  const showStars = p.show_stars !== false;
  const iconCx = showStars ? left + ICON_ZONE / 2 : 0;
  const icon = { x0: iconCx - ICON_ZONE / 2, x1: iconCx + ICON_ZONE / 2, y0: zoneCy - ICON_ZONE / 2, y1: zoneCy + ICON_ZONE / 2 };
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
  return { margin: MARGIN, gap: GAP, icon, stars, caption };
}

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export default async function build(p, { wasm, imageContours = null } = {}) {
  const { CrossSection } = wasm;
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const L = planLayout(p);
    const T = p.thickness_mm, R = p.relief_mm;
    const card = t(roundedRect(CrossSection, CARD.w, CARD.h, p.corner_radius_mm));
    const iconCx = (L.icon.x0 + L.icon.x1) / 2, iconCy = (L.icon.y0 + L.icon.y1) / 2;

    // Icon: a built-in silhouette, or the customer's traced image.
    let icon;
    if (p.icon === "custom") {
      if (!imageContours) throw new Error(NO_IMAGE);
      const size = (ICON_ZONE * p.image_scale_pct) / IMAGE_MAX_PCT;
      const raw = t(imageCrossSection(CrossSection, imageContours));
      if (raw.isEmpty()) throw new Error(TOO_THIN);
      const fitted = t(fitCrossSection(raw, { maxWidth: size, maxHeight: size, centerX: iconCx, centerY: iconCy }));
      // Drop every part thinner than the nozzle can print (morphological opening).
      icon = t(t(fitted.offset(-MIN_FEATURE / 2, "Round", 2, 32)).offset(MIN_FEATURE / 2, "Round", 2, 32));
      if (icon.isEmpty() || icon.area() < 1) throw new Error(TOO_THIN);
      if (icon.area() < 0.9 * fitted.area()) warnings.push("Some fine detail in your image is thinner than 0.8 mm and was left out. A larger size or a bolder image keeps more of it.");
    } else {
      const raw = t(iconCrossSection(CrossSection, p.icon));
      icon = t(fitCrossSection(raw, { maxWidth: BUILTIN_ICON, maxHeight: BUILTIN_ICON, centerX: iconCx, centerY: iconCy }));
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

    // Caption: block font, one line or two, shrunk to fit; too small to read is an error.
    const text = String(p.caption ?? "").trim();
    let caption = null;
    if (text) {
      const box = { cx: 0, cy: (L.caption.y0 + L.caption.y1) / 2, maxW: L.caption.x1 - L.caption.x0, maxH: CAPTION_H };
      const block = blockTextLines(CrossSection, splitBlockLines(text, box, SPLIT_BELOW), box, t);
      if (block.cap < MIN_TEXT) throw new Error(TOO_LONG);
      if (block.cap < SMALL_TEXT) warnings.push(`The caption prints only ${block.cap.toFixed(1)} mm tall and may be hard to read. A shorter caption prints larger.`);
      if (unsupportedBlockChars(text).length) warnings.push(BLOCK_SUBSTITUTION_WARNING);
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
    // Results below are not registered with `t`: they are the output.
    solids.push({ name: "Card base", solid: card.extrude(T - R), color: p.base_color });
    const push = (name, cs, color) => { const solid = raised(cs); if (solid) solids.push({ name, solid, color }); };
    push("Icon", icon, p.icon_color);
    push("Empty stars", empty, p.empty_star_color);
    push("Filled stars", filled, p.star_color);
    push("Caption", caption, p.text_color);

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
