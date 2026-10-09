// Rating card: parameter schema and rules. A business-card-size plate with a raised icon (built
// in, or traced from the customer's own image), a row of five stars in half steps and a caption.
// A customer image is never a parameter: the page traces it in the browser and passes only the
// outline to the build (ctx.imageContours), so it never reaches drafts, the hand-off record or
// the server.
import { contrastRatio } from "../color.js?v=8b580d4116242dd0";
import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY, locationFontField } from "../fonts.js?v=8b580d4116242dd0";

const EPS = 1e-6;
const MIN_WEB = 0.8;           // card kept under the relief
const RELIEF_RANGE = [0.4, 1.2];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;
const reliefMax = o => round1(Math.min(RELIEF_RANGE[1], o.thickness_mm - MIN_WEB));

// Decorations. Raised ones stand `relief_mm` tall (flush with the icon and stars) in the Icon
// color: the card already uses five colors, so decorations never add a sixth. An engraved line is
// cut into the card base.
const CORNER_LIMIT = { round: 8, chamfer: 6, notch: 4 };   // largest corner size that keeps the content zones whole
const GROOVE_RANGE = [0.2, 0.6];
const MIN_GROOVE_WEB = 0.6;     // card base kept under an engraved line
const hasBorder = o => (o.border_style ?? "none") !== "none";
const hasFrame = o => (o.frame_style ?? "none") !== "none";
const hasDivider = o => (o.divider ?? "none") !== "none";
const hasEngraving = o => o.border_style === "engraved" || o.frame_style === "engraved";
const hasLines = o => hasBorder(o) || hasFrame(o);
const grooveMax = o => round1(Math.min(GROOVE_RANGE[1], o.thickness_mm - o.relief_mm - MIN_GROOVE_WEB));

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
  const limits = { relief_mm: [RELIEF_RANGE[0], maxRelief] };
  const cap = CORNER_LIMIT[o.corner_style ?? "round"] ?? CORNER_LIMIT.round;
  limits.corner_radius_mm = [0, cap];
  if (Number.isFinite(o.corner_radius_mm) && o.corner_radius_mm > cap + EPS) {
    add(["corner_radius_mm"], `A ${o.corner_style} corner can be at most ${cap} mm here; larger ones would cut into the icon, stars or caption.`);
  }
  if (hasEngraving(o) && Number.isFinite(o.groove_depth_mm) && Number.isFinite(o.thickness_mm) && Number.isFinite(o.relief_mm)) {
    const maxGroove = grooveMax(o);
    limits.groove_depth_mm = [GROOVE_RANGE[0], Math.max(GROOVE_RANGE[0], maxGroove)];
    if (maxGroove < GROOVE_RANGE[0] - EPS) add(["groove_depth_mm"], `An engraved line needs at least ${MIN_GROOVE_WEB} mm of card under it: make the card thicker or the relief lower.`);
    else if (o.groove_depth_mm > maxGroove + EPS) add(["groove_depth_mm"], `Engraving depth must be ${GROOVE_RANGE[0]}–${maxGroove} mm for this card (at least ${MIN_GROOVE_WEB} mm of card stays underneath).`);
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
  return { limits, errors, fieldErrors };
}

// Maps a geometry (build) error to the control it belongs next to.
function errorField(message) {
  const text = String(message ?? "");
  if (/engraved|engraving/i.test(text)) return "groove_depth_mm";
  if (/image|traced/i.test(text)) return "icon";
  if (/font file|installed font/i.test(text)) return "font";
  if (/caption/i.test(text)) return "caption";
  return null;
}

function withSection(fields, section) {
  return Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, { ...d, section }]));
}

const SCHEMA = {
  icon: { type: "enum", label: "Icon", options: [
    { value: "toilet", label: "Toilet" },
    { value: "heart", label: "Heart" },
    { value: "house", label: "House" },
    { value: "mug", label: "Mug" },
    { value: "custom", label: "My own image" }
  ], default: "toilet", randomizeExclude: ["custom"], group: "icon", section: "icon" },
  image_threshold: { randomize: false, type: "int", label: "Image threshold", min: 0, max: 255, step: 1, default: 128, visibleWhen: { icon: "custom" }, group: "icon", section: "icon" },
  image_invert: { randomize: false, type: "bool", label: "Invert: trace the light parts instead of the dark parts", default: false, visibleWhen: { icon: "custom" }, group: "icon", section: "icon" },
  image_scale_pct: { randomize: false, type: "int", label: "Image size", min: 30, max: 120, step: 5, default: 100, unit: "%", visibleWhen: { icon: "custom" }, group: "icon", section: "icon" },
  rating: { type: "number", label: "Stars", min: 0, max: 5, step: 0.5, default: 3.5, group: "rating", section: "rating" },
  show_stars: { type: "bool", label: "Show the stars", default: true, group: "rating", section: "rating" },
  caption: { type: "text", label: "Caption", max: 40, optional: true, default: "Would poop here again", help: "Optional. Up to 40 characters. The built-in font prints capital letters, digits and common punctuation; other fonts leave out characters they don't have.", group: "text", section: "caption" },
  ...locationFontField("caption_font", "Caption font", { group: "text", section: "caption", visibleWhen: hasCaption }),
  ...withSection(fontSchema("text", hasCaption), "caption"),
  thickness_mm: { type: "number", label: "Card thickness", min: 1.2, max: 3, step: 0.2, default: 1.6, unit: "mm", group: "size", section: "general" },
  relief_mm: { type: "number", label: "Relief height", min: RELIEF_RANGE[0], max: RELIEF_RANGE[1], step: 0.2, default: 0.6, unit: "mm", group: "size", section: "general" },
  corner_style: { type: "enum", label: "Corner style", options: [
    { value: "round", label: "Rounded" },
    { value: "chamfer", label: "Chamfered (cut corners)" },
    { value: "notch", label: "Notched (ticket corners)" }
  ], default: "round", group: "size", section: "general" },
  corner_radius_mm: { type: "number", label: "Corner size", min: 0, max: 8, step: 0.5, default: 3, unit: "mm", group: "size", section: "general" },
  border_style: { type: "enum", label: "Card border", options: [
    { value: "none", label: "None" },
    { value: "raised", label: "Raised rim" },
    { value: "engraved", label: "Engraved groove" }
  ], default: "none", group: "decor", section: "border" },
  border_width_mm: { type: "number", label: "Border width", min: 0.8, max: 2, step: 0.2, default: 1.2, unit: "mm", visibleWhen: o => hasBorder(o), group: "decor", section: "border" },
  border_inset_mm: { type: "number", label: "Distance from the edge", min: 0.5, max: 2, step: 0.5, default: 1, unit: "mm", visibleWhen: o => hasLines(o), group: "decor", section: "border" },
  frame_style: { type: "enum", label: "Inner frame line", options: [
    { value: "none", label: "None" },
    { value: "raised", label: "Raised line" },
    { value: "engraved", label: "Engraved line" }
  ], default: "none", group: "decor", section: "border" },
  frame_width_mm: { type: "number", label: "Frame line width", min: 0.6, max: 1.5, step: 0.1, default: 0.8, unit: "mm", visibleWhen: o => hasFrame(o), group: "decor", section: "border" },
  groove_depth_mm: { type: "number", label: "Engraving depth", min: GROOVE_RANGE[0], max: GROOVE_RANGE[1], step: 0.2, default: 0.4, unit: "mm", visibleWhen: o => hasEngraving(o), group: "decor", section: "border" },
  divider: { type: "enum", label: "Divider rule", options: [
    { value: "none", label: "None" },
    { value: "caption", label: "Above the caption" },
    { value: "icon", label: "Between the icon and the stars" },
    { value: "both", label: "Both" }
  ], default: "none", group: "decor", section: "dividers" },
  divider_width_mm: { type: "number", label: "Divider width", min: 0.6, max: 1.6, step: 0.2, default: 1, unit: "mm", visibleWhen: o => hasDivider(o), group: "decor", section: "dividers" },
  divider_length_pct: { type: "number", label: "Divider length", min: 30, max: 100, step: 5, default: 80, unit: "%", visibleWhen: o => hasDivider(o), group: "decor", section: "dividers" },
  base_color: { type: "color", label: "Base color", default: "#ffffff", group: "colors", section: "colors" },
  icon_color: { type: "color", label: "Icon color", default: "#6b4a2f", help: "The icon, and any border, frame line or divider.", group: "colors", section: "colors" },
  star_color: { type: "color", label: "Star color", default: "#bf8300", group: "colors", section: "colors" },
  empty_star_color: { type: "color", label: "Empty star color", default: "#b8b8b8", group: "colors", section: "colors" },
  text_color: { type: "color", label: "Text color", default: "#111111", group: "colors", section: "colors" }
};

// Regions of the form, in display order, and which preview part focuses which one. A part name
// matches a solid's name exactly or as a prefix.
const SECTIONS = {
  general: "Card and corners",
  icon: "Icon",
  rating: "Stars",
  caption: "Caption",
  border: "Border and frame",
  dividers: "Dividers",
  colors: "Colors"
};
const FOCUS = [
  { part: "Card base", section: "general" },
  { part: "Icon", section: "icon" },
  { part: "Empty stars", section: "rating" },
  { part: "Filled stars", section: "rating" },
  { part: "Caption", section: "caption" },
  { part: "Border", section: "border" },
  { part: "Inner frame", section: "border" },
  { part: "Divider", section: "dividers" }
];

const PRESETS = {
  toilet: { icon: "toilet" },
  heart: { icon: "heart" },
  house: { icon: "house" },
  mug: { icon: "mug" },
  // Ticket-style notched corners, an engraved border line and a rule above the caption.
  ticket: { corner_style: "notch", corner_radius_mm: 3, border_style: "engraved", divider: "caption" },
  // A dark card: light icon and caption, bright gold stars, slate empty stars.
  dark: { base_color: "#1d2733", icon_color: "#e8d5bf", star_color: "#f5b301", empty_star_color: "#5b6675", text_color: "#f2f2f2" }
};

// Ready-made designs, offered before customizing (see docs/GENERATORS.md). Each is a partial
// parameter set over the defaults, so every one is also a complete, buildable card.
const DESIGNS = [
  { id: "toilet", label: "Throne review", blurb: "The classic toilet review card. The default.", group: "Icons", params: PRESETS.toilet },
  { id: "heart", label: "Heart", blurb: "A heart card with a loving caption.", group: "Icons", params: { ...PRESETS.heart, caption: "Loved it", rating: 5, star_color: "#e11d48", icon_color: "#be123c" } },
  { id: "house", label: "Home sweet home", blurb: "A house card for rentals and open houses.", group: "Icons", params: { ...PRESETS.house, caption: "Home sweet home", rating: 4.5 } },
  { id: "mug", label: "Coffee review", blurb: "A mug card for the cafe or the break room.", group: "Icons", params: { ...PRESETS.mug, caption: "Best coffee in town", rating: 5 } },
  { id: "ticket", label: "Ticket stub", blurb: "Notched corners, an engraved border and a rule above the caption.", group: "Styles", params: { ...PRESETS.ticket, caption: "Admit one good time", rating: 4 } },
  { id: "dark", label: "Midnight", blurb: "A dark card with gold stars.", group: "Styles", params: PRESETS.dark },
  { id: "five-star", label: "Five stars", blurb: "Full gold stars and a confident caption.", group: "Styles", params: { rating: 5, caption: "Five stars, would recommend", star_color: "#a86b00" } },
  { id: "mint-chip", label: "Mint chip", blurb: "A soft mint card with chamfered corners.", group: "Styles", params: { base_color: "#d9f5e8", icon_color: "#0f5c46", star_color: "#0f8a62", empty_star_color: "#9cc7b6", text_color: "#0b3d2e", corner_style: "chamfer", corner_radius_mm: 3 } }
];

export default {
  id: "rating-card",
  version: 2,
  title: "Rating card",
  blurb: "A business-card-size rating with an icon or your own image, zero to five stars in half steps, and a caption.",
  category: "cards",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: SCHEMA,
  rules,
  errorField,
  sections: SECTIONS,
  focus: FOCUS,
  presets: PRESETS,
  designs: DESIGNS,
  defaultDesign: "toilet",
  // The page traces a customer image while `when` holds, using these parameters.
  font: FONT_SPEC,
  image: { when: { icon: "custom" }, threshold: "image_threshold", invert: "image_invert" }
};
