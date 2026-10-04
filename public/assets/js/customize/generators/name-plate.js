// Name plate: parameter schema and rules. A name in the built-in block font, one of the curated
// self-hosted OFL fonts or the customer's own font file (parsed in the browser, never uploaded),
// raised, outlined, shadowed or inlaid on a pill or rectangle plate, or cut out with a backing
// outline (no plate). Optional keychain loop at the left end.
import { contrastRatio } from "../color.js?v=a80a70ed9e06345f";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY } from "../fonts.js?v=a80a70ed9e06345f";

const EPS = 1e-6;
const MIN_WEB = 0.8;           // plate kept under the relief (and under an inlay)
const RELIEF_RANGE = [0.6, 2];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;
const reliefMax = o => round1(Math.min(RELIEF_RANGE[1], o.thickness_mm - MIN_WEB));

const INLAY_NEEDS_PLATE = "Inlay needs a plate to sit in. Choose a pill or rectangle plate, or another style.";

function rules(o) {
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const maxRelief = reliefMax(o);
  if (Number.isFinite(o.relief_mm) && o.relief_mm > maxRelief + EPS) {
    add(["relief_mm"], `Letter height must be ${RELIEF_RANGE[0]}–${maxRelief} mm for a ${o.thickness_mm} mm plate (at least ${MIN_WEB} mm of plate stays underneath).`);
  }
  if (o.style === "inlay" && o.plate === "none") add(["style"], INLAY_NEEDS_PLATE);
  const font = fontRule(o);
  if (font.errors.length) add([FONT_ACK_KEY], font.errors[0]);
  // The letters must stand out from what they sit on: the plate, or with no plate the backing
  // outline (printed in the outline color).
  const [backKey, backLabel] = o.plate === "none" ? ["outline_color", "Outline and backing color"] : ["plate_color", "Plate color"];
  if (typeof o.text_color === "string" && typeof o[backKey] === "string") {
    const ratio = contrastRatio(o.text_color, o[backKey]);
    if (ratio < MIN_CONTRAST - EPS) add([backKey, "text_color"], `${backLabel} and Letter color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the name to stand out.`);
  }
  return { limits: { relief_mm: [RELIEF_RANGE[0], maxRelief] }, errors, fieldErrors };
}

// A committed edit that would pair inlay with no plate moves the other control instead.
function onParamChange(key, o) {
  if (key === "plate" && o.plate === "none" && o.style === "inlay") return { style: "raised" };
  if (key === "style" && o.style === "inlay" && o.plate === "none") return { plate: "pill" };
  return null;
}

// Maps a geometry (build) error to the control it belongs next to. A curated font that failed
// to download is not a settings problem: it stays unkeyed, so the page offers "Try again".
function errorField(message) {
  const text = String(message ?? "");
  if (/couldn't be loaded|isn't loaded/i.test(text)) return null;
  if (/font file|installed font|font isn't available/i.test(text)) return "font";
  if (/aren't connected/i.test(text)) return "plate";
  if (/characters|too small to read|name/i.test(text)) return "name";
  return null;
}

const SCHEMA = {
  name: { type: "text", label: "Name", max: 20, default: "Alex", help: "Up to 20 characters. Characters the chosen font doesn't have are left out.", group: "text" },
  ...fontSchema("text"),
  style: { type: "enum", label: "Style", options: [
    { value: "raised", label: "Raised letters" },
    { value: "outline", label: "Raised with an outline" },
    { value: "shadow", label: "Raised with a drop shadow" },
    { value: "inlay", label: "Inlaid, flush with the plate" }
  ], default: "raised", help: "Inlay needs a plate.", group: "text" },
  plate: { type: "enum", label: "Plate", options: [
    { value: "pill", label: "Pill" },
    { value: "rect", label: "Rounded rectangle" },
    { value: "none", label: "None: cut-out letters on a thin backing" }
  ], default: "pill", group: "shape" },
  keychain_loop: { type: "bool", label: "Keychain loop on the left", default: false, group: "shape" },
  height_mm: { type: "number", label: "Letter height (whole name)", min: 14, max: 60, step: 1, default: 24, unit: "mm", group: "size" },
  thickness_mm: { type: "number", label: "Total thickness", min: 2, max: 6, step: 0.2, default: 3, unit: "mm", group: "size" },
  relief_mm: { type: "number", label: "Letter relief", min: RELIEF_RANGE[0], max: RELIEF_RANGE[1], step: 0.2, default: 1.2, unit: "mm", group: "size" },
  text_color: { type: "color", label: "Letter color", default: "#ffffff", group: "colors" },
  plate_color: { type: "color", label: "Plate color", default: "#2a6f97", visibleWhen: { plate: ["pill", "rect"] }, group: "colors" },
  outline_color: { type: "color", label: "Outline and backing color", default: "#c1121f", visibleWhen: o => o.style === "outline" || o.style === "shadow" || o.plate === "none", group: "colors" }
};

const PRESETS = {
  keychain: { plate: "none", keychain_loop: true, height_mm: 16 },
  desk: { plate: "rect", height_mm: 30, thickness_mm: 4 },
  door: { plate: "pill", style: "shadow", height_mm: 40, thickness_mm: 4 }
};

export default {
  id: "name-plate",
  version: 1,
  title: "Name plate",
  blurb: "A name in a decorative font, raised, outlined, shadowed or inlaid on a plate, with an optional keychain loop.",
  category: "badges",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: SCHEMA,
  rules,
  onParamChange,
  errorField,
  presets: PRESETS,
  // The page drives the shared font control (installed font / font file / curated ids) from this.
  font: FONT_SPEC
};
