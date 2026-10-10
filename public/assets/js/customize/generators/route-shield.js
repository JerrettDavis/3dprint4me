// Route shield: parameter schema and geometry rules (ported from the prototype's limits.js).
//
// Sign convention for front parameters:
//   field_height_mm  > 0  color field rises above the base top
//                    < 0  color layer of that thickness is recessed: its top sits |f|
//                         below the base top (an |f| lip), in a pocket 2|f| deep
//   text_height_mm   > 0  text rises above the color field top
//                    < 0  text is cut |t| into the color's top surface
// Back/bottom inlays (inlay_depth_mm) are always inset and never protrude.

import { fontSchema, fontRule, locationFontField, FONT_SPEC, FONT_ACK_KEY } from "../fonts.js?v=d34d74bea0b5707a";
import { qrScaleField } from "../qr.js?v=d34d74bea0b5707a";

const STEP = 0.2;
const MIN_WEB = 0.8;       // solid base left between the front pocket and the back inlay
const MAX_FIELD = 5;
const MAX_TEXT = 5;
const BASE_RANGE = [2.4, 20];
const WIDTH_RANGE = [50, 250];
const HEIGHT_RANGE = [50, 250];
const MAX_INLAY = 4;
const SCALE_RANGE = [20, 150];
const OFFSET_RANGE = [-20, 20];
const LAYOUT_KEYS = ["top", "lower", "back"];

const EPS = 1e-6;
const floorStep = v => Math.floor(v / STEP + EPS) * STEP;
const round1 = v => Math.round(v * 10) / 10;

// Range each slider may currently take, given the other parameter values.
function computeLimits(o) {
  const T = o.base_thickness_mm;
  const pocket = 2 * Math.max(0, -o.field_height_mm);
  const inlayMax = Math.max(0.4, floorStep(Math.min(MAX_INLAY, T * 0.45, T - MIN_WEB - pocket)));
  const insetMax = floorStep(Math.min(MAX_FIELD, (T - MIN_WEB - o.inlay_depth_mm) / 2));
  const fieldThickness = Math.abs(o.field_height_mm);
  return {
    width_mm: WIDTH_RANGE,
    height_mm: HEIGHT_RANGE,
    base_thickness_mm: BASE_RANGE,
    inlay_depth_mm: [0.4, round1(inlayMax)],
    field_height_mm: [insetMax >= STEP ? -round1(insetMax) : STEP, MAX_FIELD],
    text_height_mm: [-round1(Math.min(fieldThickness || STEP, MAX_TEXT)), MAX_TEXT]
  };
}

// Every rule violated by `o`, as { key, message } (key = the field the message belongs next to).
// Empty means the geometry is valid.
function validateOptions(o) {
  const errors = [];
  const add = (key, message) => errors.push({ key, message });
  const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo - EPS && v <= hi + EPS;
  if (!inRange(o.width_mm, WIDTH_RANGE)) add("width_mm", `Width must be ${WIDTH_RANGE[0]}–${WIDTH_RANGE[1]} mm.`);
  if (!inRange(o.base_thickness_mm, BASE_RANGE)) add("base_thickness_mm", `Base thickness must be ${BASE_RANGE[0]}–${BASE_RANGE[1]} mm.`);
  if (!inRange(o.height_mm, HEIGHT_RANGE)) add("height_mm", `Height must be ${HEIGHT_RANGE[0]}–${HEIGHT_RANGE[1]} mm.`);
  for (const k of LAYOUT_KEYS) {
    const sc = o[`${k}_scale_pct`] ?? 100, off = o[`${k}_offset_mm`] ?? 0;
    if (!inRange(sc, SCALE_RANGE)) add(`${k}_scale_pct`, `${k} text size must be ${SCALE_RANGE[0]}–${SCALE_RANGE[1]}%.`);
    if (!inRange(off, OFFSET_RANGE)) add(`${k}_offset_mm`, `${k} text offset must be ${OFFSET_RANGE[0]} to ${OFFSET_RANGE[1]} mm.`);
  }
  if (errors.length) return errors;

  const L = computeLimits(o);
  if (!(o.inlay_depth_mm > 0)) add("inlay_depth_mm", "Back inlay must be recessed into the base; protrusions are not allowed.");
  else if (!inRange(o.inlay_depth_mm, L.inlay_depth_mm)) add("inlay_depth_mm", `Back inlay depth must be ${L.inlay_depth_mm[0]}–${L.inlay_depth_mm[1]} mm for this base and color inset.`);

  if (!Number.isFinite(o.field_height_mm) || Math.abs(o.field_height_mm) < STEP - EPS) add("field_height_mm", `Color field height can't be zero or smaller than ${STEP} mm (use + to raise, − to inset).`);
  else if (!inRange(o.field_height_mm, L.field_height_mm)) add("field_height_mm", `Color field height must be ${L.field_height_mm[0]} to ${L.field_height_mm[1]} mm for this base and back inlay.`);

  if (!Number.isFinite(o.text_height_mm) || Math.abs(o.text_height_mm) < STEP - EPS) add("text_height_mm", `Text height can't be zero or smaller than ${STEP} mm (use + to raise, − to cut).`);
  else if (!inRange(o.text_height_mm, L.text_height_mm)) add("text_height_mm", `Text height must be ${L.text_height_mm[0]} to ${L.text_height_mm[1]} mm; text can only be cut as deep as the color is thick.`);
  return errors;
}

function rules(params) {
  const found = validateOptions(params);
  if (!found.length && params.qr_enabled && !String(params.qr_data || "").trim()) found.push({ key: "qr_data", message: "QR content is required when QR is enabled." });
  const font = fontRule(params);
  if (font.errors.length) found.push({ key: FONT_ACK_KEY, message: font.errors[0] });
  const fieldErrors = {};
  for (const { key, message } of found) fieldErrors[key] ??= message;
  return { limits: computeLimits(params), errors: found.map(e => e.message), fieldErrors };
}

// Maps a geometry (build) error message to the field it belongs next to, or null.
function errorField(message) {
  const text = String(message ?? "");
  if (/^Upper text doesn't fit/i.test(text)) return "top_text";
  if (/^Lower text doesn't fit/i.test(text)) return "lower_text";
  if (/^Back text doesn't fit/i.test(text)) return "back_text";
  if (/QR code is scaled too small/i.test(text)) return "qr_scale_pct";
  if (/QR payload is too dense/i.test(text)) return "qr_data";
  if (/font file|installed font/i.test(text)) return "font";
  return null;
}

const scale = (label, section) => ({ type: "number", label: `${label} text size`, min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: 5, default: 100, unit: "%", group: "layout", section, randomize: false });
const offset = (label, section) => ({ type: "number", label: `${label} text up/down`, help: "0 = centered in its color field; positive moves it up.", min: OFFSET_RANGE[0], max: OFFSET_RANGE[1], step: 0.5, default: 0, unit: "mm", group: "layout", section, randomize: false });
const inSection = (fields, section) => Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, { ...d, section }]));

// Settings regions, in display order, and which previewed part focuses which one.
const SECTIONS = { general: "Font", top: "Upper text", lower: "Lower text", back: "Back text", qr: "QR code", shape: "Shape & thickness", colors: "Colors" };
const FOCUS = [
  { part: "Upper color field", section: "top" },
  { part: "Lower color field", section: "lower" },
  { part: "Upper text", section: "top" },
  { part: "Lower text", section: "lower" },
  { part: "Back text", section: "back" },
  { part: "QR code", section: "qr" },
  { part: "3dprint4.me mark", section: "shape" },
  { part: "Shield body", section: "shape" }
];

// Ready-made designs, offered before customizing (see docs/GENERATORS.md). Each is a partial
// parameter set over the defaults, so every one is also a complete, buildable shield.
const interstate = (number, route) => ({ top_text: "INTERSTATE", lower_text: String(number), back_text: route, top_scale_pct: 80 });
const DESIGNS = [
  { id: "route-66", label: "Route 66", blurb: "The Mother Road centennial badge. The default.", group: "Historic", params: {} },
  { id: "small-66", label: "Route 66, small", blurb: "A pocket-size 52 × 58 mm Route 66 badge.", group: "Historic", params: { width_mm: 52, height_mm: 58, back_text: "Route 66\n1926-2026" } },
  { id: "route-66-night", label: "Route 66, night drive", blurb: "A black shield with amber and gold fields.", group: "Historic", params: { base_color: "#171717", upper_color: "#c2410c", lower_color: "#b45309", text_color: "#fff7e6", back_color: "#c2410c" } },
  { id: "i-95", label: "Interstate 95", blurb: "Maine to Florida along the east coast.", group: "Interstates", params: interstate(95, "Interstate 95\nMaine to Florida") },
  { id: "i-10", label: "Interstate 10", blurb: "Santa Monica to Jacksonville across the south.", group: "Interstates", params: interstate(10, "Interstate 10\nSanta Monica to Jacksonville") },
  { id: "i-40", label: "Interstate 40", blurb: "Barstow to Wilmington, often along old Route 66.", group: "Interstates", params: interstate(40, "Interstate 40\nBarstow to Wilmington") },
  { id: "i-5", label: "Interstate 5", blurb: "Canada to Mexico down the west coast.", group: "Interstates", params: interstate(5, "Interstate 5\nCanada to Mexico") },
  { id: "i-80", label: "Interstate 80", blurb: "San Francisco to New Jersey.", group: "Interstates", params: interstate(80, "Interstate 80\nSan Francisco to New Jersey") },
  { id: "i-90", label: "Interstate 90", blurb: "Seattle to Boston, the longest interstate.", group: "Interstates", params: interstate(90, "Interstate 90\nSeattle to Boston") },
  { id: "i-66", label: "Interstate 66", blurb: "Front Royal to Washington, DC.", group: "Interstates", params: interstate(66, "Interstate 66\nFront Royal to Washington, DC") },
  { id: "us-1", label: "US Route 1", blurb: "Black and white US highway shield: Fort Kent to Key West.", group: "US and state routes", params: { top_text: "US", lower_text: "1", back_text: "US Route 1\nFort Kent to Key West", upper_color: "#171717", lower_color: "#171717", text_color: "#ffffff" } },
  { id: "us-101", label: "US Route 101", blurb: "Black and white US highway shield along the Pacific coast.", group: "US and state routes", params: { top_text: "US", lower_text: "101", back_text: "US Route 101\nOlympia to Los Angeles", upper_color: "#171717", lower_color: "#171717", text_color: "#ffffff" } },
  { id: "state-route", label: "State route", blurb: "A green state route badge to put your own number on.", group: "US and state routes", params: { top_text: "STATE ROUTE", lower_text: "9", top_scale_pct: 75, back_text: "State Route 9", upper_color: "#1b7a3f", lower_color: "#1b7a3f" } }
];

export default {
  id: "route-shield",
  // 2: the font control became the shared one (key font, was font_mode) with a license confirmation.
  // 3: *_offset_mm is measured from the automatically centered position (0 = centered); per-location
  //    fonts (top_font, lower_font, back_font) and an independent QR size (qr_scale_pct) were added.
  version: 3,
  title: "Route shield",
  blurb: "Highway-style badge with two color fields, front text and an optional back QR code.",
  category: "badges",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  sections: SECTIONS,
  focus: FOCUS,
  schema: {
    top_text: { type: "text", label: "Upper text", max: 18, optional: true, default: "ROUTE", group: "text", section: "top" },
    lower_text: { type: "text", label: "Lower text", max: 18, optional: true, default: "66", group: "text", section: "lower" },
    ...inSection(fontSchema("text"), "general"),
    ...locationFontField("top_font", "Upper text font", { group: "text", section: "top" }),
    ...locationFontField("lower_font", "Lower text font", { group: "text", section: "lower" }),
    width_mm: { randomize: false, type: "number", label: "Width", min: WIDTH_RANGE[0], max: WIDTH_RANGE[1], step: 1, default: 80, unit: "mm", group: "size", section: "shape" },
    height_mm: { randomize: false, type: "number", label: "Height", min: HEIGHT_RANGE[0], max: HEIGHT_RANGE[1], step: 1, default: 88, unit: "mm", group: "size", section: "shape" },
    base_thickness_mm: { type: "number", label: "Base thickness", min: BASE_RANGE[0], max: BASE_RANGE[1], step: STEP, default: 4, unit: "mm", group: "size", section: "shape" },
    field_height_mm: { type: "number", label: "Color field", min: -MAX_FIELD, max: MAX_FIELD, step: STEP, default: 0.6, unit: "mm", group: "size", section: "shape" },
    text_height_mm: { type: "number", label: "Front text", min: -MAX_TEXT, max: MAX_TEXT, step: STEP, default: 1.2, unit: "mm", group: "size", section: "shape" },
    inlay_depth_mm: { type: "number", label: "Back inlay (recessed)", min: 0.4, max: MAX_INLAY, step: STEP, default: 0.8, unit: "mm", group: "size", section: "shape" },
    top_scale_pct: scale("Upper", "top"),
    top_offset_mm: offset("Upper", "top"),
    lower_scale_pct: scale("Lower", "lower"),
    lower_offset_mm: offset("Lower", "lower"),
    back_scale_pct: scale("Back", "back"),
    back_offset_mm: { ...offset("Back", "back"), help: "Moves the back text lines up or down together." },
    back_text: { type: "text", label: "Back text, up to 4 lines", max: 160, multiline: true, optional: true, default: "100 Years on the Mother Road\n1926-2026\nTulsa, OK", group: "back", section: "back" },
    ...locationFontField("back_font", "Back text font", { group: "back", section: "back" }),
    qr_enabled: { type: "bool", label: "Include QR code", default: true, randomize: false, group: "back", section: "qr" },
    qr_data: { type: "text", label: "QR content", max: 400, optional: true, default: "https://3dprint4.me/", group: "back", section: "qr" },
    qr_scale_pct: qrScaleField("back", { section: "qr", visibleWhen: { qr_enabled: [true] }, help: "100% is the largest code that fits the bottom of the badge; larger cells scan more reliably." }),
    base_color: { type: "color", label: "Body", default: "#ffffff", group: "colors", section: "colors" },
    upper_color: { type: "color", label: "Upper", default: "#ef233c", group: "colors", section: "top" },
    lower_color: { type: "color", label: "Lower", default: "#2797e8", group: "colors", section: "lower" },
    text_color: { type: "color", label: "Front text", default: "#ffffff", group: "colors", section: "colors" },
    back_color: { type: "color", label: "Back inlay", default: "#171717", group: "colors", section: "colors" }
  },
  rules,
  errorField,
  font: FONT_SPEC,
  presets: { default: {}, "small-66": { width_mm: 52, height_mm: 58 } },
  designs: DESIGNS,
  defaultDesign: "route-66"
};
