// Ready-made display signs (partial parameter sets over the schema defaults) and the data-only
// presets. The commissioned ones reproduce displays made for customers (the logo itself is the
// customer's own image, added on the page; these use lettering and shapes where it would go).
// QR content is a bare web address: the build adds the scheme (see qrPayload in sign.js).
import { decoKeys, holderTextKeys, textKeys } from "../sign.js?v=8a2c8406a349c4e2";

const text = (i, o) => {
  const k = textKeys(i);
  const out = { [k.text]: o.text, [k.x]: o.x ?? 0, [k.y]: o.y ?? 0, [k.size]: o.size ?? 6, [k.align]: o.align ?? "center", [k.color]: o.color ?? "3", [k.fit]: o.fit ?? 0 };
  if (o.rot) out[k.rot] = o.rot;
  if (o.font) out[k.font] = o.font;
  return out;
};
const deco = (j, o) => {
  const k = decoKeys(j);
  const out = { [k.kind]: o.kind, [k.x]: o.x ?? 0, [k.y]: o.y ?? 0, [k.w]: o.w ?? 20, [k.color]: o.color ?? "2" };
  if (o.h !== undefined) out[k.h] = o.h;
  if (o.stroke !== undefined) out[k.stroke] = o.stroke;
  if (o.radius !== undefined) out[k.radius] = o.radius;
  if (o.rot) out[k.rot] = o.rot;
  if (o.sweep !== undefined) out[k.sweep] = o.sweep;
  return out;
};
const holderText = (n, o) => {
  const k = holderTextKeys(n);
  const out = { [k.text]: o.text, [k.x]: o.x, [k.y]: o.y ?? 0, [k.size]: o.size ?? 4, [k.color]: o.color ?? "2" };
  if (o.font) out[k.font] = o.font;
  return out;
};
const all = (...parts) => Object.assign({}, ...parts);
// Slots the starter fills that a design may blank out.
const BLANK_TEXT = i => ({ [textKeys(i).text]: "" });
const BLANK_DECO = j => ({ [decoKeys(j).kind]: "none" });

// Chef Curt: a black board with a gold frame, white lettering and a white QR tile (225 × 158 board,
// 225 × 84 × 36 holder with a card pocket and gold lettering on its front). Positions are measured
// from the commissioned model's layout metrics and top view, from the board's middle.
const CHEF_CURT = all(
  { board_w_mm: 225, board_h_mm: 158, corner_radius_mm: 17, tongue_w_mm: 200, tongue_h_mm: 26, holder_w_mm: 225, holder_d_mm: 84, holder_h_mm: 36, card_w_mm: 91, card_h_mm: 55, pocket_depth_mm: 27, fit_gap_mm: 0.5, lean_deg: 8, seat_mm: 14, holder_stripes: true, holder_stripe_color: "2", holder_color: "1" },
  { color_1: "#212327", color_2: "#c8a15a", color_3: "#fafaf7", color_4: "#c8a15a", color_5: "#6b8e45" },
  deco(1, { kind: "frame", x: 0, y: 0, w: 221.3, h: 154.3, radius: 14, stroke: 1.6, color: "2" }),
  deco(2, { kind: "ring", x: -43.6, y: 26.8, w: 92, h: 92, stroke: 2.2, color: "2" }),
  deco(3, { kind: "frame", x: 61.5, y: 25.9, w: 77.6, h: 77.6, radius: 3, stroke: 1.6, color: "2" }),
  deco(4, { kind: "mail", x: -88, y: -34, w: 11, h: 8.4, color: "2" }),
  deco(5, { kind: "globe", x: -88, y: -51.4, w: 11, h: 11, color: "2" }),
  text(1, { text: "THE\nPLATE\nPLUG", x: -43.6, y: 28, size: 11.5, color: "2", fit: 60, font: "bangers" }),
  text(2, { text: "EST. 2015", x: -43.6, y: -10, size: 5, color: "2", font: "poppins-bold" }),
  text(3, { text: "assistant@fromme2ucatering.com", x: -74.5, y: -34, size: 7.2, align: "left", color: "3", fit: 177, font: "poppins-bold" }),
  text(4, { text: "www.cookingwithchefcurt.com", x: -74.5, y: -51.5, size: 7.2, align: "left", color: "3", fit: 176, font: "poppins-bold" }),
  text(5, { text: "SCAN ME", x: 61.5, y: -18.4, size: 5.3, color: "2", font: "poppins-bold" }),
  { qr_on: true, qr_data: "www.cookingwithchefcurt.com", qr_x: 61.5, qr_y: 25.9, qr_size_mm: 58, qr_quiet_mm: 8, qr_tile: "3", qr_ink: "1" },
  holderText(1, { text: "SCAN TO LEAVE A\nGOOGLE REVIEW OR\nBOOK YOUR EVENT", x: -80, y: 0, size: 3.6, color: "2", font: "poppins-bold" }),
  holderText(2, { text: "CATERING\nPRIVATE CHEF\nEVENTS", x: 80, y: 0, size: 3.6, color: "2", font: "poppins-bold" })
);

// Bradley's Bakery: a white board with a pink frame, script name, contact lines with icons, a
// pink heart divider and a QR code (225 × 194 board, 225 × 84 × 36 holder with pink lettering).
// Positions are measured from the commissioned model's layout.json and top view.
const BRADLEYS_BAKERY = all(
  { board_w_mm: 225, board_h_mm: 194, corner_radius_mm: 18, tongue_w_mm: 200, tongue_h_mm: 24, holder_w_mm: 225, holder_d_mm: 84, holder_h_mm: 36, card_w_mm: 91, card_h_mm: 55, pocket_depth_mm: 27, fit_gap_mm: 0.5, lean_deg: 8, seat_mm: 14, holder_stripes: true, holder_stripe_color: "2", holder_color: "1" },
  { color_1: "#fefdf9", color_2: "#dc427e", color_3: "#292e30", color_4: "#cda06a", color_5: "#678344" },
  deco(1, { kind: "frame", x: 0, y: 0, w: 220, h: 189, radius: 15, stroke: 1.7, color: "2" }),
  deco(2, { kind: "arc", x: -40.5, y: 28, w: 114, h: 114, stroke: 1.7, sweep: 180, rot: 280, color: "2" }),
  deco(3, { kind: "arc", x: -40.5, y: 28, w: 114, h: 114, stroke: 1.7, sweep: 75, rot: 190, color: "2" }),
  deco(4, { kind: "frame", x: 66.5, y: 48, w: 77.6, h: 77.6, radius: 4, stroke: 1.7, color: "2" }),
  deco(5, { kind: "line", x: 48.6, y: -13.7, w: 20, stroke: 1.2, color: "2" }),
  deco(6, { kind: "heart", x: 66.5, y: -13.7, w: 7, h: 6.5, color: "2" }),
  deco(7, { kind: "line", x: 84.6, y: -13.7, w: 20, stroke: 1.2, color: "2" }),
  deco(8, { kind: "line", x: 10.6, y: -36.6, w: 171, stroke: 1.2, color: "2" }),
  deco(9, { kind: "line", x: 17.9, y: -55.7, w: 153.5, stroke: 1.2, color: "2" }),
  deco(10, { kind: "globe", x: -90.5, y: -46.2, w: 10, h: 10, color: "3" }),
  deco(11, { kind: "mail", x: -90.5, y: -64.1, w: 10, h: 7, color: "3" }),
  text(1, { text: "Bradleys Bakery", x: -38.9, y: 24.7, size: 17, color: "2", font: "pacifico", fit: 118 }),
  text(2, { text: "Cakes, Pastries, Treats", x: -38.9, y: -17.1, size: 8, color: "3", font: "caveat-bold", fit: 72 }),
  text(3, { text: "bradleysbakery.org", x: 9.5, y: -44.9, size: 8.5, color: "3", font: "poppins-bold", fit: 122 }),
  text(4, { text: "bradleysbakeryllc@gmail.com", x: 10.5, y: -63.5, size: 7.7, color: "3", font: "poppins-bold", fit: 165 }),
  text(5, { text: "SCAN TO ORDER", x: 66.5, y: 1.2, size: 4.9, color: "3", font: "poppins-bold", fit: 74 }),
  { qr_on: true, qr_data: "linktr.ee/qr/b8f3ea64-9c72-40d4-a835-69581ef506bd", qr_x: 66.5, qr_y: 48, qr_size_mm: 59.4, qr_quiet_mm: 7.3, qr_tile: "1", qr_ink: "3" },
  holderText(1, { text: "BAKED\nWITH\nLOVE", x: -80, y: 0, size: 5, color: "2", font: "poppins-bold" }),
  holderText(2, { text: "CAKES\nPASTRIES\nTREATS", x: 80, y: 0, size: 5, color: "2", font: "poppins-bold" })
);

const STARTER = {};

// A plain holder with no card pocket: for a table sign, a menu or a notice.
const NO_CARDS = {
  holder_card: false, holder_d_mm: 40, holder_stripes: true,
  ...BLANK_TEXT(3), ...BLANK_TEXT(4), ...BLANK_TEXT(5), ...BLANK_DECO(3), ...BLANK_DECO(4),
  qr_on: false,
  ...text(1, { text: "WELCOME", x: 0, y: 14, size: 22, color: "2", fit: 170 }),
  ...text(2, { text: "PLEASE ORDER AT THE COUNTER", x: 0, y: -16, size: 6, color: "3", fit: 170 }),
  ...deco(2, { kind: "line", x: 0, y: -2, w: 140, stroke: 1.4, color: "2" })
};

// A sign only: no tongue, no holder (hang it, stick it or stand it your own way).
const SIGN_ONLY = { output: "sign", tongue: false };

export const PRESETS = {
  starter: STARTER,
  "no-cards": NO_CARDS,
  "sign-only": SIGN_ONLY
};

export const DESIGNS = [
  { id: "starter", label: "Starter sign", blurb: "Name, tagline, contact lines with icons and a QR code, in a holder with a card pocket. The default.", group: "Start here", params: STARTER },
  { id: "chef-curt", label: "Chef Curt: sign", blurb: "A black board with a gold frame, white contact lines and a white QR tile. Print the holder as its own piece (it is 225 mm wide, so the pair would not share one bed).", group: "Commissioned signs", params: { ...CHEF_CURT, output: "sign" } },
  { id: "chef-curt-holder", label: "Chef Curt: holder", blurb: "The matching 225 mm holder: a card pocket, gold stripes and gold lettering on the front.", group: "Commissioned signs", params: { ...CHEF_CURT, output: "holder" } },
  { id: "bradleys-bakery", label: "Bradley's Bakery: sign", blurb: "A white board with a pink frame, script name, heart divider and QR code. Print the holder as its own piece.", group: "Commissioned signs", params: { ...BRADLEYS_BAKERY, output: "sign" } },
  { id: "bradleys-bakery-holder", label: "Bradley's Bakery: holder", blurb: "The matching 225 mm holder: a card pocket, pink stripes and pink lettering on the front.", group: "Commissioned signs", params: { ...BRADLEYS_BAKERY, output: "holder" } },
  { id: "no-cards", label: "Table sign, no card pocket", blurb: "A big welcome message in a plain holder.", group: "Other layouts", params: NO_CARDS },
  { id: "sign-only", label: "Sign only", blurb: "The starter sign without a tongue or holder.", group: "Other layouts", params: SIGN_ONLY }
];
