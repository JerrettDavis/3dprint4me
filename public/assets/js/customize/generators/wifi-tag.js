// Wi-Fi tag: parameter schema and rules. The QR code (and optional label) is a flush inlay on
// the TOP face. The password is sensitive: it lives only in the QR geometry of the model file
// and is redacted from drafts, the hand-off record, the server, email and webhooks.

import { luminance, contrastRatio } from "../color.js?v=8a3170184cf2cb47";

export { contrastRatio };

const EPS = 1e-6;
const MIN_WEB = 0.8;          // solid base kept under the inlay
const DEPTH_RANGE = [0.6, 1.6];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;

const depthMax = o => round1(Math.min(DEPTH_RANGE[1], o.thickness_mm - MIN_WEB));

function rules(o) {
  // Keychain tags never carry text, and only keychains have the loop. validateParams and
  // clampParams pass their own working object, so this forces the values in the browser (the
  // form updates), in the build and in the server's provenance record alike. Changing the
  // format restores that format's own defaults (onParamChange).
  if (o.format === "keychain") o.show_text = false;
  else o.hole = false;
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  const maxDepth = depthMax(o);
  if (Number.isFinite(o.qr_depth_mm) && o.qr_depth_mm > maxDepth + EPS) {
    add(["qr_depth_mm"], `QR and text depth must be ${DEPTH_RANGE[0]}–${maxDepth} mm for a ${o.thickness_mm} mm tag (at least ${MIN_WEB} mm of base stays underneath).`);
  }
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
  return { limits: { qr_depth_mm: [DEPTH_RANGE[0], maxDepth] }, errors, fieldErrors };
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
  if (/too dense/i.test(text) || /^The network name is too long to print legibly/.test(text)) return "ssid";
  if (/^The title is too long to print legibly/.test(text)) return "title";
  return null;
}

const SCHEMA = {
  format: { type: "enum", label: "Tag format", options: [
    { value: "placard", label: "Placard, 90 × 120 mm" },
    { value: "keychain", label: "Keychain, 45 × 60 mm" },
    { value: "card", label: "Business card, 85.6 × 54 mm" }
  ], default: "placard", group: "tag" },
  hole: { type: "bool", label: "Key-ring loop", default: true, visibleWhen: { format: "keychain" }, group: "tag" },
  ssid: { type: "text", label: "Network name (SSID)", max: 32, default: "Guest WiFi", preserveWhitespace: true, group: "network" },
  password: { type: "text", label: "Network password", max: 63, optional: true, default: "", sensitive: true, preserveWhitespace: true, help: "Needed unless the network is open. Up to 63 characters, exactly as typed.", group: "network" },
  security: { type: "enum", label: "Security", options: [
    { value: "WPA", label: "WPA, WPA2 or WPA3" },
    { value: "WEP", label: "WEP (older networks)" },
    { value: "nopass", label: "No password (open network)" }
  ], default: "WPA", group: "network" },
  hidden: { type: "bool", label: "Hidden network", default: false, group: "network" },
  show_text: { type: "bool", label: "Show title and network name. Text is not shown on keychain tags.", default: true, group: "text" },
  title: { type: "text", label: "Title", max: 20, optional: true, default: "WiFi", group: "text" },
  corner_radius_mm: { type: "number", label: "Corner radius", min: 0, max: 12, step: 0.5, default: 4, unit: "mm", group: "size" },
  thickness_mm: { type: "number", label: "Thickness", min: 2, max: 6, step: 0.2, default: 3, unit: "mm", group: "size" },
  qr_depth_mm: { type: "number", label: "QR and text depth", min: DEPTH_RANGE[0], max: DEPTH_RANGE[1], step: 0.2, default: 1, unit: "mm", group: "size" },
  base_color: { type: "color", label: "Base color", default: "#ffffff", group: "colors" },
  qr_color: { type: "color", label: "QR code color", default: "#111111", group: "colors" },
  text_color: { type: "color", label: "Text color", default: "#111111", group: "colors" }
};

const PRESETS = {
  placard: { format: "placard" },
  keychain: { format: "keychain", show_text: false, hole: true },
  card: { format: "card" }
};

export default {
  id: "wifi-tag",
  version: 1,
  title: "Wi-Fi tag",
  blurb: "A guest Wi-Fi QR code as a placard, keychain or business card. Phones join by scanning it.",
  category: "tags",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: SCHEMA,
  rules,
  errorField,
  onParamChange,
  presets: PRESETS
};
