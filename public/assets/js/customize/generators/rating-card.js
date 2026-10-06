// Rating card: parameter schema and rules. A business-card-size plate with a raised icon (built
// in, or traced from the customer's own image), a row of five stars in half steps and a caption.
// A customer image is never a parameter: the page traces it in the browser and passes only the
// outline to the build (ctx.imageContours), so it never reaches drafts, the hand-off record or
// the server.
import { contrastRatio } from "../color.js?v=ed70022f8c38a1b0";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY } from "../fonts.js?v=ed70022f8c38a1b0";

const EPS = 1e-6;
const MIN_WEB = 0.8;           // card kept under the relief
const RELIEF_RANGE = [0.4, 1.2];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;
const reliefMax = o => round1(Math.min(RELIEF_RANGE[1], o.thickness_mm - MIN_WEB));

// The caption is the card's only text.
const hasCaption = o => String(o.caption ?? "").trim().length > 0;

function rules(o) {
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const maxRelief = reliefMax(o);
  if (Number.isFinite(o.relief_mm) && o.relief_mm > maxRelief + EPS) {
    add(["relief_mm"], `Relief height must be ${RELIEF_RANGE[0]}–${maxRelief} mm for a ${o.thickness_mm} mm card (at least ${MIN_WEB} mm of card stays underneath).`);
  }
  const font = fontRule(o, hasCaption(o));
  if (font.errors.length) add([FONT_ACK_KEY], font.errors[0]);
  const pairs = [
    ["icon_color", "Icon color", "the icon", true],
    ["star_color", "Star color", "the filled stars", o.show_stars !== false],
    ["text_color", "Text color", "the caption", String(o.caption ?? "").trim().length > 0]
  ];
  for (const [key, label, what, applies] of pairs) {
    if (!applies || typeof o.base_color !== "string" || typeof o[key] !== "string") continue;
    const ratio = contrastRatio(o.base_color, o[key]);
    if (ratio < MIN_CONTRAST - EPS) add(["base_color", key], `Base color and ${label} are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for ${what} to stand out.`);
  }
  return { limits: { relief_mm: [RELIEF_RANGE[0], maxRelief] }, errors, fieldErrors };
}

// Maps a geometry (build) error to the control it belongs next to.
function errorField(message) {
  const text = String(message ?? "");
  if (/image|traced/i.test(text)) return "icon";
  if (/font file|installed font/i.test(text)) return "font";
  if (/caption/i.test(text)) return "caption";
  return null;
}

const SCHEMA = {
  icon: { type: "enum", label: "Icon", options: [
    { value: "toilet", label: "Toilet" },
    { value: "heart", label: "Heart" },
    { value: "house", label: "House" },
    { value: "mug", label: "Mug" },
    { value: "custom", label: "My own image" }
  ], default: "toilet", group: "icon" },
  image_threshold: { type: "int", label: "Image threshold", min: 0, max: 255, step: 1, default: 128, visibleWhen: { icon: "custom" }, group: "icon" },
  image_invert: { type: "bool", label: "Invert: trace the light parts instead of the dark parts", default: false, visibleWhen: { icon: "custom" }, group: "icon" },
  image_scale_pct: { type: "int", label: "Image size", min: 30, max: 120, step: 5, default: 100, unit: "%", visibleWhen: { icon: "custom" }, group: "icon" },
  rating: { type: "number", label: "Stars", min: 0, max: 5, step: 0.5, default: 3.5, group: "rating" },
  show_stars: { type: "bool", label: "Show the stars", default: true, group: "rating" },
  caption: { type: "text", label: "Caption", max: 40, optional: true, default: "Would poop here again", help: "Optional. Up to 40 characters. The built-in font prints capital letters, digits and common punctuation; other fonts leave out characters they don't have.", group: "text" },
  ...fontSchema("text", hasCaption),
  thickness_mm: { type: "number", label: "Card thickness", min: 1.2, max: 3, step: 0.2, default: 1.6, unit: "mm", group: "size" },
  relief_mm: { type: "number", label: "Relief height", min: RELIEF_RANGE[0], max: RELIEF_RANGE[1], step: 0.2, default: 0.6, unit: "mm", group: "size" },
  corner_radius_mm: { type: "number", label: "Corner radius", min: 0, max: 8, step: 0.5, default: 3, unit: "mm", group: "size" },
  base_color: { type: "color", label: "Base color", default: "#ffffff", group: "colors" },
  icon_color: { type: "color", label: "Icon color", default: "#6b4a2f", group: "colors" },
  star_color: { type: "color", label: "Star color", default: "#bf8300", group: "colors" },
  empty_star_color: { type: "color", label: "Empty star color", default: "#b8b8b8", group: "colors" },
  text_color: { type: "color", label: "Text color", default: "#111111", group: "colors" }
};

const PRESETS = {
  toilet: { icon: "toilet" },
  heart: { icon: "heart" },
  house: { icon: "house" },
  mug: { icon: "mug" },
  // A dark card: light icon and caption, bright gold stars, slate empty stars.
  dark: { base_color: "#1d2733", icon_color: "#e8d5bf", star_color: "#f5b301", empty_star_color: "#5b6675", text_color: "#f2f2f2" }
};

export default {
  id: "rating-card",
  version: 1,
  title: "Rating card",
  blurb: "A business-card-size rating with an icon or your own image, zero to five stars in half steps, and a caption.",
  category: "cards",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: SCHEMA,
  rules,
  errorField,
  presets: PRESETS,
  // The page traces a customer image while `when` holds, using these parameters.
  font: FONT_SPEC,
  image: { when: { icon: "custom" }, threshold: "image_threshold", invert: "image_invert" }
};
