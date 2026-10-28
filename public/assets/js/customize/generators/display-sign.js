// Display sign and holder: a freeform sign board with up to eight lines of text, ten shapes
// (outlines, plates, rings, arcs, lines, hearts, contact icons), the customer's own logo and a QR
// code, each placed by millimetre coordinates from the board's middle, standing in a holder that
// can carry a business-card pocket and lettering on its front. Everything is drawn from one
// five-color palette. The logo is never a parameter: the page traces it in the browser (snapped to
// the palette) and passes only the outline layers to the build (ctx.imageLayers or
// ctx.imageContours), so it never reaches drafts, the hand-off record or the server.
import { contrastRatio } from "../color.js?v=8a2c8406a349c4e2";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY, locationFontField } from "../fonts.js?v=8a2c8406a349c4e2";
import { qrModuleEstimate } from "../qr.js?v=8a2c8406a349c4e2";
import {
  BOARD_CLEAR_MM, BOARD_H, BOARD_W, CARD_POCKET_MARGIN_MM, COLOR_SLOTS, COORD, DECO_KINDS, DECO_SLOTS,
  HOLDER_TEXT_SLOTS, HOLDER_WALL_MM, MIN_BODY_MM, PALETTE_KEYS, RADIUS_KINDS, STROKE_KINDS, TEXT_SLOTS,
  decoKeys, hasDeco, hasHolderText, hasText, holderLayout, holderTextKeys, pocketWidthMm, qrPayload, slotHex, textKeys, wantsHolder, wantsSign
} from "../sign.js?v=8a2c8406a349c4e2";
import { DESIGNS, PRESETS } from "./display-sign-designs.js?v=8a2c8406a349c4e2";

const EPS = 1e-6;
const round1 = v => Math.round(v * 10) / 10;
const RELIEF_RANGE = [0.4, 1.6];
const TONGUE_W_RANGE = [40, 230];
const TONGUE_H_RANGE = [12, 40];

const slotOptions = COLOR_SLOTS.map(v => ({ value: v, label: `Color ${v}` }));
const slotField = (label, def, extra = {}) => ({ type: "enum", label, options: slotOptions, default: def, randomize: false, ...extra });
const posField = (label, def, extra = {}) => ({ type: "number", label, min: -COORD, max: COORD, step: 0.1, default: def, unit: "mm", randomize: false, ...extra });

const anyText = o => { for (let i = 1; i <= TEXT_SLOTS; i++) if (hasText(o, i)) return true; for (let n = 1; n <= HOLDER_TEXT_SLOTS; n++) if (wantsHolder(o) && hasHolderText(o, n)) return true; return false; };

// ---- Text slots ----------------------------------------------------------------------------
const textSlotVisible = i => o => i === 1 || hasText(o, i) || hasText(o, i - 1);
function textFields(i) {
  const k = textKeys(i), vis = textSlotVisible(i), group = "text", section = `text${i}`;
  const d = DEFAULT_TEXT[i] ?? {};
  return {
    [k.text]: { type: "text", label: `Text ${i}`, max: 80, optional: true, multiline: true, default: d.text ?? "", help: i === 1 ? "Leave a text empty to remove it. New lines are allowed. The built-in font prints capital letters, digits and common punctuation; other fonts leave out characters they don't have." : undefined, visibleWhen: vis, group, section },
    [k.x]: posField("Left / right", d.x ?? 0, { visibleWhen: o => vis(o) && hasText(o, i), group, section, help: "Distance from the board's middle. For left-aligned text this is where the text starts; for right-aligned text, where it ends." }),
    [k.y]: posField("Up / down", d.y ?? 0, { visibleWhen: o => vis(o) && hasText(o, i), group, section }),
    [k.size]: { type: "number", label: "Letter height", min: 2.5, max: 60, step: 0.1, default: d.size ?? 6, unit: "mm", randomize: false, visibleWhen: o => hasText(o, i), group, section, help: "The height of capital letters." },
    [k.align]: { type: "enum", label: "Alignment", options: [{ value: "left", label: "Left" }, { value: "center", label: "Centered" }, { value: "right", label: "Right" }], default: d.align ?? "center", randomize: false, visibleWhen: o => hasText(o, i), group, section },
    [k.color]: slotField("Color", d.color ?? "3", { visibleWhen: o => hasText(o, i), group, section }),
    [k.rot]: { type: "number", label: "Rotate", min: -90, max: 90, step: 1, default: 0, unit: "°", randomize: false, visibleWhen: o => hasText(o, i), group, section },
    [k.fit]: { type: "number", label: "Maximum width", min: 0, max: 250, step: 1, default: d.fit ?? 0, unit: "mm", randomize: false, visibleWhen: o => hasText(o, i), group, section, help: "0 = no limit. A longer text is shrunk to fit this width." },
    ...locationFontField(k.font, "Font for this text", { group, section, visibleWhen: o => hasText(o, i) })
  };
}

// ---- Shape slots ---------------------------------------------------------------------------
const decoSlotVisible = j => o => j === 1 || hasDeco(o, j) || hasDeco(o, j - 1);
const kindIs = (j, kinds) => o => kinds.includes(o[`d${j}_kind`]);
function decoFields(j) {
  const k = decoKeys(j), vis = decoSlotVisible(j), group = "decor", section = `deco${j}`;
  const d = DEFAULT_DECO[j] ?? {};
  const on = o => hasDeco(o, j);
  return {
    [k.kind]: { type: "enum", label: `Shape ${j}`, options: DECO_KINDS, default: d.kind ?? "none", randomize: false, visibleWhen: vis, group, section },
    [k.x]: posField("Left / right", d.x ?? 0, { visibleWhen: on, group, section }),
    [k.y]: posField("Up / down", d.y ?? 0, { visibleWhen: on, group, section }),
    [k.w]: { type: "number", label: "Width", min: 1, max: 250, step: 0.1, default: d.w ?? 20, unit: "mm", randomize: false, visibleWhen: on, group, section },
    [k.h]: { type: "number", label: "Height", min: 1, max: 220, step: 0.1, default: d.h ?? 20, unit: "mm", randomize: false, visibleWhen: o => on(o) && o[k.kind] !== "line", group, section },
    [k.stroke]: { type: "number", label: "Line thickness", min: 0.8, max: 8, step: 0.2, default: d.stroke ?? 1.2, unit: "mm", randomize: false, visibleWhen: kindIs(j, STROKE_KINDS), group, section, help: "At least 0.8 mm so a 0.4 mm nozzle prints it cleanly." },
    [k.radius]: { type: "number", label: "Corner radius", min: 0, max: 60, step: 0.5, default: d.radius ?? 6, unit: "mm", randomize: false, visibleWhen: kindIs(j, RADIUS_KINDS), group, section },
    [k.sweep]: { type: "number", label: "Arc length", min: 30, max: 340, step: 5, default: d.sweep ?? 270, unit: "°", randomize: false, visibleWhen: kindIs(j, ["arc"]), group, section },
    [k.rot]: { type: "number", label: "Rotate", min: -180, max: 180, step: 1, default: d.rot ?? 0, unit: "°", randomize: false, visibleWhen: on, group, section },
    [k.color]: slotField("Color", d.color ?? "2", { visibleWhen: on, group, section })
  };
}

// ---- Holder lettering ----------------------------------------------------------------------
function holderTextFields(n) {
  const k = holderTextKeys(n), group = "holder", section = "holdertext";
  const vis = o => wantsHolder(o) && (n === 1 || hasHolderText(o, n) || hasHolderText(o, n - 1));
  const used = o => wantsHolder(o) && hasHolderText(o, n);
  return {
    [k.text]: { type: "text", label: `Holder lettering ${n}`, max: 60, optional: true, multiline: true, default: "", help: n === 1 ? "Raised lettering on the holder's front face. Leave empty for none." : undefined, visibleWhen: vis, group, section },
    [k.x]: posField("Left / right", n === 1 ? -60 : 60, { min: -125, max: 125, visibleWhen: used, group, section }),
    [k.y]: { type: "number", label: "Up / down", min: -20, max: 20, step: 0.5, default: 0, unit: "mm", randomize: false, visibleWhen: used, group, section },
    [k.size]: { type: "number", label: "Letter height", min: 2.5, max: 20, step: 0.1, default: 4, unit: "mm", randomize: false, visibleWhen: used, group, section },
    [k.color]: slotField("Color", "2", { visibleWhen: used, group, section }),
    ...locationFontField(k.font, "Font for this lettering", { group, section, visibleWhen: used })
  };
}

const DEFAULT_TEXT = {
  1: { text: "YOUR BUSINESS", x: 0, y: 44, size: 12, color: "2", fit: 150 },
  2: { text: "TAGLINE OR SLOGAN", x: 0, y: 28, size: 6, color: "3", fit: 150 },
  3: { text: "555-123-4567", x: -60, y: 2, size: 6, color: "3", align: "left", fit: 80 },
  4: { text: "YOURSITE.COM", x: -60, y: -14, size: 6, color: "3", align: "left", fit: 80 },
  5: { text: "SCAN ME", x: 52, y: -40, size: 5.7, color: "3" }
};
const DEFAULT_DECO = {
  1: { kind: "frame", x: 0, y: 0, w: 178, h: 138, radius: 10, stroke: 1.4, color: "2" },
  2: { kind: "line", x: 0, y: 18, w: 120, stroke: 1.2, color: "2" },
  3: { kind: "phone", x: -72, y: 2, w: 5.5, h: 9, color: "2" },
  4: { kind: "globe", x: -72, y: -14, w: 8, h: 8, color: "2" }
};

// ---- Rules ---------------------------------------------------------------------------------
function rules(o) {
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const T = o.thickness_mm, R = o.relief_mm;
  const maxRelief = round1(Math.min(RELIEF_RANGE[1], T - MIN_BODY_MM));
  const limits = { relief_mm: [RELIEF_RANGE[0], Math.max(RELIEF_RANGE[0], maxRelief)] };
  if (Number.isFinite(R) && Number.isFinite(T) && R > maxRelief + EPS) {
    add(["relief_mm"], `Relief height must be ${RELIEF_RANGE[0]}–${maxRelief} mm for a ${T} mm sign (at least ${MIN_BODY_MM} mm of body stays underneath).`);
  }
  const tongueMax = Math.max(TONGUE_W_RANGE[0], Math.min(TONGUE_W_RANGE[1], o.board_w_mm - 10));
  limits.tongue_w_mm = [TONGUE_W_RANGE[0], tongueMax];
  if (wantsSign(o) && o.tongue && Number.isFinite(o.tongue_w_mm) && o.tongue_w_mm > tongueMax + EPS) {
    add(["tongue_w_mm"], `The tongue must be at least 10 mm narrower than the ${o.board_w_mm} mm board (at most ${tongueMax} mm).`);
  }
  const pocket = wantsHolder(o) && o.holder_card;
  const minHolderW = Math.min(250, Math.max(80, o.tongue_w_mm + 2 * HOLDER_WALL_MM, pocket ? pocketWidthMm(o) + 2 * HOLDER_WALL_MM : 0));
  limits.holder_w_mm = [minHolderW, 250];
  if (wantsHolder(o) && Number.isFinite(o.holder_w_mm) && o.holder_w_mm < minHolderW - EPS) {
    add(["holder_w_mm"], `The holder must be at least ${minHolderW} mm wide for the tongue${pocket ? " and the card pocket" : ""} with a ${HOLDER_WALL_MM} mm wall on each side.`);
  }
  const layout = holderLayout(o);
  const minDepth = Math.min(120, layout.minDepth);
  limits.holder_d_mm = [minDepth, 120];
  if (wantsHolder(o) && Number.isFinite(o.holder_d_mm) && o.holder_d_mm < layout.minDepth - EPS) {
    add(["holder_d_mm"], `The holder must be at least ${layout.minDepth} mm deep ${pocket ? "for the card pocket, the slot and a wall at the front" : "to hold the sign"} with this front slope. Make it deeper or reduce the slope.`);
  }
  limits.seat_mm = [6, Math.max(6, Math.min(30, o.holder_h_mm - 8))];
  if (wantsHolder(o) && Number.isFinite(o.seat_mm)) {
    if (o.seat_mm > o.holder_h_mm - 8 + EPS) add(["seat_mm"], `The tongue must go at least 8 mm into the holder: lower the seat height to at most ${o.holder_h_mm - 8} mm or make the holder taller.`);
    else if (layout.boardBottom < o.holder_h_mm + BOARD_CLEAR_MM - EPS) add(["seat_mm", "tongue_h_mm"], `With this tongue the sign's lower edge would sit inside the holder. Raise the seat height to at least ${layout.minSeat} mm, lengthen the tongue or make the holder shorter.`);
  }
  const font = fontRule(o, anyText(o));
  if (font.errors.length) add([FONT_ACK_KEY], font.errors[0]);
  const body = slotHex(o, "1");
  if (wantsSign(o)) {
    for (let i = 1; i <= TEXT_SLOTS; i++) {
      const k = textKeys(i);
      if (hasText(o, i) && slotHex(o, o[k.color]) === body) add([k.color], `Text ${i} has the same color as the sign body, so it would not show. Choose another color or change Color 1.`);
    }
    if (o.qr_on) {
      if (!String(o.qr_data ?? "").trim()) add(["qr_data"], "Enter what the QR code should open (a web address, for example).");
      else {
        const estimate = qrModuleEstimate(qrPayload(o), o.qr_size_mm);
        if (!estimate) add(["qr_data"], "That QR content is too long to encode. Shorten it.");
        else if (estimate.level === "unprintable") add(["qr_size_mm", "qr_data"], estimate.message);
      }
      const tile = o.qr_quiet_mm > 0 && o.qr_tile !== "1" ? slotHex(o, o.qr_tile) : body;
      if (slotHex(o, o.qr_ink) === tile) add(["qr_ink"], "The QR code's dark modules and its background have the same color, so it could not be scanned.");
      else if (contrastRatio(slotHex(o, o.qr_ink), tile) < 3 - EPS) add(["qr_ink"], "The QR code's dark modules and its background are too similar to scan reliably. Choose colors that contrast more.");
    }
  }
  return { limits, errors, fieldErrors };
}

function errorField(message) {
  const text = String(message ?? "");
  if (/qr/i.test(text)) return "qr_data";
  if (/image|traced|logo/i.test(text)) return "logo";
  if (/font file|installed font/i.test(text)) return "font";
  if (/holder.*wide|card pocket/i.test(text)) return "holder_w_mm";
  if (/tongue/i.test(text)) return "tongue_w_mm";
  return null;
}

const wantsLogo = o => wantsSign(o) && o.logo === "custom";
const sectionOf = (fields, section) => Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, { ...d, section }]));

const SCHEMA = {
  output: { type: "enum", label: "What to make", options: [
    { value: "both", label: "Sign and holder" },
    { value: "sign", label: "Sign only" },
    { value: "holder", label: "Holder only" }
  ], default: "both", randomize: false, group: "size", section: "sign", help: "Both pieces share one file, the holder below the sign. A large sign and holder together may not fit one print bed: choose one piece and order the other separately." },
  board_w_mm: { type: "number", label: "Board width", min: BOARD_W[0], max: BOARD_W[1], step: 1, default: 190, unit: "mm", randomize: false, visibleWhen: wantsSign, group: "size", section: "sign" },
  board_h_mm: { type: "number", label: "Board height", min: BOARD_H[0], max: BOARD_H[1], step: 1, default: 150, unit: "mm", randomize: false, visibleWhen: wantsSign, group: "size", section: "sign" },
  corner_radius_mm: { type: "number", label: "Corner radius", min: 0, max: 40, step: 1, default: 12, unit: "mm", randomize: false, visibleWhen: wantsSign, group: "size", section: "sign" },
  thickness_mm: { type: "number", label: "Sign thickness", min: 3, max: 8, step: 0.2, default: 4.8, unit: "mm", randomize: false, visibleWhen: wantsSign, group: "size", section: "sign", help: "Body plus raised artwork." },
  relief_mm: { type: "number", label: "Raised artwork height", min: RELIEF_RANGE[0], max: RELIEF_RANGE[1], step: 0.2, default: 0.8, unit: "mm", randomize: false, visibleWhen: wantsSign, group: "size", section: "sign" },
  tongue: { type: "bool", label: "Mounting tongue for the holder", default: true, randomize: false, visibleWhen: wantsSign, group: "size", section: "sign" },
  tongue_w_mm: { type: "number", label: "Tongue width", min: TONGUE_W_RANGE[0], max: TONGUE_W_RANGE[1], step: 1, default: 140, unit: "mm", randomize: false, visibleWhen: o => wantsSign(o) && o.tongue, group: "size", section: "sign" },
  tongue_h_mm: { type: "number", label: "Tongue height", min: TONGUE_H_RANGE[0], max: TONGUE_H_RANGE[1], step: 1, default: 24, unit: "mm", randomize: false, visibleWhen: o => o.tongue || wantsHolder(o), group: "size", section: "sign" },

  ...Object.fromEntries(PALETTE_KEYS.map((key, i) => [key, {
    type: "color", label: i === 0 ? "Color 1: sign body" : `Color ${i + 1}`, default: ["#fefdf9", "#1f6f8b", "#232a2e", "#e0a526", "#6b8e45"][i], group: "colors", section: "colors",
    help: i === 0 ? "Everything below picks from these five colors. A sign can use at most five." : undefined
  }])),

  ...sectionOf({
    logo: { type: "enum", label: "Logo", options: [{ value: "none", label: "None" }, { value: "custom", label: "My own image" }], default: "none", randomize: false, visibleWhen: wantsSign, group: "logo" },
    logo_colors: { type: "int", label: "Logo colors", min: 1, max: 4, step: 1, default: 1, randomize: false, visibleWhen: wantsLogo, group: "logo", help: "1 prints a single-color silhouette. 2–4 snaps the image to Colors 2, 3, 4 and 5 in order, leaving its plain background out." },
    logo_color: slotField("Silhouette color", "2", { visibleWhen: o => wantsLogo(o) && o.logo_colors === 1, group: "logo" }),
    logo_threshold: { type: "int", label: "Image threshold", min: 0, max: 255, step: 1, default: 128, randomize: false, visibleWhen: o => wantsLogo(o) && o.logo_colors === 1, group: "logo" },
    logo_invert: { type: "bool", label: "Invert: trace the light parts instead of the dark parts", default: false, randomize: false, visibleWhen: o => wantsLogo(o) && o.logo_colors === 1, group: "logo" },
    logo_x: posField("Left / right", -35, { visibleWhen: wantsLogo, group: "logo" }),
    logo_y: posField("Up / down", 18, { visibleWhen: wantsLogo, group: "logo" }),
    logo_w: { type: "number", label: "Largest width", min: 10, max: 250, step: 1, default: 80, unit: "mm", randomize: false, visibleWhen: wantsLogo, group: "logo", help: "The logo keeps its proportions inside this width and height." },
    logo_h: { type: "number", label: "Largest height", min: 10, max: 220, step: 1, default: 60, unit: "mm", randomize: false, visibleWhen: wantsLogo, group: "logo" }
  }, "logo"),

  ...sectionOf({
    qr_on: { type: "bool", label: "QR code", default: true, randomize: false, visibleWhen: wantsSign, group: "qr" },
    qr_data: { type: "text", label: "QR content", max: 300, optional: true, default: "yourbusiness.com", randomize: false, visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr", help: "What a phone opens after scanning: a web address, usually." },
    qr_x: posField("Left / right", 52, { visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr" }),
    qr_y: posField("Up / down", -8, { visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr" }),
    qr_size_mm: { type: "number", label: "Code size", min: 20, max: 120, step: 0.1, default: 44, unit: "mm", randomize: false, visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr", help: "The dark-module area. Every module should print at least 1 mm wide to scan dependably." },
    qr_quiet_mm: { type: "number", label: "Background margin", min: 0, max: 12, step: 0.1, default: 4, unit: "mm", randomize: false, visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr", help: "The plain margin around the code that scanners need. 0 = none." },
    qr_tile: slotField("Background color", "1", { visibleWhen: o => wantsSign(o) && o.qr_on && o.qr_quiet_mm > 0, group: "qr" }),
    qr_ink: slotField("Module color", "3", { visibleWhen: o => wantsSign(o) && o.qr_on, group: "qr" })
  }, "qr"),

  ...Object.assign({}, ...Array.from({ length: TEXT_SLOTS }, (_, i) => textFields(i + 1))),
  ...Object.assign({}, ...Array.from({ length: DECO_SLOTS }, (_, j) => decoFields(j + 1))),

  // The shared font control: the main font every text uses unless it picks its own.
  ...sectionOf(fontSchema("text", anyText), "text1"),

  holder_card: { type: "bool", label: "Business-card pocket", default: true, randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  card_w_mm: { type: "number", label: "Card width", min: 80, max: 100, step: 0.5, default: 89, unit: "mm", randomize: false, visibleWhen: o => wantsHolder(o) && o.holder_card, group: "holder", section: "holder", help: "A standard card is 89 mm wide. The pocket adds 2 mm each side." },
  holder_w_mm: { type: "number", label: "Holder width", min: 80, max: 250, step: 1, default: 190, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  holder_d_mm: { type: "number", label: "Holder depth", min: 30, max: 120, step: 1, default: 70, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  seat_mm: { type: "number", label: "Sign seat height", min: 6, max: 30, step: 0.5, default: 14, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder", help: "Height of the slot floor the tongue rests on. The sign's lower edge sits this far up plus the tongue's height." },
  card_h_mm: { type: "number", label: "Card height", min: 45, max: 70, step: 0.5, default: 55, unit: "mm", randomize: false, visibleWhen: o => wantsHolder(o) && o.holder_card, group: "holder", section: "holder", help: "How tall the cards stand in the pocket (a standard card is 51 mm; 55 allows for a sleeve). Lettering low on the sign is warned about when the cards would hide it." },
  pocket_depth_mm: { type: "number", label: "Pocket depth", min: 10, max: 40, step: 1, default: 24, unit: "mm", randomize: false, visibleWhen: o => wantsHolder(o) && o.holder_card, group: "holder", section: "holder", help: "Front to back. A stack of cards needs 10 mm or more." },
  holder_h_mm: { type: "number", label: "Holder height", min: 24, max: 60, step: 1, default: 36, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  holder_taper_mm: { type: "number", label: "Front slope", min: 0, max: 16, step: 1, default: 8, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder", help: "How far the front face leans back from bottom to top." },
  holder_radius_mm: { type: "number", label: "Corner radius", min: 0, max: 20, step: 1, default: 8, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  lean_deg: { type: "number", label: "Sign lean", min: 0, max: 15, step: 1, default: 8, unit: "°", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder", help: "How far the sign leans back in the holder." },
  fit_gap_mm: { type: "number", label: "Slot clearance", min: 0.2, max: 1, step: 0.1, default: 0.5, unit: "mm", randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder", help: "Extra room in the slot beyond the tongue's thickness. Print a test if you tune it." },
  pocket_floor_mm: { type: "number", label: "Pocket floor", min: 3, max: 10, step: 0.2, default: 4.4, unit: "mm", randomize: false, visibleWhen: o => wantsHolder(o) && o.holder_card, group: "holder", section: "holder" },
  holder_color: slotField("Holder color", "1", { visibleWhen: wantsHolder, group: "holder", section: "holder" }),
  holder_stripes: { type: "bool", label: "Accent stripes around the holder", default: false, randomize: false, visibleWhen: wantsHolder, group: "holder", section: "holder" },
  holder_stripe_color: slotField("Stripe color", "2", { visibleWhen: o => wantsHolder(o) && o.holder_stripes, group: "holder", section: "holder" }),
  ...Object.assign({}, ...Array.from({ length: HOLDER_TEXT_SLOTS }, (_, n) => holderTextFields(n + 1)))
};

const SECTIONS = {
  sign: "Sign board",
  colors: "Colors",
  logo: "Logo",
  qr: "QR code",
  ...Object.fromEntries(Array.from({ length: TEXT_SLOTS }, (_, i) => [`text${i + 1}`, `Text ${i + 1}`])),
  ...Object.fromEntries(Array.from({ length: DECO_SLOTS }, (_, j) => [`deco${j + 1}`, `Shape ${j + 1}`])),
  holder: "Holder",
  holdertext: "Holder lettering"
};
const FOCUS = [
  { part: "Sign body", section: "sign" },
  { part: "Sign art", section: "sign" },
  { part: "Holder", section: "holder" },
  { part: "Holder lettering", section: "holdertext" }
];

export default {
  id: "display-sign",
  version: 1,
  title: "Display sign and holder",
  blurb: "A freeform countertop sign: place text, shapes, your logo and a QR code anywhere, in your own fonts and five colors, in a holder with or without a business-card pocket.",
  category: "badges",
  origin: "house",
  rights: { publishable: true, note: "House design. Logos are the customer's own and are traced in their browser." },
  schema: SCHEMA,
  rules,
  errorField,
  sections: SECTIONS,
  focus: FOCUS,
  presets: PRESETS,
  designs: DESIGNS,
  defaultDesign: "starter",
  font: FONT_SPEC,
  // The page traces a customer logo while `when` holds. With 2–4 logo colors the image is snapped
  // to those palette colors (Colors 2..), one layer each; with 1 it is a threshold silhouette.
  image: {
    when: { logo: "custom" },
    threshold: "logo_threshold",
    invert: "logo_invert",
    layers: o => (o.logo_colors > 1 ? PALETTE_KEYS.slice(1, 1 + o.logo_colors).map(key => o[key]) : null)
  }
};
