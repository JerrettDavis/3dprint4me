// Name plate: parameter schema and rules. A name in the built-in block font, one of the curated
// self-hosted OFL fonts or the customer's own font file (parsed in the browser, never uploaded),
// raised, outlined, shadowed or inlaid on a contour-hugging, pill or rectangle plate, or cut out
// with a backing outline (no plate). Optional keychain loop at the left end. Size "office" makes
// the standard 8 × 2 in desk sign and can add the customer's own image (traced in the browser and
// passed to the build as ctx.imageContours; never a parameter, as on the rating card).
import { contrastRatio } from "../color.js?v=6d9507f2af48b563";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY } from "../fonts.js?v=6d9507f2af48b563";

const EPS = 1e-6;
const MIN_WEB = 0.8;           // plate kept under the relief (and under an inlay)
const RELIEF_RANGE = [0.6, 2];
const MARGIN_RANGE = [1, 10];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;
const reliefMax = o => round1(Math.min(RELIEF_RANGE[1], o.thickness_mm - MIN_WEB));

const isOffice = o => o.size === "office";
// The plate the build actually makes: the office sign is always a rectangle.
const platePart = o => (isOffice(o) ? "rect" : o.plate);
const hasImage = o => isOffice(o) && o.plate_image === "custom";

const INLAY_NEEDS_PLATE = "Inlay needs a plate to sit in. Choose a contour, pill or rectangle plate, or another style.";

function rules(o) {
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const maxRelief = reliefMax(o);
  if (Number.isFinite(o.relief_mm) && o.relief_mm > maxRelief + EPS) {
    add(["relief_mm"], `Letter height must be ${RELIEF_RANGE[0]}–${maxRelief} mm for a ${o.thickness_mm} mm plate (at least ${MIN_WEB} mm of plate stays underneath).`);
  }
  if (o.style === "inlay" && platePart(o) === "none") add(["style"], INLAY_NEEDS_PLATE);
  const font = fontRule(o);
  if (font.errors.length) add([FONT_ACK_KEY], font.errors[0]);
  // The letters must stand out from what they sit on: the plate, or with no plate the backing
  // outline (printed in the outline color).
  const [backKey, backLabel] = platePart(o) === "none" ? ["outline_color", "Outline and backing color"] : ["plate_color", "Plate color"];
  if (typeof o.text_color === "string" && typeof o[backKey] === "string") {
    const ratio = contrastRatio(o.text_color, o[backKey]);
    if (ratio < MIN_CONTRAST - EPS) add([backKey, "text_color"], `${backLabel} and Letter color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the name to stand out.`);
  }
  if (hasImage(o) && typeof o.image_color === "string" && typeof o.plate_color === "string") {
    const ratio = contrastRatio(o.image_color, o.plate_color);
    if (ratio < MIN_CONTRAST - EPS) add(["image_color", "plate_color"], `Plate color and Image color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the image to stand out.`);
  }
  return { limits: { relief_mm: [RELIEF_RANGE[0], maxRelief] }, errors, fieldErrors };
}

// A committed edit that would pair inlay with no plate moves the other control instead.
function onParamChange(key, o) {
  if (key === "size" && !isOffice(o) && o.plate_image !== "none") return { plate_image: "none" };
  if (key === "plate" && o.plate === "none" && o.style === "inlay") return { style: "raised" };
  if (key === "style" && o.style === "inlay" && o.plate === "none") return { plate: "hug" };
  return null;
}

// Maps a geometry (build) error to the control it belongs next to. A curated font that failed
// to download is not a settings problem: it stays unkeyed, so the page offers "Try again".
function errorField(message) {
  const text = String(message ?? "");
  if (/couldn't be loaded|isn't loaded/i.test(text)) return null;
  if (/font file|installed font|font isn't available/i.test(text)) return "font";
  if (/image|traced/i.test(text)) return "plate_image";
  if (/aren't connected/i.test(text)) return "plate";
  if (/characters|too small to read|name/i.test(text)) return "name";
  return null;
}

// Settings regions, in display order, and which previewed part focuses which one. The plate has a
// single line of text, so there is no per-line font override: the main font is that line's font.
const SECTIONS = { name: "Name & font", style: "Letter style", plate: "Plate & keychain loop", size: "Size & depth", colors: "Colors" };
const FOCUS = [
  { part: "Name", section: "name" },
  { part: "Outline", section: "style" },
  { part: "Shadow", section: "style" },
  { part: "Image", section: "plate" },
  { part: "Plate", section: "plate" },
  { part: "Backing", section: "plate" }
];

const SCHEMA = {
  name: { type: "text", label: "Name", max: 20, default: "Alex", help: "Up to 20 characters. Characters the chosen font doesn't have are left out.", group: "text", section: "name" },
  ...Object.fromEntries(Object.entries(fontSchema("text")).map(([k, d]) => [k, { ...d, section: "name" }])),
  style: { type: "enum", label: "Style", options: [
    { value: "raised", label: "Raised letters" },
    { value: "outline", label: "Raised with an outline" },
    { value: "shadow", label: "Raised with a drop shadow" },
    { value: "inlay", label: "Inlaid, flush with the plate" }
  ], default: "raised", help: "Inlay needs a plate.", group: "text", section: "style" },
  size: { type: "enum", label: "Size", options: [
    { value: "fit", label: "Fit to the name" },
    { value: "office", label: "Office sign, 8 × 2 in (203 × 51 mm)" }
  ], default: "fit", help: "The office sign is a fixed 8 × 2 inch plate with the name centered on it. The plate shape setting and the keychain loop don't apply to it.", group: "shape", section: "plate" },
  plate_image: { type: "enum", label: "Image", options: [
    { value: "none", label: "No image" },
    { value: "custom", label: "My own image, at the left" }
  ], default: "none", visibleWhen: { size: "office" }, group: "shape", section: "plate" },
  image_threshold: { type: "int", label: "Image threshold", min: 0, max: 255, step: 1, default: 128, visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  image_invert: { type: "bool", label: "Invert: trace the light parts instead of the dark parts", default: false, visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  image_scale_pct: { type: "int", label: "Image size", min: 30, max: 100, step: 5, default: 100, unit: "%", visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  plate: { type: "enum", label: "Plate", options: [
    { value: "hug", label: "Contour (hugs letters)" },
    { value: "pill", label: "Pill" },
    { value: "rect", label: "Rounded rectangle" },
    { value: "none", label: "None: cut-out letters on a thin backing" }
  ], default: "hug", visibleWhen: o => !isOffice(o), group: "shape", section: "plate" },
  plate_margin_mm: { type: "number", label: "Plate margin", help: "How far the plate extends beyond the letters.", min: MARGIN_RANGE[0], max: MARGIN_RANGE[1], step: 0.5, default: 3, unit: "mm", visibleWhen: o => !isOffice(o) && o.plate !== "none", group: "shape", section: "plate" },
  keychain_loop: { type: "bool", label: "Keychain loop on the left", default: false, visibleWhen: o => !isOffice(o), group: "shape", section: "plate" },
  height_mm: { type: "number", label: "Letter height (whole name)", min: 14, max: 60, step: 1, default: 24, unit: "mm", group: "size", section: "size" },
  thickness_mm: { type: "number", label: "Total thickness", min: 2, max: 6, step: 0.2, default: 3, unit: "mm", group: "size", section: "size" },
  relief_mm: { type: "number", label: "Letter relief", min: RELIEF_RANGE[0], max: RELIEF_RANGE[1], step: 0.2, default: 1.2, unit: "mm", group: "size", section: "size" },
  text_color: { type: "color", label: "Letter color", default: "#ffffff", group: "colors", section: "colors" },
  plate_color: { type: "color", label: "Plate color", default: "#2a6f97", visibleWhen: o => platePart(o) !== "none", group: "colors", section: "colors" },
  outline_color: { type: "color", label: "Outline and backing color", default: "#c1121f", visibleWhen: o => o.style === "outline" || o.style === "shadow" || platePart(o) === "none", group: "colors", section: "colors" },
  image_color: { type: "color", label: "Image color", default: "#f4c430", visibleWhen: hasImage, group: "colors", section: "colors" }
};

const PRESETS = {
  keychain: { plate: "none", keychain_loop: true, height_mm: 16 },
  desk: { plate: "rect", height_mm: 30, thickness_mm: 4 },
  office: { size: "office", style: "raised", height_mm: 32, thickness_mm: 4 },
  door: { plate: "pill", style: "shadow", height_mm: 40, thickness_mm: 4 }
};

export default {
  id: "name-plate",
  // Size "office" (8 × 2 in sign) and the optional image were added without a version bump: both
  // default to the previous behavior ("fit", no image).
  // 2: the plate "hug" (contour) was added and became the default; plate_margin_mm sets the margin of
  //    the hug, pill and rectangle plates (3 mm, as before, by default). Requests made at version 1
  //    keep the plate they chose.
  version: 2,
  title: "Name plate",
  blurb: "A name in a decorative font, raised, outlined, shadowed or inlaid on a plate, with an optional keychain loop.",
  category: "badges",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  sections: SECTIONS,
  focus: FOCUS,
  schema: SCHEMA,
  rules,
  onParamChange,
  errorField,
  presets: PRESETS,
  // The page drives the shared font control (installed font / font file / curated ids) from this.
  font: FONT_SPEC,
  // The page traces a customer image while `when` holds (office size only: onParamChange resets it).
  image: { when: { plate_image: "custom" }, threshold: "image_threshold", invert: "image_invert" }
};
