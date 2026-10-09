// Name plate: parameter schema and rules. A name in the built-in block font, one of the curated
// self-hosted OFL fonts or the customer's own font file (parsed in the browser, never uploaded),
// raised, outlined, shadowed or inlaid on a contour-hugging, pill or rectangle plate, or cut out
// with a backing outline (no plate). Optional keychain loop at the left end. Size "office" makes
// the standard 8 × 2 in desk sign and can add the customer's own image (traced in the browser and
// passed to the build as ctx.imageContours; never a parameter, as on the rating card).
import { contrastRatio } from "../color.js?v=fbc13f804a77bd37";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY } from "../fonts.js?v=fbc13f804a77bd37";

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
  ], default: "fit", randomize: false, help: "The office sign is a fixed 8 × 2 inch plate with the name centered on it. The plate shape setting and the keychain loop don't apply to it.", group: "shape", section: "plate" },
  plate_image: { type: "enum", label: "Image", options: [
    { value: "none", label: "No image" },
    { value: "custom", label: "My own image, at the left" }
  ], default: "none", randomize: false, visibleWhen: { size: "office" }, group: "shape", section: "plate" },
  image_threshold: { randomize: false, type: "int", label: "Image threshold", min: 0, max: 255, step: 1, default: 128, visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  image_invert: { randomize: false, type: "bool", label: "Invert: trace the light parts instead of the dark parts", default: false, visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  image_scale_pct: { randomize: false, type: "int", label: "Image size", min: 30, max: 100, step: 5, default: 100, unit: "%", visibleWhen: { size: "office", plate_image: "custom" }, group: "shape", section: "plate" },
  plate: { type: "enum", label: "Plate", options: [
    { value: "hug", label: "Contour (hugs letters)" },
    { value: "pill", label: "Pill" },
    { value: "rect", label: "Rounded rectangle" },
    { value: "none", label: "None: cut-out letters on a thin backing" }
  ], default: "hug", visibleWhen: o => !isOffice(o), group: "shape", section: "plate" },
  plate_margin_mm: { type: "number", label: "Plate margin", help: "How far the plate extends beyond the letters.", min: MARGIN_RANGE[0], max: MARGIN_RANGE[1], step: 0.5, default: 3, unit: "mm", visibleWhen: o => !isOffice(o) && o.plate !== "none", group: "shape", section: "plate" },
  keychain_loop: { type: "bool", label: "Keychain loop on the left", default: false, randomize: false, visibleWhen: o => !isOffice(o), group: "shape", section: "plate" },
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

// Ready-made designs, offered before customizing (see docs/GENERATORS.md). Each is a partial
// parameter set over the defaults, so every one is also a complete, buildable plate.
const DESIGNS = [
  { id: "classic", label: "Classic", blurb: "Raised white letters on a contour plate. The default.", group: "Plate styles", params: {} },
  { id: "keychain", label: "Keychain", blurb: "Small cut-out letters with a key-ring loop.", group: "Plate styles", params: PRESETS.keychain },
  { id: "desk", label: "Desk plate", blurb: "A rectangular plate with taller letters.", group: "Plate styles", params: PRESETS.desk },
  { id: "office", label: "Office sign", blurb: "The standard 8 × 2 in desk sign.", group: "Plate styles", params: PRESETS.office },
  { id: "door", label: "Door sign", blurb: "A pill plate with big, shadowed letters.", group: "Plate styles", params: PRESETS.door },
  { id: "gold-inlay", label: "Gold inlay", blurb: "Gold letters set flush into a black rectangle.", group: "Plate styles", params: { plate: "rect", style: "inlay", font: "cinzel-bold", plate_color: "#1b1b1b", text_color: "#f4c430" } },
  { id: "neon-outline", label: "Neon outline", blurb: "Lime letters with a magenta outline on a dark pill.", group: "Plate styles", params: { plate: "pill", style: "outline", font: "righteous", plate_color: "#141414", text_color: "#9dff3a", outline_color: "#ff2bd6" } },
  { id: "gamer-tag", label: "Gamer tag", blurb: "Cyan block letters cut out of a dark backing.", group: "Plate styles", params: { plate: "none", font: "rubik-mono-one", text_color: "#00e5ff", outline_color: "#101010", height_mm: 20 } },
  { id: "wedding-script", label: "Script on cream", blurb: "A flowing script on a soft cream plate.", group: "Plate styles", params: { name: "Alex & Sam", font: "sacramento", plate_color: "#f5efe6", text_color: "#7a4b2a", height_mm: 28 } },
  { id: "emma", label: "Emma", blurb: "A common name in Pacifico.", group: "Common names", params: { name: "Emma", font: "pacifico", plate_color: "#9d174d", text_color: "#ffffff" } },
  { id: "liam", label: "Liam", blurb: "A common name in Montserrat Extrabold.", group: "Common names", params: { name: "Liam", font: "montserrat-extrabold", plate_color: "#1e3a8a", text_color: "#ffffff" } },
  { id: "olivia", label: "Olivia", blurb: "A common name in Sacramento.", group: "Common names", params: { name: "Olivia", font: "sacramento", plate_color: "#f5efe6", text_color: "#7a4b2a" } },
  { id: "noah", label: "Noah", blurb: "A common name in Bebas Neue.", group: "Common names", params: { name: "Noah", font: "bebas-neue", plate_color: "#14532d", text_color: "#ffffff" } },
  { id: "ava", label: "Ava", blurb: "A common name in Lobster.", group: "Common names", params: { name: "Ava", font: "lobster", plate_color: "#7c2d12", text_color: "#fff7ed" } },
  { id: "mason", label: "Mason", blurb: "A common name in Rye.", group: "Common names", params: { name: "Mason", font: "rye", plate_color: "#5b3a1e", text_color: "#f2d8a7" } },
  { id: "sophia", label: "Sophia", blurb: "A common name in Alex Brush.", group: "Common names", params: { name: "Sophia", font: "alex-brush", plate_color: "#f5efe6", text_color: "#6b21a8" } },
  { id: "jack", label: "Jack", blurb: "A common name in Bangers.", group: "Common names", params: { name: "Jack", font: "bangers", plate_color: "#0f172a", text_color: "#fbbf24" } },
  { id: "mia", label: "Mia", blurb: "A common name in Caveat.", group: "Common names", params: { name: "Mia", font: "caveat-bold", plate_color: "#fde68a", text_color: "#7c2d12" } },
  { id: "lucas", label: "Lucas", blurb: "A common name in Poppins.", group: "Common names", params: { name: "Lucas", font: "poppins-bold", plate_color: "#0f766e", text_color: "#ffffff" } },
  { id: "ella", label: "Ella", blurb: "A common name in Kaushan Script.", group: "Common names", params: { name: "Ella", font: "kaushan-script", plate_color: "#1f2937", text_color: "#fcd34d" } },
  { id: "henry", label: "Henry", blurb: "A common name in Cinzel.", group: "Common names", params: { name: "Henry", font: "cinzel-bold", plate_color: "#3f2a1d", text_color: "#f5e6c8" } }
];

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
  designs: DESIGNS,
  defaultDesign: "classic",
  // The page drives the shared font control (installed font / font file / curated ids) from this.
  font: FONT_SPEC,
  // The page traces a customer image while `when` holds (office size only: onParamChange resets it).
  image: { when: { plate_image: "custom" }, threshold: "image_threshold", invert: "image_invert" }
};
