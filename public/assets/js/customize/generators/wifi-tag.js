// Wi-Fi tag: parameter schema and rules. The QR code (and optional label) is a flush inlay on
// the TOP face. The password is sensitive: it lives only in the QR geometry of the model file
// and is redacted from drafts, the hand-off record, the server, email and webhooks.

import { luminance, contrastRatio } from "../color.js?v=fbc13f804a77bd37";

import { fontSchema, fontRule, FONT_SPEC, FONT_ACK_KEY, locationFontField } from "../fonts.js?v=fbc13f804a77bd37";
import { qrScaleField } from "../qr.js?v=fbc13f804a77bd37";

export { contrastRatio };

const EPS = 1e-6;
const MIN_WEB = 0.8;          // solid base kept under the inlay
const DEPTH_RANGE = [0.6, 1.6];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;

const DECOR_HEIGHT_RANGE = [0.4, 1.2];
const MIN_ENGRAVE_WEB = 0.8;  // base kept under an engraved groove
const depthMax = o => round1(Math.min(DEPTH_RANGE[1], o.thickness_mm - MIN_WEB));

// Decorations. Dividers need the label (keychains have none); the others do not.
const dividersUsable = o => o.format !== "keychain" && o.show_text !== false;
const hasBorder = o => (o.border_style ?? "none") !== "none";
const hasFrame = o => (o.qr_frame ?? "none") !== "none";
const hasDivider = o => dividersUsable(o) && (o.title_divider === true || o.network_divider === true);
const anyDecor = o => hasBorder(o) || hasFrame(o) || hasDivider(o);
// Raised parts (rim, frame, dividers) print in the decoration color; an engraved groove is empty.
const hasRaised = o => o.border_style === "raised" || hasFrame(o) || hasDivider(o);

// The label (title and network name) is the only text; keychain tags have none.
const usesText = o => o.format !== "keychain" && o.show_text !== false;

function rules(o) {
  // Keychain tags never carry text, and only keychains have the loop. validateParams and
  // clampParams pass their own working object, so this forces the values in the browser (the
  // form updates), in the build and in the server's provenance record alike. Changing the
  // format restores that format's own defaults (onParamChange).
  if (o.format === "keychain") o.show_text = false;
  else o.hole = false;
  const fieldErrors = {};
  const errors = [];
  const limits = {};
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const maxDepth = depthMax(o);
  if (Number.isFinite(o.qr_depth_mm) && o.qr_depth_mm > maxDepth + EPS) {
    add(["qr_depth_mm"], `QR and text depth must be ${DEPTH_RANGE[0]}–${maxDepth} mm for a ${o.thickness_mm} mm tag (at least ${MIN_WEB} mm of base stays underneath).`);
  }
  // Dividers sit between label and code, so they need the label: keychains and label-off tags
  // force them off (the form updates; the build and the server see the same values).
  if (!dividersUsable(o)) { o.title_divider = false; o.network_divider = false; }
  if (o.border_style === "engraved" && Number.isFinite(o.decor_height_mm) && Number.isFinite(o.thickness_mm)) {
    const maxGroove = round1(Math.min(DECOR_HEIGHT_RANGE[1], o.thickness_mm - MIN_ENGRAVE_WEB));
    limits.decor_height_mm = [DECOR_HEIGHT_RANGE[0], Math.max(DECOR_HEIGHT_RANGE[0], maxGroove)];
    if (o.decor_height_mm > maxGroove + EPS) add(["decor_height_mm"], `An engraved border can be ${DECOR_HEIGHT_RANGE[0]}–${maxGroove} mm deep on a ${o.thickness_mm} mm tag (at least ${MIN_ENGRAVE_WEB} mm of base stays underneath).`);
  }
  if (hasRaised(o) && typeof o.base_color === "string" && typeof o.decor_color === "string") {
    const ratio = contrastRatio(o.base_color, o.decor_color);
    if (ratio < MIN_CONTRAST - EPS) add(["base_color", "decor_color"], `Base color and Decoration color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the border, frame or dividers to stand out.`);
  }
  const font = fontRule(o, usesText(o));
  if (font.errors.length) add([FONT_ACK_KEY], font.errors[0]);
  // On the server the password arrives as the redaction marker, which is never empty.
  if (o.security !== "nopass" && !String(o.password ?? "").length) add(["password"], "Enter the network password, or choose 'No password'.");
  if (typeof o.base_color === "string" && typeof o.qr_color === "string") {
    const ratio = contrastRatio(o.base_color, o.qr_color);
    if (ratio < MIN_CONTRAST - EPS) {
      add(["base_color", "qr_color"], `Base color and QR code color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for a phone to scan the code.`);
    } else if (luminance(o.qr_color) >= luminance(o.base_color)) {
      add(["base_color", "qr_color"], "The QR code color must be darker than the Base color; many phones can't scan a light code on a dark tag.");
    }
  }
  if (o.show_text && typeof o.base_color === "string" && typeof o.text_color === "string") {
    const ratio = contrastRatio(o.base_color, o.text_color);
    if (ratio < MIN_CONTRAST - EPS) add(["base_color", "text_color"], `Base color and Text color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the label to be read.`);
  }
  return { limits: { qr_depth_mm: [DEPTH_RANGE[0], maxDepth], ...limits }, errors, fieldErrors };
}

// A committed format change restores that format's text and loop defaults (schema defaults
// overlaid with the format's preset): keychain -> text off, loop on; others -> text on.
function onParamChange(key, o) {
  if (key !== "format") return {};
  const defaults = { show_text: SCHEMA.show_text.default, hole: SCHEMA.hole.default };
  const preset = Object.hasOwn(PRESETS, o.format) ? PRESETS[o.format] : {};
  return { show_text: preset.show_text ?? defaults.show_text, hole: preset.hole ?? defaults.hole };
}

// Maps a geometry (build) error to the field it belongs next to. The payload length is driven
// by the network name and password; the message never repeats either.
function errorField(message) {
  const text = String(message ?? "");
  if (/too dense/i.test(text) || /^The network name is too long to print legibly|^None of the characters in the network name/.test(text)) return "ssid";
  if (/^The title is too long to print legibly|^None of the characters in the title/.test(text)) return "title";
  if (/Raise the QR code size/.test(text)) return "qr_scale_pct";
  if (/font file|installed font/i.test(text)) return "font";
  return null;
}

function withSection(fields, section) {
  return Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, { ...d, section }]));
}

const labelOn = o => usesText(o);

const SCHEMA = {
  format: { type: "enum", label: "Tag format", options: [
    { value: "placard", label: "Placard, 90 × 120 mm" },
    { value: "keychain", label: "Keychain, 45 × 60 mm" },
    { value: "card", label: "Business card, 85.6 × 54 mm" }
  ], default: "placard", randomize: false, group: "tag", section: "general" },
  hole: { type: "bool", label: "Key-ring loop", default: true, randomize: false, visibleWhen: { format: "keychain" }, group: "tag", section: "general" },
  ssid: { type: "text", label: "Network name (SSID)", max: 32, default: "Guest WiFi", preserveWhitespace: true, group: "network", section: "network" },
  password: { type: "text", label: "Network password", max: 63, optional: true, default: "", sensitive: true, preserveWhitespace: true, help: "Needed unless the network is open. Up to 63 characters, exactly as typed.", group: "network", section: "network" },
  security: { type: "enum", label: "Security", options: [
    { value: "WPA", label: "WPA, WPA2 or WPA3" },
    { value: "WEP", label: "WEP (older networks)" },
    { value: "nopass", label: "No password (open network)" }
  ], default: "WPA", randomize: false, group: "network", section: "network" },
  hidden: { type: "bool", label: "Hidden network", default: false, randomize: false, group: "network", section: "network" },
  ...locationFontField("network_font", "Network name font", { group: "network", section: "network", visibleWhen: labelOn }),
  show_text: { type: "bool", label: "Show title and network name. Text is not shown on keychain tags.", default: true, randomize: false, group: "text", section: "general" },
  title: { type: "text", label: "Title", max: 20, optional: true, default: "WiFi", group: "text", section: "title" },
  ...locationFontField("title_font", "Title font", { group: "text", section: "title", visibleWhen: labelOn }),
  ...withSection(fontSchema("text", usesText), "general"),
  corner_radius_mm: { type: "number", label: "Corner radius", min: 0, max: 12, step: 0.5, default: 4, unit: "mm", group: "size", section: "general" },
  thickness_mm: { type: "number", label: "Thickness", min: 2, max: 6, step: 0.2, default: 3, unit: "mm", group: "size", section: "general" },
  qr_depth_mm: { randomize: false, type: "number", label: "QR and text depth", min: DEPTH_RANGE[0], max: DEPTH_RANGE[1], step: 0.2, default: 1, unit: "mm", group: "size", section: "general" },
  qr_scale_pct: qrScaleField("size", { section: "qr", help: "Shrinks the code about its center. Smaller codes print finer cells; the tag warns when a code may not scan." }),
  qr_frame: { type: "enum", label: "Frame around the QR code", options: [
    { value: "none", label: "None" },
    { value: "square", label: "Square frame" },
    { value: "rounded", label: "Rounded frame" }
  ], default: "none", group: "decor", section: "qr" },
  qr_frame_width_mm: { type: "number", label: "Frame width", min: 0.8, max: 3, step: 0.2, default: 1.2, unit: "mm", visibleWhen: hasFrame, group: "decor", section: "qr" },
  qr_frame_gap_mm: { type: "number", label: "Gap between code and frame", min: 0, max: 4, step: 0.5, default: 1, unit: "mm", visibleWhen: hasFrame, group: "decor", section: "qr" },
  border_style: { type: "enum", label: "Tag border", options: [
    { value: "none", label: "None" },
    { value: "raised", label: "Raised rim" },
    { value: "engraved", label: "Engraved groove" }
  ], default: "none", group: "decor", section: "border" },
  border_width_mm: { type: "number", label: "Border width", min: 0.8, max: 3, step: 0.2, default: 1.2, unit: "mm", visibleWhen: hasBorder, group: "decor", section: "border" },
  border_inset_mm: { type: "number", label: "Border distance from the edge", min: 0.5, max: 4, step: 0.5, default: 1, unit: "mm", visibleWhen: hasBorder, group: "decor", section: "border" },
  decor_height_mm: { type: "number", label: "Decoration height", min: DECOR_HEIGHT_RANGE[0], max: DECOR_HEIGHT_RANGE[1], step: 0.2, default: 0.6, unit: "mm", help: "How far the raised border, frame and dividers stand up, or how deep an engraved border is cut.", visibleWhen: anyDecor, group: "decor", section: "border" },
  title_divider: { type: "bool", label: "Divider between the title and the QR code", default: false, visibleWhen: dividersUsable, group: "decor", section: "dividers" },
  network_divider: { type: "bool", label: "Divider between the network name and the QR code", default: false, visibleWhen: dividersUsable, group: "decor", section: "dividers" },
  divider_width_mm: { type: "number", label: "Divider width", min: 0.6, max: 2, step: 0.2, default: 1, unit: "mm", visibleWhen: hasDivider, group: "decor", section: "dividers" },
  divider_length_pct: { type: "number", label: "Divider length", min: 30, max: 100, step: 5, default: 70, unit: "%", visibleWhen: hasDivider, group: "decor", section: "dividers" },
  base_color: { type: "color", label: "Base color", default: "#ffffff", group: "colors", section: "colors" },
  qr_color: { type: "color", label: "QR code color", default: "#111111", group: "colors", section: "colors" },
  text_color: { type: "color", label: "Text color", default: "#111111", group: "colors", section: "colors" },
  decor_color: { type: "color", label: "Decoration color", default: "#111111", help: "Raised borders, frames and dividers.", visibleWhen: hasRaised, group: "colors", section: "colors" }
};

// Regions of the form, in display order, and which preview part focuses which one. A part name
// matches a solid's name exactly or as a prefix.
const SECTIONS = {
  general: "Tag and size",
  network: "Network name and password",
  title: "Title",
  qr: "QR code",
  border: "Tag border",
  dividers: "Dividers",
  colors: "Colors"
};
const FOCUS = [
  { part: "Tag body", section: "general" },
  { part: "QR code", section: "qr" },
  { part: "QR frame", section: "qr" },
  { part: "Title text", section: "title" },
  { part: "Network name", section: "network" },
  { part: "Border", section: "border" },
  { part: "Divider", section: "dividers" }
];

const PRESETS = {
  placard: { format: "placard" },
  keychain: { format: "keychain", show_text: false, hole: true },
  card: { format: "card" },
  // A raised rim, a rounded frame around the code and a rule under the title and over the network name.
  framed: { format: "placard", border_style: "raised", qr_frame: "rounded", title_divider: true, network_divider: true }
};

// Ready-made designs, offered before customizing (see docs/GENERATORS.md). Each is a partial
// parameter set over the defaults; the QR code color stays darker than the base color.
const DESIGNS = [
  { id: "placard", label: "Placard", blurb: "A 90 × 120 mm tag for a shelf or a wall. The default.", group: "Formats", params: PRESETS.placard },
  { id: "keychain", label: "Keychain", blurb: "A 45 × 60 mm code with a key-ring loop.", group: "Formats", params: PRESETS.keychain },
  { id: "card", label: "Business card", blurb: "An 85.6 × 54 mm card for the guest drawer.", group: "Formats", params: PRESETS.card },
  { id: "framed", label: "Framed placard", blurb: "A raised rim, a rounded frame around the code and two rules.", group: "Styles", params: PRESETS.framed },
  { id: "sunny", label: "Sunny yellow", blurb: "A warm yellow placard with a rounded frame.", group: "Colors", params: { base_color: "#ffe9a8", qr_color: "#1a1a1a", text_color: "#1a1a1a", qr_frame: "rounded" } },
  { id: "mint", label: "Mint", blurb: "A fresh mint placard with a green code.", group: "Colors", params: { base_color: "#d6f5e3", qr_color: "#0b3d2e", text_color: "#0b3d2e", border_style: "engraved" } },
  { id: "sky", label: "Sky blue card", blurb: "A pale blue business card with a navy code.", group: "Colors", params: { format: "card", base_color: "#dbeafe", qr_color: "#0b2a5b", text_color: "#0b2a5b" } },
  { id: "blush", label: "Blush keychain", blurb: "A pink keychain with a plum code.", group: "Colors", params: { ...PRESETS.keychain, base_color: "#fde2ea", qr_color: "#4a1230" } }
];

export default {
  id: "wifi-tag",
  version: 2,
  title: "Wi-Fi tag",
  blurb: "A guest Wi-Fi QR code as a placard, keychain or business card. Phones join by scanning it.",
  category: "tags",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: SCHEMA,
  rules,
  errorField,
  onParamChange,
  font: FONT_SPEC,
  sections: SECTIONS,
  focus: FOCUS,
  presets: PRESETS,
  designs: DESIGNS,
  defaultDesign: "placard"
};
