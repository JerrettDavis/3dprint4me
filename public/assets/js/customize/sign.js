// The display sign's shared constants and pure helpers (isomorphic): the definition's schema and
// rules and the builder both read them, so a slot count or a limit changes in one place.
// Sign coordinates are millimetres from the middle of the main board: +x right, +y up.

export const TEXT_SLOTS = 8;
export const DECO_SLOTS = 12;
export const HOLDER_TEXT_SLOTS = 2;
export const PALETTE_SIZE = 5;
export const PALETTE_KEYS = Object.freeze(Array.from({ length: PALETTE_SIZE }, (_, i) => `color_${i + 1}`));
export const COLOR_SLOTS = Object.freeze(Array.from({ length: PALETTE_SIZE }, (_, i) => String(i + 1)));

export const BOARD_W = Object.freeze([80, 250]);
export const BOARD_H = Object.freeze([50, 220]);
export const COORD = 130;                     // how far from the centre a placed element may sit
export const MIN_BODY_MM = 2;                 // sign body kept under the raised artwork
export const THROAT_SLACK_MM = 0.5;           // default clearance of the holder's slot over the tongue
export const CARD_POCKET_MARGIN_MM = 2;       // pocket is this much wider than the card, each side
export const HOLDER_WALL_MM = 8;              // side wall kept beside the pocket and the slot
export const HOLDER_TEXT_RELIEF_MM = 0.6;
export const HOLDER_BACK_WALL_MM = 7;         // holder material behind the slot, measured at the slot's bottom
export const HOLDER_FRONT_WALL_MM = 4;        // thinnest front wall in front of the card pocket (at the top)
export const POCKET_WALL_MM = 3;              // wall between the card pocket and the slot

export const DECO_KINDS = Object.freeze([
  Object.freeze({ value: "none", label: "None" }),
  Object.freeze({ value: "frame", label: "Rounded-rectangle outline" }),
  Object.freeze({ value: "plate", label: "Filled rounded rectangle" }),
  Object.freeze({ value: "ring", label: "Ring (circle outline)" }),
  Object.freeze({ value: "disc", label: "Disc (filled circle)" }),
  Object.freeze({ value: "arc", label: "Arc (open ring)" }),
  Object.freeze({ value: "line", label: "Line" }),
  Object.freeze({ value: "heart", label: "Heart" }),
  Object.freeze({ value: "star", label: "Star" }),
  Object.freeze({ value: "diamond", label: "Diamond" }),
  Object.freeze({ value: "mail", label: "Icon: envelope" }),
  Object.freeze({ value: "globe", label: "Icon: globe" }),
  Object.freeze({ value: "pin", label: "Icon: map pin" }),
  Object.freeze({ value: "phone", label: "Icon: phone" })
]);
export const STROKE_KINDS = Object.freeze(["frame", "ring", "arc", "line"]);
export const RADIUS_KINDS = Object.freeze(["frame", "plate"]);
export const ICON_KINDS = Object.freeze(["mail", "globe", "pin", "phone"]);

/** The hex color a slot ("1".."5") names in the sign's palette. */
export const slotHex = (params, slot) => params?.[`color_${slot}`];

export const textKeys = i => ({
  text: `t${i}_text`, x: `t${i}_x`, y: `t${i}_y`, size: `t${i}_size`, align: `t${i}_align`,
  color: `t${i}_color`, rot: `t${i}_rot`, fit: `t${i}_fit`, font: `t${i}_font`
});
export const decoKeys = j => ({
  kind: `d${j}_kind`, x: `d${j}_x`, y: `d${j}_y`, w: `d${j}_w`, h: `d${j}_h`, stroke: `d${j}_stroke`,
  radius: `d${j}_radius`, rot: `d${j}_rot`, sweep: `d${j}_sweep`, color: `d${j}_color`
});
export const holderTextKeys = n => ({
  text: `h${n}_text`, x: `h${n}_x`, y: `h${n}_y`, size: `h${n}_size`, color: `h${n}_color`, font: `h${n}_font`
});

export const hasText = (params, i) => String(params?.[`t${i}_text`] ?? "").trim().length > 0;
export const hasHolderText = (params, n) => String(params?.[`h${n}_text`] ?? "").trim().length > 0;
export const hasDeco = (params, j) => (params?.[`d${j}_kind`] ?? "none") !== "none";

export const wantsSign = params => params.output !== "holder";
export const wantsHolder = params => params.output !== "sign";

/** The tongue's slot in the holder: wide enough for the tongue, as thick as the body plus the gap. */
export const throatMm = params => (params.thickness_mm - params.relief_mm) + params.fit_gap_mm;
export const bodyMm = params => params.thickness_mm - params.relief_mm;
export const pocketWidthMm = params => params.card_w_mm + 2 * CARD_POCKET_MARGIN_MM;

export const BOARD_CLEAR_MM = 0.5;            // the board's lower edge must sit at least this far above the holder's top
export const COVER_CLEARANCE_MM = 1;          // lettering stays this far above the top of the cards

/** What a QR code encodes: bare web addresses ("example.com/menu") get https:// so phones open them as links. */
export const qrPayload = params => {
  const raw = String(params?.qr_data ?? "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || /\s/.test(raw) || !/^[^/]+\.[^/]+/.test(raw)) return raw;
  return "https://" + raw;
};

/**
 * Where the holder's slot and card pocket sit, in the holder's own frame: x across, y from the
 * back (+) to the front (-) around the middle of its footprint, z up from the underside.
 * The slot leans back by `lean_deg` going up, so its bottom edge is the frontmost. The tongue
 * bears on the slot floor at `seat_mm`; the board's lower edge then sits at seat + tongue height
 * (along the lean), which must clear the holder's top.
 */
export function holderLayout(p) {
  const lean = (p.lean_deg * Math.PI) / 180;
  const throat = throatMm(p);
  const slotRise = p.holder_h_mm - p.seat_mm;                          // vertical depth of the slot
  const reach = slotRise * Math.tan(lean);                              // how far the slot's top sits behind its bottom
  const slotY = p.holder_d_mm / 2 - HOLDER_BACK_WALL_MM - throat / 2 - reach;
  const slotFront = slotY - throat / 2;
  const pocketY1 = slotFront - POCKET_WALL_MM;
  const pocketY0 = pocketY1 - p.pocket_depth_mm;
  const frontTop = -p.holder_d_mm / 2 + p.holder_taper_mm;              // the front face at the holder's top
  const minDepth = (p.holder_card
    ? p.pocket_depth_mm + HOLDER_FRONT_WALL_MM + p.holder_taper_mm + POCKET_WALL_MM
    : p.holder_taper_mm + HOLDER_FRONT_WALL_MM) + throat + HOLDER_BACK_WALL_MM + reach;
  const boardBottom = p.seat_mm + p.tongue_h_mm * Math.cos(lean);       // z of the board's lower edge
  const minSeat = Math.ceil((p.holder_h_mm + BOARD_CLEAR_MM - p.tongue_h_mm * Math.cos(lean)) * 10) / 10;
  // How far up the board the cards reach, measured along the board from its lower edge.
  const cardCover = p.holder_card ? Math.max(0, (p.pocket_floor_mm + p.card_h_mm - boardBottom) / Math.cos(lean)) : 0;
  return { throat, slotRise, reach, slotY, slotFront, pocketY0, pocketY1, frontWall: pocketY0 - frontTop, minDepth: Math.ceil(minDepth), boardBottom, minSeat, cardCover };
}
