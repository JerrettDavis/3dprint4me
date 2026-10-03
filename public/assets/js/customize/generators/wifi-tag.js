// Wi-Fi tag: parameter schema and rules. The QR code (and optional label) is a flush inlay on
// the TOP face. The password is sensitive: it lives only in the QR geometry of the model file
// and is redacted from drafts, the hand-off record, the server, email and webhooks.

const EPS = 1e-6;
const MIN_WEB = 0.8;          // solid base kept under the inlay
const DEPTH_RANGE = [0.6, 1.6];
const MIN_CONTRAST = 3;
const round1 = v => Math.round(v * 10) / 10;

// WCAG 2.x relative luminance and contrast ratio of two #rrggbb colors.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const depthMax = o => round1(Math.min(DEPTH_RANGE[1], o.thickness_mm - MIN_WEB));

function rules(o) {
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
      add(["base_color", "qr_color"], `Base color and QR code color are too similar (${ratio.toFixed(1)}:1; at least ${MIN_CONTRAST}:1 is needed) for a phone to scan the code.`);
    } else if (luminance(o.qr_color) >= luminance(o.base_color)) {
      add(["base_color", "qr_color"], "The QR code color must be darker than the Base color; many phones can't scan a light code on a dark tag.");
    }
  }
  return { limits: { qr_depth_mm: [DEPTH_RANGE[0], maxDepth] }, errors, fieldErrors };
}

// Maps a geometry (build) error to the field it belongs next to. The payload length is driven
// by the network name and password; the message never repeats either.
function errorField(message) {
  return /too dense/i.test(String(message ?? "")) ? "ssid" : null;
}

export default {
  id: "wifi-tag",
  version: 1,
  title: "Wi-Fi tag",
  blurb: "A guest Wi-Fi QR code as a placard, keychain or business card. Phones join by scanning it.",
  category: "tags",
  origin: "house",
  rights: { publishable: true, note: "House design." },
  schema: {
    format: { type: "enum", label: "Tag format", options: [
      { value: "placard", label: "Placard, 90 × 120 mm" },
      { value: "keychain", label: "Keychain, 45 × 60 mm" },
      { value: "card", label: "Business card, 85.6 × 54 mm" }
    ], default: "placard", group: "tag" },
    hole: { type: "bool", label: "Key-ring loop (keychain only)", default: true, group: "tag" },
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
  },
  rules,
  errorField,
  presets: {
    placard: { format: "placard" },
    keychain: { format: "keychain", show_text: false, hole: true },
    card: { format: "card" }
  }
};
