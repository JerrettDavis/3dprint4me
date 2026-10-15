// Display sign and holder geometry (see public/assets/js/customize/generators/display-sign.js).
//
// SIGN, lying flat as it prints (front face up): a rounded board (and, below it, the mounting
// tongue) `thickness - relief` thick, in Color 1, with everything else raised `relief` on top.
// Raised artwork is a flat stack of 2D regions painted back to front: shapes, then the logo, then
// the QR code, then the text; a region never lies under a later one of another color, so no two
// colored parts overlap. Color 1 artwork is unioned into the body part.
//
// HOLDER, printed with its underside down: a rounded footprint with a sloped front, a slot that
// leans the sign back, an optional business-card pocket in front of the slot (with a notch in the
// front wall), optional accent stripes (a color assigned to slabs of the body: no extra volume)
// and raised lettering on the sloped front face. The holder sits below the sign in the file.
// buildModel frees the returned solids; everything else is freed here.
import { roundedRect } from "../../framework/shapes.js";
import { imageCrossSection } from "../../framework/image-trace.js";
import { qrCrossSection } from "../../framework/qr.js";
import { locationFont, FONT_CHARS_SKIPPED, BLOCK_SUBSTITUTION_WARNING } from "../../framework/text.js";
import { safeName } from "../../framework/model.js";
import { FONT_BLOCK, fontNeededMessage, FONT_NOT_LOADED } from "../../../public/assets/js/customize/fonts.js";
import { qrModuleEstimate } from "../../../public/assets/js/customize/qr.js";
import {
  DECO_SLOTS, COVER_CLEARANCE_MM, HOLDER_TEXT_RELIEF_MM, HOLDER_TEXT_SLOTS, TEXT_SLOTS,
  bodyMm, decoKeys, hasDeco, hasHolderText, hasText, holderLayout, holderTextKeys, pocketWidthMm, qrPayload, slotHex, textKeys, wantsHolder, wantsSign
} from "../../../public/assets/js/customize/sign.js";
import { decoShape, MIN_STROKE } from "./shapes.js";
import { placeText } from "./text.js";

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };
const SEGMENTS = 48;
const MIN_TEXT = 2;             // capital letters shorter than this are not legible: fail
const SMALL_TEXT = 3.5;         // ... and shorter than this get a warning
const MIN_FEATURE = 0.8;        // the thinnest printable part of a traced logo
const CLIP_WARN_MM2 = 0.5;      // trimmed area that is worth a warning
const BED_MM = 256;
const GAP_MM = 10;              // space between the sign and the holder in the file
const NO_IMAGE = "Choose a logo image below, or turn the logo off.";
const TOO_THIN = "The traced logo is too thin to print at this size: its parts must be at least 0.8 mm wide. Make it larger, adjust the threshold, or choose a bolder image.";
const THIN_STROKES = "has strokes thinner than 0.8 mm that may not print cleanly: make it taller or choose a bolder font.";
const THIN_LOSS = 0.03;         // opening by MIN_STROKE losing more than 3 % of a text's area
const COARSE_QR = "The QR code's modules are small for a 0.4 mm nozzle; make the code bigger or shorten its content.";

const L = (n, what) => `${what} ${n}`;

export default async function build(p, { wasm, font = null, fonts = {}, imageContours = null, imageLayers = null } = {}) {
  const { CrossSection, Manifold } = wasm;
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const sign = wantsSign(p), holder = wantsHolder(p);
    const T = p.thickness_mm, R = p.relief_mm, body = bodyMm(p);
    const boardTop = p.board_h_mm / 2;
    const placements = [];            // { solid, ... } already moved into the file's frame

    // ================= SIGN =================
    if (sign) {
      const board = t(roundedRect(CrossSection, p.board_w_mm, p.board_h_mm, p.corner_radius_mm));
      const tongue = p.tongue
        ? t(t(CrossSection.square([p.tongue_w_mm, p.tongue_h_mm + 2], false)).translate([-p.tongue_w_mm / 2, -boardTop - p.tongue_h_mm]))
        : null;
      const outline = tongue ? t(CrossSection.union([board, tongue])) : board;

      // Elements, back to front. Each: { cs, slot, label, kind }.
      const elements = [];
      const addElement = (cs, slot, label, kind) => { if (cs && !cs.isEmpty()) elements.push({ cs, slot, label, kind }); };
      const cardCover = p.holder_card && p.tongue ? holderLayout(p).cardCover : 0;
      const covered = [];

      for (let j = 1; j <= DECO_SLOTS; j++) {
        if (!hasDeco(p, j)) continue;
        const k = decoKeys(j), kind = p[k.kind];
        const shape = decoShape(CrossSection, kind, { w: p[k.w], h: p[k.h], stroke: p[k.stroke], radius: p[k.radius], sweep: p[k.sweep], rot: p[k.rot] }, t);
        const turned = kind === "arc" || !p[k.rot] ? shape : t(shape.rotate(p[k.rot]));
        addElement(t(turned.translate([p[k.x], p[k.y]])), p[k.color], L(j, "Shape"), "shape");
      }

      // Logo: the page traced the image in the browser; only outlines arrive here.
      if (p.logo === "custom") {
        const layers = p.logo_colors > 1
          ? (imageLayers ?? []).map(l => ({ contours: l.contours, slot: String(l.index + 2) }))
          : imageContours ? [{ contours: imageContours, slot: p.logo_color }] : [];
        if (!layers.length) throw new Error(NO_IMAGE);
        const raws = layers.map(l => ({ slot: l.slot, cs: t(imageCrossSection(CrossSection, l.contours)) })).filter(l => !l.cs.isEmpty());
        if (!raws.length) throw new Error(TOO_THIN);
        const all = t(CrossSection.union(raws.map(l => l.cs)));
        const b = all.bounds();
        const k = Math.min(p.logo_w / (b.max[0] - b.min[0]), p.logo_h / (b.max[1] - b.min[1]));
        const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
        let kept = 0, total = 0;
        for (const l of raws) {
          const fitted = t(t(l.cs.translate([-cx, -cy])).scale([k, k]));
          total += fitted.area();
          const opened = t(t(fitted.offset(-MIN_FEATURE / 2, "Round", 2, 24)).offset(MIN_FEATURE / 2, "Round", 2, 24));
          kept += opened.area();
          addElement(t(opened.translate([p.logo_x, p.logo_y])), l.slot, "Logo", "logo");
        }
        if (!(kept >= 1)) throw new Error(TOO_THIN);
        if (kept < 0.9 * total) warnings.push("Some fine detail in your logo is thinner than 0.8 mm and was left out. A larger size or a bolder image keeps more of it.");
      }

      // QR code: a background tile (when it is not just the body) and the dark modules.
      if (p.qr_on) {
        const size = p.qr_size_mm;
        const payload = qrPayload(p);
        const code = qrCrossSection(CrossSection, payload, size);
        t(code.cs);
        const estimate = qrModuleEstimate(payload, size);
        if (estimate?.level === "marginal" || code.module < 1) warnings.push(estimate?.message || COARSE_QR);
        const edge = size + 2 * p.qr_quiet_mm;
        if (p.qr_quiet_mm > 0 && p.qr_tile !== "1") addElement(t(t(roundedRect(CrossSection, edge, edge, Math.min(3, p.qr_quiet_mm))).translate([p.qr_x, p.qr_y])), p.qr_tile, "QR background", "qr-tile");
        addElement(t(code.cs.translate([p.qr_x, p.qr_y])), p.qr_ink, "QR code", "qr");
      }

      // Text, last so it is never covered.
      for (let i = 1; i <= TEXT_SLOTS; i++) {
        if (!hasText(p, i)) continue;
        const k = textKeys(i);
        const lf = locationFont(p, { font, fonts }, k.font);
        const block = lf.mode === FONT_BLOCK;
        if (!block && !lf.font) throw new Error(lf.mode === "custom" || lf.mode === "system" ? fontNeededMessage(lf.mode) : FONT_NOT_LOADED);
        const placed = placeText(CrossSection, block ? null : lf.font, p[k.text], { size: p[k.size], align: p[k.align], fit: p[k.fit], rot: p[k.rot], x: p[k.x], y: p[k.y] }, t);
        if (!placed.cap) { warnings.push(`${L(i, "Text")} has no characters this font can draw, so it was left out.`); continue; }
        if (placed.cap < MIN_TEXT) throw new Error(`${L(i, "Text")} would print only ${placed.cap.toFixed(1)} mm tall, too small to read. Make its letters taller or its maximum width larger.`);
        if (placed.cap < SMALL_TEXT) warnings.push(`${L(i, "Text")} prints only ${placed.cap.toFixed(1)} mm tall and may be hard to read.`);
        if (block && placed.substituted) warnings.push(BLOCK_SUBSTITUTION_WARNING);
        if (!block && placed.skipped) warnings.push(FONT_CHARS_SKIPPED);
        // The block font is a grid of square cells: its strokes are one cell wide.
        if (block) {
          if (placed.cap / 7 < MIN_STROKE) warnings.push(`${L(i, "Text")} ${THIN_STROKES}`);
        } else {
          const opened = t(t(placed.cs.offset(-MIN_STROKE / 2, "Round", 2, 24)).offset(MIN_STROKE / 2, "Round", 2, 24));
          if (placed.cs.area() - opened.area() > THIN_LOSS * placed.cs.area()) warnings.push(`${L(i, "Text")} ${THIN_STROKES}`);
        }
        addElement(placed.cs, p[k.color], L(i, "Text"), "text");
      }

      // Business cards standing in the pocket hide the lowest part of the board.
      if (cardCover > 0) {
        const pw = pocketWidthMm(p);
        for (const e of elements) {
          if (e.kind === "shape") continue;
          const b = e.cs.bounds();
          const lowest = b.min[1] + p.board_h_mm / 2;
          if (lowest < cardCover + COVER_CLEARANCE_MM && b.max[0] > -pw / 2 && b.min[0] < pw / 2) covered.push(e.label);
        }
        if (covered.length) warnings.push(`${[...new Set(covered)].join(", ")} sit${covered.length === 1 ? "s" : ""} low enough to be hidden by business cards standing in the holder's pocket (they cover the lowest ${Math.round(cardCover)} mm of the sign). Move ${covered.length === 1 ? "it" : "them"} up, or lower the card height.`);
      }

      // Clip to the board; painter's order from the front.
      const clipped = [];
      const above = [];
      const regions = new Map();
      for (let n = elements.length - 1; n >= 0; n--) {
        const e = elements[n];
        const inside = t(e.cs.intersect(board));
        if (e.cs.area() - inside.area() > CLIP_WARN_MM2) clipped.push(e.label);
        let visible = inside;
        if (above.length) { const cover = t(CrossSection.union(above)); visible = t(inside.subtract(cover)); }
        above.push(inside);
        if (visible.isEmpty()) continue;
        if (!regions.has(e.slot)) regions.set(e.slot, []);
        regions.get(e.slot).push(visible);
      }
      if (clipped.length) warnings.push(`${[...new Set(clipped)].join(", ")} extend${clipped.length === 1 ? "s" : ""} past the edge of the board and ${clipped.length === 1 ? "was" : "were"} trimmed.`);

      const raised = cs => t(t(cs.extrude(R)).translate([0, 0, body]));
      const bodySolid = t(outline.extrude(body));
      let bodyPart = bodySolid;
      const art = [];
      for (const [slot, list] of [...regions].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const cs = t(CrossSection.union(list));
        if (cs.isEmpty()) continue;
        if (slot === "1") bodyPart = t(bodyPart.add(raised(cs)));
        else art.push({ slot, solid: raised(cs).translate([0, 0, 0]) });
      }
      placements.push({ name: "Sign body", color: slotHex(p, "1"), solid: bodyPart.translate([0, 0, 0]) });
      for (const a of art) placements.push({ name: `Sign art (color ${a.slot})`, color: slotHex(p, a.slot), solid: a.solid });
    }

    // ================= HOLDER =================
    if (holder) {
      const W = p.holder_w_mm, D = p.holder_d_mm, H = p.holder_h_mm, taper = p.holder_taper_mm;
      const layout = holderLayout(p);
      const frontAt = z => -D / 2 + (taper * z) / H;           // the sloped front face (y at height z)
      const slopeProfile = (shift = 0) => t(t(CrossSection.ofPolygons([[
        [frontAt(-2) - shift, -2], [D / 2 + 2, -2], [D / 2 + 2, H + 2], [frontAt(H + 2) - shift, H + 2]
      ]])).extrude(W + 40));
      // Side profile (y, z) extruded across x: map (u, v, w) -> (x = w, y = u, z = v).
      const across = solid => t(t(solid.rotate([90, 0, 90])).translate([-(W + 40) / 2, 0, 0]));
      const footprint = t(t(roundedRect(CrossSection, W, D, p.holder_radius_mm).extrude(H)));
      let shell = t(footprint.intersect(across(slopeProfile())));

      // Slot for the sign's tongue, leaning back.
      const slotW = p.tongue_w_mm + 0.6;
      const lean = (p.lean_deg * Math.PI) / 180;
      const slot = t(t(Manifold.cube([slotW, layout.throat, layout.slotRise / Math.cos(lean) + 8], false)).translate([-slotW / 2, -layout.throat / 2, 0]));
      const slotMoved = t(t(slot.rotate([-p.lean_deg, 0, 0])).translate([0, layout.slotY, p.seat_mm]));
      shell = t(shell.subtract(slotMoved));

      if (p.holder_card) {
        const pw = pocketWidthMm(p);
        const pocket = t(t(Manifold.cube([pw, layout.pocketY1 - layout.pocketY0, H + 2 - p.pocket_floor_mm], false)).translate([-pw / 2, layout.pocketY0, p.pocket_floor_mm]));
        const notchW = pw * 0.6;
        const lipTop = p.pocket_floor_mm + 6;
        const notch = t(t(Manifold.cube([notchW, layout.pocketY0 - (-D / 2) + 2, H + 2 - lipTop], false)).translate([-notchW / 2, -D / 2 - 2, lipTop]));
        shell = t(t(shell.subtract(pocket)).subtract(notch));
      }
      const bodyHolder = shell;

      // Stripes: slabs of the body in the stripe color.
      let holderBody = bodyHolder, stripes = null;
      if (p.holder_stripes) {
        const slab = (z0, z1) => t(t(Manifold.cube([W + 40, D + 40, z1 - z0], false)).translate([-(W + 40) / 2, -(D + 40) / 2, z0]));
        const bands = t(t(slab(2, 3.2)).add(slab(H - 1.6, H - 0.8)));
        stripes = t(bodyHolder.intersect(bands));
        holderBody = t(bodyHolder.subtract(bands));
      }

      // Raised lettering on the sloped front face, grouped by color.
      const lettering = new Map();
      for (let n = 1; n <= HOLDER_TEXT_SLOTS; n++) {
        if (!hasHolderText(p, n)) continue;
        const k = holderTextKeys(n);
        const lf = locationFont(p, { font, fonts }, k.font);
        const block = lf.mode === FONT_BLOCK;
        if (!block && !lf.font) throw new Error(lf.mode === "custom" || lf.mode === "system" ? fontNeededMessage(lf.mode) : FONT_NOT_LOADED);
        const placed = placeText(CrossSection, block ? null : lf.font, p[k.text], { size: p[k.size], align: "center", fit: 0, rot: 0, x: p[k.x], y: H / 2 + p[k.y] }, t);
        if (!placed.cap) { warnings.push(`${L(n, "Holder lettering")} has no characters this font can draw, so it was left out.`); continue; }
        if (placed.cap < MIN_TEXT) throw new Error(`${L(n, "Holder lettering")} would print only ${placed.cap.toFixed(1)} mm tall, too small to read.`);
        if (block && placed.substituted) warnings.push(BLOCK_SUBSTITUTION_WARNING);
        if (!block && placed.skipped) warnings.push(FONT_CHARS_SKIPPED);
        const slotKey = p[k.color];
        if (!lettering.has(slotKey)) lettering.set(slotKey, []);
        lettering.get(slotKey).push(placed.cs);
      }
      const letterParts = [];
      for (const [slotKey, list] of lettering) {
        const cs = t(CrossSection.union(list));
        // Letters run through the front face along y; the skin between the face and the face shifted
        // out by the relief height is the raised part.
        const prism = t(t(t(cs.extrude(D + 20)).rotate([90, 0, 0])).translate([0, D / 2 + 10 - 0, 0]));
        const skinBody = t(across(slopeProfile(HOLDER_TEXT_RELIEF_MM / Math.cos(Math.atan(taper / H)))));
        const raisedLetters = t(t(prism.intersect(skinBody)).subtract(slopeSolidFull(t, across, slopeProfile)));
        if (!raisedLetters.isEmpty()) letterParts.push({ slotKey, solid: raisedLetters });
      }

      // Move into the file's frame: below the sign, or at the origin when it is alone.
      const dy = sign ? -(boardTop + (p.tongue ? p.tongue_h_mm : 0) + GAP_MM + D / 2) : 0;
      const put = solid => solid.translate([0, dy, 0]);
      placements.push({ name: "Holder", color: slotHex(p, p.holder_color), solid: put(holderBody) });
      if (stripes && !stripes.isEmpty()) placements.push({ name: "Holder stripes", color: slotHex(p, p.holder_stripe_color), solid: put(stripes) });
      for (const lp of letterParts) placements.push({ name: `Holder lettering (color ${lp.slotKey})`, color: slotHex(p, lp.slotKey), solid: put(lp.solid) });
    }

    // ================= Output =================
    if (!placements.length) throw new Error("Nothing to build. Choose a sign, a holder or both.");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pl of placements) {
      const b = pl.solid.boundingBox();
      minX = Math.min(minX, b.min[0]); minY = Math.min(minY, b.min[1]); maxX = Math.max(maxX, b.max[0]); maxY = Math.max(maxY, b.max[1]);
    }
    if (Math.max(maxX - minX, maxY - minY) > BED_MM) {
      warnings.push(`The model is ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} mm. That is larger than a typical ${BED_MM} mm print bed: choose "Sign only" or "Holder only" and order the other piece separately, or make it smaller.`);
    }
    for (const pl of placements) solids.push(pl);
    ok = true;
    const firstLine = String(p.t1_text ?? "").split("\n").map(s => s.trim()).find(Boolean) ?? "";
    return {
      solids, warnings,
      title: firstLine ? `Display sign - ${firstLine}` : "Display sign",
      filenameBase: firstLine ? safeName(`display-sign-${safeName(firstLine)}`.slice(0, 40)) : "display-sign"
    };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}

// The holder's un-notched front: a stand-in so a letter is raised only where the face really is.
function slopeSolidFull(t, across, slopeProfile) {
  return across(slopeProfile());
}
