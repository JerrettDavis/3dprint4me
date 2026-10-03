// Wi-Fi tag geometry. The QR code and the optional label are flush inlays on the TOP face (+Z,
// the face a phone sees when the tag lies flat or hangs), so nothing is mirrored: viewed from
// +Z, QR row 0 is the +Y edge and column 0 the -X edge. The body is a core plus a top skin with
// the inlay cut out; the inlay fills the cut. buildModel frees the returned solids.
import qrcode from "qrcode-generator";
import { roundedRect, circle } from "../../framework/shapes.js";
import { qrCrossSection } from "../../framework/qr.js";
import { splitBlockLines, blockTextLines, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING } from "../../framework/text.js";
import { wifiPayload } from "../../../public/assets/js/customize/wifi.js";

export const FORMAT = Object.freeze({ placard: [90, 120], keychain: [45, 60], card: [85.6, 54] });
const EDGE = 3;              // minimum distance from the code to the tag edge (mm)
const QUIET = 2;             // modules of base color kept clear around the code
const QUIET_PAD = 1;         // plus this much (mm), so the quiet zone never ends exactly at the tag edge
const LOOP_R = 6, HOLE_R = 2.75, LOOP_OVERLAP = 3;   // 12 mm boss, 5.5 mm hole, 3 mm into the body
const BAND = 15;             // placard text band height
const TEXT_CLEAR = 1;        // clearance between a text band and the code's quiet zone
const MIN_TEXT = 2.5;        // below this cap height (mm) the label is not legible: fail, never print it
const SMALL_TEXT = 3.5;      // warn below this cap height (mm)
const ARC_TOL = 0.05;        // the rounded corner is a polygon; keep this far inside the true arc

const HEX_EVEN = /^(?:[0-9a-fA-F]{2})+$/;
const TOO_LONG = {
  ssid: "The network name is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format.",
  title: "The title is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format."
};

// Credentials that are valid input but may not let a phone join. Never quotes the password.
export function credentialWarnings(p) {
  const out = [];
  const pw = p.security === "nopass" ? "" : String(p.password ?? "");
  const len = [...pw].length;
  if (p.security === "WPA" && pw) {
    if (len < 8 || len > 63) out.push("WPA passwords are normally 8–63 characters; check this one if phones can't connect.");
    if (/[^\x20-\x7e]/.test(pw)) out.push("The password has characters outside plain ASCII; some phones and routers can't use them. Check it if phones can't connect.");
  }
  if (p.security === "WEP" && pw && ![5, 13, 10, 26].includes(len)) out.push("WEP keys are 5 or 13 characters (or 10 or 26 hex digits); check this one if phones can't connect.");
  const wepHexKey = p.security === "WEP" && (len === 10 || len === 26);
  if (HEX_EVEN.test(String(p.ssid ?? "")) || (pw && !wepHexKey && HEX_EVEN.test(pw))) {
    out.push("Some phones may read this as a raw hex key; if it does not connect, change the name or password.");
  }
  return out;
}

// Module count the framework's qrCrossSection will use (same library, auto version, level M).
function moduleCount(payload) {
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  return qr.getModuleCount();
}

function insideRoundedRect(x, y, w, h, r) {
  const px = Math.abs(x), py = Math.abs(y);
  if (px > w / 2 || py > h / 2) return false;
  const ex = w / 2 - r, ey = h / 2 - r;
  return !(px > ex && py > ey) || Math.hypot(px - ex, py - ey) <= r - ARC_TOL;
}

// Largest square centered in `region` whose corners lie inside the rounded body outline.
function largestSquare(region, w, h, r) {
  const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2;
  const fits = L => [[-1, -1], [-1, 1], [1, -1], [1, 1]].every(([sx, sy]) => insideRoundedRect(cx + sx * L / 2, cy + sy * L / 2, w, h, r));
  let lo = 0, hi = Math.min(region.x1 - region.x0, region.y1 - region.y0);
  if (fits(hi)) return { cx, cy, L: hi };
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return { cx, cy, L: lo };
}

// Where the code (its margin square) and the label boxes go, per format. Pure layout numbers.
export function planLayout(p) {
  const [w, h] = FORMAT[p.format];
  const showText = p.show_text && p.format !== "keychain";
  const title = showText ? String(p.title ?? "").trim() : "";
  const ssid = showText ? String(p.ssid ?? "").trim() : "";
  const boxes = [];
  let region = { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
  if (p.format === "placard" && showText) {
    const top = title ? BAND : 0;
    region = { ...region, y0: -h / 2 + BAND, y1: h / 2 - top };
    const bandBox = (y0, y1) => ({ cx: 0, cy: (y0 + y1) / 2, maxW: w - 4 * EDGE, maxH: y1 - y0 });
    if (title) boxes.push({ kind: "title", text: title, ...bandBox(h / 2 - BAND + TEXT_CLEAR, h / 2 - EDGE) });
    if (ssid) boxes.push({ kind: "ssid", text: ssid, ...bandBox(-h / 2 + EDGE, -h / 2 + BAND - TEXT_CLEAR) });
  } else if (p.format === "card" && showText) {
    region = { ...region, x1: -w / 2 + h };
    const x0 = region.x1 + TEXT_CLEAR, x1 = w / 2 - EDGE - 1;
    const col = (y0, y1) => ({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, maxW: x1 - x0, maxH: y1 - y0 });
    const titleH = 7;
    if (title) boxes.push({ kind: "title", text: title, ...col(h / 2 - EDGE - 1 - titleH, h / 2 - EDGE - 1) });
    // The network name sits in the space under the title, at most two 14 mm-high lines' worth.
    if (ssid) {
      const area = title ? col(-h / 2 + EDGE, h / 2 - EDGE - titleH - 4) : col(-h / 2 + EDGE, h / 2 - EDGE);
      boxes.push({ kind: "ssid", text: ssid, ...area, maxH: Math.min(area.maxH, 14) });
    }
  }
  return { w, h, region, boxes, loop: p.format === "keychain" && p.hole };
}

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export default async function build(p, { wasm } = {}) {
  const { CrossSection, Manifold } = wasm;
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const layout = planLayout(p);
    const { w, h } = layout;
    const r = Math.min(p.corner_radius_mm, w / 2 - 1e-3, h / 2 - 1e-3);

    let body = t(roundedRect(CrossSection, w, h, p.corner_radius_mm));
    if (layout.loop) {
      const at = [0, h / 2 + LOOP_R - LOOP_OVERLAP];
      const boss = t(t(circle(CrossSection, LOOP_R)).translate(at));
      const hole = t(t(circle(CrossSection, HOLE_R)).translate(at));
      body = t(t(body.add(boss)).subtract(hole));
    }

    // QR: size the margin square first. Around the code it keeps max(EDGE, 2 modules + QUIET_PAD),
    // so s + 2·max(EDGE, 2s/n + pad) <= L.
    const payload = wifiPayload({ ssid: p.ssid, password: p.password, security: p.security, hidden: p.hidden });
    const n = moduleCount(payload);
    const square = largestSquare(layout.region, w, h, Math.max(0, r));
    const size = Math.min(square.L - 2 * EDGE, (square.L - 2 * QUIET_PAD) * n / (n + 2 * QUIET));
    let q;
    try {
      q = qrCrossSection(CrossSection, payload, size);
    } catch (error) {
      if (/too dense/.test(error.message)) throw new Error(`${error.message} Use a shorter network name/password or choose a larger tag format.`);
      throw error;
    }
    t(q.cs);
    const qr = t(q.cs.translate([square.cx, square.cy]));
    if (q.module < 0.9) warnings.push(`QR module size is ${q.module.toFixed(2)} mm. A 0.4 mm nozzle and a well-calibrated first layer are recommended.`);
    if (p.security === "nopass" && p.password) warnings.push("The password is not used because Security is set to No password.");
    warnings.push(...credentialWarnings(p));

    // Label (never the password).
    const labels = [];
    let smallest = Infinity;
    for (const box of layout.boxes) {
      const block = blockTextLines(CrossSection, splitBlockLines(box.text, box), box, t);
      // Fit or error: a label too small to read is never printed silently.
      if (block.cap < MIN_TEXT) throw new Error(TOO_LONG[box.kind]);
      labels.push(block.cs);
      smallest = Math.min(smallest, block.cap);
    }
    const printed = layout.boxes.map(b => b.text).join(" ");
    if (unsupportedBlockChars(printed).length) warnings.push(BLOCK_SUBSTITUTION_WARNING);
    const ssidBox = layout.boxes.find(b => b.kind === "ssid");
    if (ssidBox && ssidBox.text !== ssidBox.text.toUpperCase()) warnings.push("The built-in font prints capital letters only; the QR code keeps the network name exactly as typed.");
    if (smallest < SMALL_TEXT) warnings.push(`The label prints only ${smallest.toFixed(1)} mm tall and may be hard to read; the QR code is unaffected.`);
    const label = labels.length ? t(CrossSection.union(labels)) : null;

    const T = p.thickness_mm, D = p.qr_depth_mm;
    const inlay = label ? t(qr.add(label)) : qr;
    const core = t(body.extrude(T - D));
    const skin = t(t(t(body.subtract(inlay)).extrude(D)).translate([0, 0, T - D]));
    // Results below are not registered with `t`: they are the output.
    solids.push({ name: "Tag body", solid: Manifold.union([core, skin]), color: p.base_color });
    solids.push({ name: "QR code inlay", solid: t(qr.extrude(D)).translate([0, 0, T - D]), color: p.qr_color });
    if (label) solids.push({ name: "Label text inlay", solid: t(label.extrude(D)).translate([0, 0, T - D]), color: p.text_color });

    ok = true;
    // The title and filename name only the format: they reach the operator and email.
    return { solids, warnings, title: `Wi-Fi tag - ${p.format}`, filenameBase: `wifi-tag-${p.format}` };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
