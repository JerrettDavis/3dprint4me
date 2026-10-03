// Route shield: parameter schema and geometry rules (ported from the prototype's limits.js).
//
// Sign convention for front parameters:
//   field_height_mm  > 0  color field rises above the base top
//                    < 0  color layer of that thickness is recessed: its top sits |f|
//                         below the base top (an |f| lip), in a pocket 2|f| deep
//   text_height_mm   > 0  text rises above the color field top
//                    < 0  text is cut |t| into the color's top surface
// Back/bottom inlays (inlay_depth_mm) are always inset and never protrude.

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

// Every rule violated by `o`, as messages. Empty means the geometry is valid.
function validateOptions(o) {
  const errors = [];
  const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo - EPS && v <= hi + EPS;
  if (!inRange(o.width_mm, WIDTH_RANGE)) errors.push(`Width must be ${WIDTH_RANGE[0]}–${WIDTH_RANGE[1]} mm.`);
  if (!inRange(o.base_thickness_mm, BASE_RANGE)) errors.push(`Base thickness must be ${BASE_RANGE[0]}–${BASE_RANGE[1]} mm.`);
  if (!inRange(o.height_mm, HEIGHT_RANGE)) errors.push(`Height must be ${HEIGHT_RANGE[0]}–${HEIGHT_RANGE[1]} mm.`);
  for (const k of LAYOUT_KEYS) {
    const sc = o[`${k}_scale_pct`] ?? 100, off = o[`${k}_offset_mm`] ?? 0;
    if (!inRange(sc, SCALE_RANGE)) errors.push(`${k} text size must be ${SCALE_RANGE[0]}–${SCALE_RANGE[1]}%.`);
    if (!inRange(off, OFFSET_RANGE)) errors.push(`${k} text offset must be ${OFFSET_RANGE[0]} to ${OFFSET_RANGE[1]} mm.`);
  }
  if (errors.length) return errors;

  const L = computeLimits(o);
  if (!(o.inlay_depth_mm > 0)) errors.push("Back inlay must be recessed into the base; protrusions are not allowed.");
  else if (!inRange(o.inlay_depth_mm, L.inlay_depth_mm)) errors.push(`Back inlay depth must be ${L.inlay_depth_mm[0]}–${L.inlay_depth_mm[1]} mm for this base and color inset.`);

  if (!Number.isFinite(o.field_height_mm) || Math.abs(o.field_height_mm) < STEP - EPS) errors.push(`Color field height can't be zero or smaller than ${STEP} mm (use + to raise, − to inset).`);
  else if (!inRange(o.field_height_mm, L.field_height_mm)) errors.push(`Color field height must be ${L.field_height_mm[0]} to ${L.field_height_mm[1]} mm for this base and back inlay.`);

  if (!Number.isFinite(o.text_height_mm) || Math.abs(o.text_height_mm) < STEP - EPS) errors.push(`Text height can't be zero or smaller than ${STEP} mm (use + to raise, − to cut).`);
  else if (!inRange(o.text_height_mm, L.text_height_mm)) errors.push(`Text height must be ${L.text_height_mm[0]} to ${L.text_height_mm[1]} mm; text can only be cut as deep as the color is thick.`);
  return errors;
}

function rules(params) {
  const errors = validateOptions(params);
  if (!errors.length && params.qr_enabled && !String(params.qr_data || "").trim()) errors.push("QR content is required when QR is enabled.");
  return { limits: computeLimits(params), errors };
}

const scale = (label, what) => ({ type: "number", label: `${label} text size`, min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: 5, default: 100, unit: "%", group: what });
const offset = (label, what) => ({ type: "number", label: `${label} text up/down`, min: OFFSET_RANGE[0], max: OFFSET_RANGE[1], step: 0.5, default: 0, unit: "mm", group: what });

export default {
  id: "route-shield",
  version: 1,
  title: "Route shield",
  blurb: "Highway-style badge with two color fields, front text and an optional back QR code.",
  category: "badges",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: {
    top_text: { type: "text", label: "Upper text", max: 18, optional: true, default: "ROUTE", group: "text" },
    lower_text: { type: "text", label: "Lower text", max: 18, optional: true, default: "66", group: "text" },
    font_mode: { type: "enum", label: "Font", options: [{ value: "block", label: "Built-in block font" }, { value: "font", label: "Font file" }], default: "block", group: "text" },
    width_mm: { type: "number", label: "Width", min: WIDTH_RANGE[0], max: WIDTH_RANGE[1], step: 1, default: 80, unit: "mm", group: "size" },
    height_mm: { type: "number", label: "Height", min: HEIGHT_RANGE[0], max: HEIGHT_RANGE[1], step: 1, default: 88, unit: "mm", group: "size" },
    base_thickness_mm: { type: "number", label: "Base thickness", min: BASE_RANGE[0], max: BASE_RANGE[1], step: STEP, default: 4, unit: "mm", group: "size" },
    field_height_mm: { type: "number", label: "Color field", min: -MAX_FIELD, max: MAX_FIELD, step: STEP, default: 0.6, unit: "mm", group: "size" },
    text_height_mm: { type: "number", label: "Front text", min: -MAX_TEXT, max: MAX_TEXT, step: STEP, default: 1.2, unit: "mm", group: "size" },
    inlay_depth_mm: { type: "number", label: "Back inlay (recessed)", min: 0.4, max: MAX_INLAY, step: STEP, default: 0.8, unit: "mm", group: "size" },
    top_scale_pct: scale("Upper", "layout"),
    top_offset_mm: offset("Upper", "layout"),
    lower_scale_pct: scale("Lower", "layout"),
    lower_offset_mm: offset("Lower", "layout"),
    back_scale_pct: scale("Back", "layout"),
    back_offset_mm: offset("Back", "layout"),
    back_text: { type: "text", label: "Back text, up to 4 lines", max: 160, multiline: true, optional: true, default: "100 Years on the Mother Road\n1926-2026\nTulsa, OK", group: "back" },
    qr_enabled: { type: "bool", label: "Include QR code", default: true, group: "back" },
    qr_data: { type: "text", label: "QR content", max: 400, optional: true, default: "https://3dprint4.me/", group: "back" },
    base_color: { type: "color", label: "Body", default: "#ffffff", group: "colors" },
    upper_color: { type: "color", label: "Upper", default: "#ef233c", group: "colors" },
    lower_color: { type: "color", label: "Lower", default: "#2797e8", group: "colors" },
    text_color: { type: "color", label: "Front text", default: "#ffffff", group: "colors" },
    back_color: { type: "color", label: "Back inlay", default: "#171717", group: "colors" }
  },
  rules,
  presets: { default: {}, "small-66": { width_mm: 52, height_mm: 58 } }
};
