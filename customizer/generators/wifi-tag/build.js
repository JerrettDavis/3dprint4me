// Wi-Fi tag geometry. The QR code and the optional label are flush inlays on the TOP face (+Z,
// the face a phone sees when the tag lies flat or hangs), so nothing is mirrored: viewed from
// +Z, QR row 0 is the +Y edge and column 0 the -X edge. The body is a core plus a top skin with
// the inlay cut out; the inlay fills the cut. buildModel frees the returned solids.
import qrcode from "qrcode-generator";
import { roundedRect, circle } from "../../framework/shapes.js";
import { qrCrossSection } from "../../framework/qr.js";
import { locationFont, splitBlockLines, blockTextLines, unsupportedBlockChars, BLOCK_SUBSTITUTION_WARNING, fontTextLines, FONT_CHARS_SKIPPED } from "../../framework/text.js";
import { FONT_BLOCK, FONT_NOT_LOADED, fontNeededMessage } from "../../../public/assets/js/customize/fonts.js";
import { qrModuleStatus, QR_FLOOR_MODULE_MM } from "../../../public/assets/js/customize/qr.js";
import { wifiPayload } from "../../../public/assets/js/customize/wifi.js";

export const FORMAT = Object.freeze({ placard: [90, 120], keychain: [45, 60], card: [85.6, 54] });
const EDGE = 3;              // minimum distance from the code to the tag edge (mm)
const QUIET = 2;             // modules of base color kept clear around the code
const QUIET_PAD = 1;         // plus this much (mm), so the quiet zone never ends exactly at the tag edge
const LOOP_R = 6, HOLE_R = 2.75, LOOP_OVERLAP = 3;   // 12 mm boss, 5.5 mm hole, 3 mm into the body
const BAND = 15;             // placard text band height
const RIM_CLEAR = 0.8;       // base kept clear between a border and anything inside it (mm)
const TEXT_CLEAR = 1;        // clearance between a text band and the code's quiet zone
const MIN_TEXT = 2.5;        // below this cap height (mm) the label is not legible: fail, never print it
const SMALL_TEXT = 3.5;      // warn below this cap height (mm)
const ARC_TOL = 0.05;        // the rounded corner is a polygon; keep this far inside the true arc

const HEX_EVEN = /^(?:[0-9a-fA-F]{2})+$/;
const TOO_LONG = {
  ssid: "The network name is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format.",
  title: "The title is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format."
};
const NONE_AVAILABLE = { ssid: "None of the characters in the network name are available in this font. Choose another font.", title: "None of the characters in the title are available in this font. Choose another font." };

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

// Decoration settings with the schema defaults for anything a caller left out.
export function decor(p) {
  return {
    border: p.border_style ?? "none", borderW: p.border_width_mm ?? 1.2, inset: p.border_inset_mm ?? 1,
    frame: p.qr_frame ?? "none", frameW: p.qr_frame_width_mm ?? 1.2, frameGap: p.qr_frame_gap_mm ?? 1,
    height: p.decor_height_mm ?? 0.6, titleDiv: p.title_divider === true, netDiv: p.network_divider === true,
    divW: p.divider_width_mm ?? 1, divPct: p.divider_length_pct ?? 70
  };
}

// Where the code (its margin square), the label boxes and the dividers go, per format. Pure
// layout numbers. A border keeps `rim` mm clear at the tag edge; a divider claims a strip of
// its own between a label and the code.
export function planLayout(p) {
  const [w, h] = FORMAT[p.format];
  const d = decor(p);
  const showText = p.show_text && p.format !== "keychain";
  const title = showText ? String(p.title ?? "").trim() : "";
  const ssid = showText ? String(p.ssid ?? "").trim() : "";
  const rim = d.border !== "none" ? d.inset + d.borderW + RIM_CLEAR : 0;
  const edge = Math.max(EDGE, rim);
  const boxes = [];
  const dividers = [];
  const skipped = [];
  const line = (kind, cx, cy, vertical, span) => {
    const len = Math.max(d.divW, (span * d.divPct) / 100);
    dividers.push({ kind, cx, cy, w: vertical ? d.divW : len, h: vertical ? len : d.divW });
  };
  let region = { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
  if (p.format === "placard" && showText) {
    const top = title ? BAND : 0;
    region = { ...region, y0: -h / 2 + BAND, y1: h / 2 - top };
    const bandBox = (y0, y1) => ({ cx: 0, cy: (y0 + y1) / 2, maxW: w - 4 * edge, maxH: y1 - y0 });
    const span = w - 2 * edge;
    if (title) {
      boxes.push({ kind: "title", text: title, ...bandBox(h / 2 - BAND + (d.titleDiv ? d.divW / 2 : 0) + TEXT_CLEAR, h / 2 - edge) });
      if (d.titleDiv) line("title", 0, h / 2 - BAND, false, span);
    } else if (d.titleDiv) skipped.push("title");
    if (ssid) {
      boxes.push({ kind: "ssid", text: ssid, ...bandBox(-h / 2 + edge, -h / 2 + BAND - (d.netDiv ? d.divW / 2 : 0) - TEXT_CLEAR) });
      if (d.netDiv) line("network", 0, -h / 2 + BAND, false, span);
    } else if (d.netDiv) skipped.push("network");
  } else if (p.format === "card" && showText) {
    region = { ...region, x1: -w / 2 + h };
    const x0 = region.x1 + TEXT_CLEAR + (d.netDiv ? d.divW : 0), x1 = w / 2 - edge - 1;
    const col = (y0, y1) => ({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, maxW: x1 - x0, maxH: y1 - y0 });
    const titleH = 7;
    if (title) boxes.push({ kind: "title", text: title, ...col(h / 2 - edge - 1 - titleH, h / 2 - edge - 1) });
    // The network name sits in the space under the title, at most two 14 mm-high lines' worth.
    if (ssid) {
      const area = title ? col(-h / 2 + edge, h / 2 - edge - titleH - 4) : col(-h / 2 + edge, h / 2 - edge);
      boxes.push({ kind: "ssid", text: ssid, ...area, maxH: Math.min(area.maxH, 14) });
    }
    // Title divider: in the gap between the title and the network name. Network divider: the
    // vertical rule between the code and the text column.
    if (d.titleDiv && title) line("title", (x0 + x1) / 2, h / 2 - edge - titleH - 2.5, false, x1 - x0);
    else if (d.titleDiv) skipped.push("title");
    if (d.netDiv && ssid) line("network", region.x1 + d.divW / 2, 0, true, h - 2 * edge);
    else if (d.netDiv) skipped.push("network");
  } else {
    if (d.titleDiv) skipped.push("title");
    if (d.netDiv) skipped.push("network");
  }
  return { w, h, region, boxes, dividers, skipped, rim, edge, loop: p.format === "keychain" && p.hole };
}

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

// The font for one label: the location's own choice, else the main font. Fails readably when the
// page has not supplied the font file.
function labelFont(p, ctx, key) {
  const lf = locationFont(p, ctx, key);
  if (lf.mode !== FONT_BLOCK && !lf.font) throw new Error(lf.mode === "custom" || lf.mode === "system" ? fontNeededMessage(lf.mode) : FONT_NOT_LOADED);
  return lf;
}

const FRAME_RADIUS = 4;

export default async function build(p, { wasm, font = null, fonts = {} } = {}) {
  const { CrossSection, Manifold } = wasm;
  const ctx = { font, fonts };
  const warnings = [];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  const solids = [];
  let ok = false;
  try {
    const layout = planLayout(p);
    const { w, h } = layout;
    const d = decor(p);
    const T = p.thickness_mm, D = p.qr_depth_mm;
    const r = Math.min(p.corner_radius_mm, w / 2 - 1e-3, h / 2 - 1e-3);
    if (d.border === "engraved" && d.height > T - 0.8 + 1e-6) {
      throw new Error(`An engraved border can be at most ${(T - 0.8).toFixed(1)} mm deep on a ${T} mm tag. Lower the decoration height or make the tag thicker.`);
    }
    for (const k of layout.skipped) warnings.push(`The ${k} divider was left out because this tag has no ${k === "title" ? "title" : "network name"} text to divide from the code.`);

    let body = t(roundedRect(CrossSection, w, h, p.corner_radius_mm));
    if (layout.loop) {
      const at = [0, h / 2 + LOOP_R - LOOP_OVERLAP];
      const boss = t(t(circle(CrossSection, LOOP_R)).translate(at));
      const hole = t(t(circle(CrossSection, HOLE_R)).translate(at));
      body = t(t(body.add(boss)).subtract(hole));
    }

    // QR: size the margin square first. A border pulls the usable area in from the tag edge.
    // Around the code it keeps max(EDGE, 2 modules + QUIET_PAD), so s + 2·max(EDGE, 2s/n + pad) <= L.
    // With a frame the code, its quiet zone, the gap and the frame must all fit: the frame's outer
    // edge keeps EDGE from the (pulled-in) area.
    const payload = wifiPayload({ ssid: p.ssid, password: p.password, security: p.security, hidden: p.hidden });
    const n = moduleCount(payload);
    const shrink = Math.max(0, layout.rim - EDGE);
    const g = layout.region;
    const area = {
      x0: g.x0 <= -w / 2 + 1e-9 ? g.x0 + shrink : g.x0, x1: g.x1 >= w / 2 - 1e-9 ? g.x1 - shrink : g.x1,
      y0: g.y0 <= -h / 2 + 1e-9 ? g.y0 + shrink : g.y0, y1: g.y1 >= h / 2 - 1e-9 ? g.y1 - shrink : g.y1
    };
    const square = largestSquare(area, w - 2 * shrink, h - 2 * shrink, Math.max(0, r - shrink));
    const framed = d.frame !== "none";
    const fullSize = framed
      ? (square.L - 2 * EDGE - 2 * (d.frameGap + d.frameW)) / (1 + (2 * QUIET) / n)
      : Math.min(square.L - 2 * EDGE, (square.L - 2 * QUIET_PAD) * n / (n + 2 * QUIET));
    const pct = p.qr_scale_pct ?? 100;
    const size = fullSize * pct / 100;
    let q;
    try {
      // Too dense at the largest size that fits: no scale setting can help.
      if (n * QR_FLOOR_MODULE_MM > fullSize) qrCrossSection(CrossSection, payload, Math.max(fullSize, 0));
      else if (n * QR_FLOOR_MODULE_MM > size) throw new Error(`${qrModuleStatus(size / n).message} Raise the QR code size.`);
      q = qrCrossSection(CrossSection, payload, size);
    } catch (error) {
      if (/too dense/.test(error.message)) throw new Error(`${error.message} Use a shorter network name/password or choose a larger tag format.`);
      throw error;
    }
    t(q.cs);
    const qr = t(q.cs.translate([square.cx, square.cy]));
    const status = qrModuleStatus(q.module);
    if (status.level === "marginal") warnings.push(status.message);
    if (p.security === "nopass" && p.password) warnings.push("The password is not used because Security is set to No password.");
    warnings.push(...credentialWarnings(p));

    // Label (never the password). Each location uses its own font, else the main font: the
    // built-in block font, or a real font (curated, installed or the customer's file) that the
    // page parsed and handed in.
    const labels = [];
    const byKind = {};
    let smallest = Infinity, skippedAny = false, blockUsed = false, ssidBlock = false;
    for (const box of layout.boxes) {
      const lf = labelFont(p, ctx, box.kind === "title" ? "title_font" : "network_font");
      let block;
      if (lf.mode === FONT_BLOCK) {
        block = blockTextLines(CrossSection, splitBlockLines(box.text, box), box, t);
        blockUsed ||= unsupportedBlockChars(box.text).length > 0;
        if (box.kind === "ssid" && box.text !== box.text.toUpperCase()) ssidBlock = true;
      } else {
        block = fontTextLines(CrossSection, lf.font, box.text, box, t);
        if (!block.cap) throw new Error(NONE_AVAILABLE[box.kind]);
        skippedAny ||= block.skipped;
      }
      // Fit or error: a label too small to read is never printed silently.
      if (block.cap < MIN_TEXT) throw new Error(TOO_LONG[box.kind]);
      labels.push(block.cs);
      byKind[box.kind] = block.cs;
      smallest = Math.min(smallest, block.cap);
    }
    if (blockUsed) warnings.push(BLOCK_SUBSTITUTION_WARNING);
    if (ssidBlock) warnings.push("The built-in font prints capital letters only; the QR code keeps the network name exactly as typed.");
    if (skippedAny) warnings.push(FONT_CHARS_SKIPPED);
    if (smallest < SMALL_TEXT) warnings.push(`The label prints only ${smallest.toFixed(1)} mm tall and may be hard to read; the QR code is unaffected.`);
    const label = labels.length ? t(CrossSection.union(labels)) : null;

    // Decorations. Raised parts stand on the top face; an engraved groove is cut from it.
    const ringOf = (outerW, outerH, outerR, width) => {
      const outer = t(roundedRect(CrossSection, outerW, outerH, outerR));
      const inner = t(roundedRect(CrossSection, outerW - 2 * width, outerH - 2 * width, Math.max(0, outerR - width)));
      return t(outer.subtract(inner));
    };
    const raise = cs => t(cs.extrude(d.height)).translate([0, 0, T]);
    const decorations = [];
    let groove = null;
    if (d.border !== "none") {
      const ring = ringOf(w - 2 * d.inset, h - 2 * d.inset, Math.max(0, r - d.inset), d.borderW);
      if (d.border === "raised") decorations.push({ name: "Border", cs: ring });
      else groove = t(t(ring.extrude(d.height + 1)).translate([0, 0, T - d.height]));
    }
    if (framed) {
      const half = size / 2 + QUIET * q.module + d.frameGap;
      const rad = d.frame === "rounded" ? FRAME_RADIUS : 0;
      const ring = ringOf(2 * (half + d.frameW), 2 * (half + d.frameW), rad, d.frameW);
      decorations.push({ name: "QR frame", cs: t(ring.translate([square.cx, square.cy])) });
    }
    for (const dv of layout.dividers) {
      const bar = t(roundedRect(CrossSection, dv.w, dv.h, Math.min(dv.w, dv.h) / 2));
      decorations.push({ name: `Divider (${dv.kind})`, cs: t(bar.translate([dv.cx, dv.cy])) });
    }

    const inlay = label ? t(qr.add(label)) : qr;
    const core = t(body.extrude(T - D));
    const skin = t(t(t(body.subtract(inlay)).extrude(D)).translate([0, 0, T - D]));
    // Results below are not registered with `t`: they are the output.
    let tagBody = Manifold.union([core, skin]);
    if (groove) { const grooved = tagBody.subtract(groove); tagBody.delete(); tagBody = grooved; }
    solids.push({ name: "Tag body", solid: tagBody, color: p.base_color });
    solids.push({ name: "QR code inlay", solid: t(qr.extrude(D)).translate([0, 0, T - D]), color: p.qr_color });
    if (byKind.title) solids.push({ name: "Title text inlay", solid: t(byKind.title.extrude(D)).translate([0, 0, T - D]), color: p.text_color });
    if (byKind.ssid) solids.push({ name: "Network name inlay", solid: t(byKind.ssid.extrude(D)).translate([0, 0, T - D]), color: p.text_color });
    for (const dec of decorations) solids.push({ name: dec.name, solid: raise(dec.cs), color: p.decor_color ?? "#111111" });

    ok = true;
    // The title and filename name only the format: they reach the operator and email.
    return { solids, warnings, title: `Wi-Fi tag - ${p.format}`, filenameBase: `wifi-tag-${p.format}` };
  } finally {
    for (const o of temps) free(o);
    if (!ok) for (const s of solids) free(s.solid);
  }
}
