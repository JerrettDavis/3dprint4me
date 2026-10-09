// Pumpkin: parameter schema, rules and designs. A parametric pumpkin that can be solid, a hollow
// shell (a tealight cover when open at the bottom), a single-wall vase, or a bowl with a lid;
// smooth, ridged, knitted or lattice; with a cute, classic or custom face (inlay, engraved or cut
// through); and a stem printed attached or as a separate peg-in part. The geometry lives in
// pumpkin-shape.js (shared) and customizer/generators/pumpkin/build.js (worker only).
import { contrastRatio } from "../color.js?v=8b580d4116242dd0";
import { baseCut, faceBox, geometry, minTealightDiameter, splitCut, TEALIGHT_HEIGHT_MM, TEALIGHT_OPENING_MM, tealightFit } from "../pumpkin-shape.js?v=8b580d4116242dd0";

const EPS = 1e-6;
const MIN_WALL = 1.2;           // hollow shells
const BOWL_WALL = 2;            // bowls: room for the tongue-and-recess lid joint
const MIN_EFFECTIVE_WALL = 0.8; // thinnest point after grooves and texture
const MIN_FACE_MM = 24;         // narrowest printable face
const MIN_CONTRAST = 2;
const round1 = v => Math.round(v * 10) / 10;

const FACE_PRESETS = ["traditional", "cute", "happy", "spooky", "surprised", "sleepy"];
const hollowStyle = o => o.style === "hollow" || o.style === "bowl";
const isVase = o => o.style === "vase";
const hasFace = o => o.face !== "none" && !isVase(o);
const noTop = o => isVase(o) || (o.style === "hollow" && o.opening === "top");
const hasStem = o => o.stem !== "none" && !noTop(o);
const hasCheeks = o => hasFace(o) && ["cute", "happy", "custom"].includes(o.face);

function rules(o) {
  const fieldErrors = {};
  const errors = [];
  const add = (keys, message) => { errors.push(message); for (const k of keys) fieldErrors[k] ??= message; };
  // A vase prints one continuous wall and an open top has nowhere for a stem: the controls are
  // hidden and the builder ignores them, but the values are kept so switching back restores them.
  const limits = {};
  const hollow = hollowStyle(o);
  const minWall = o.style === "bowl" ? BOWL_WALL : MIN_WALL;
  if (hollow) limits.wall_mm = [minWall, 4];
  if (hollow && Number.isFinite(o.wall_mm) && o.wall_mm < minWall - EPS) add(["wall_mm"], `${o.style === "bowl" ? "A bowl needs" : "A hollow shell needs"} a wall of at least ${minWall} mm to print${o.style === "bowl" ? " and for its lid joint" : ""}.`);
  if (hollow) {
    const thin = o.wall_mm * (1 - o.rib_depth_pct / 100 * 1.15) - (o.decoration === "ridges" || o.decoration === "knit" ? o.texture_depth_mm : 0);
    if (thin < MIN_EFFECTIVE_WALL - EPS) add(["wall_mm"], `The wall gets too thin (${thin.toFixed(1)} mm) in the grooves and texture. Make the wall thicker or the ribs shallower.`);
  }
  if (o.decoration === "lattice" && o.style !== "hollow") add(["decoration"], "A lattice needs a hollow shell: choose the Hollow shell type, or another surface.");
  if (o.decoration === "lattice" && hasFace(o)) add(["face"], "A lattice and a face can't be combined: choose No face, or another surface.");
  if (hasFace(o) && o.face_style === "cutout" && !hollow) add(["face_style"], "A cut-through face needs a hollow shell or a bowl. Choose Inlay or Engraved, or a hollow type.");
  if (hollow && hasFace(o) && o.face_style === "engraved" && Number.isFinite(o.face_depth_mm)) {
    const max = Math.max(0.4, round1(o.wall_mm - MIN_EFFECTIVE_WALL));
    limits.face_depth_mm = [0.4, max];
    if (o.face_depth_mm > max + EPS) add(["face_depth_mm"], `An engraved face in a ${o.wall_mm} mm wall can be at most ${max} mm deep.`);
  }
  if (hasFace(o) && o.multicolor && o.face_style !== "cutout" && typeof o.body_color === "string" && typeof o.face_color === "string") {
    const ratio = contrastRatio(o.body_color, o.face_color);
    if (ratio < MIN_CONTRAST - EPS) add(["body_color", "face_color"], `Body color and Face color are too similar (${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is needed) for the face to show.`);
  }
  if (hasFace(o) || isVase(o) || o.style === "bowl") {
    // Geometry-dependent checks use the same shape math as the builder.
    const g = geometry(o);
    if (hasFace(o)) {
      const box = faceBox(o, g);
      if (box.width < MIN_FACE_MM - EPS) add(["face_size_pct"], `The face would be only ${box.width.toFixed(0)} mm wide; at least ${MIN_FACE_MM} mm is needed to print its features. Make the face or the pumpkin larger.`);
      if (box.top > g.top * 0.8) add(["face_size_pct", "face_height_pct"], "The face reaches the top of the pumpkin. Move the face lower or make it smaller.");
      if (box.bottom < baseCut(o, g).z + 2) add(["face_size_pct", "face_height_pct"], "The face reaches the base. Move the face higher or make it smaller.");
      if (o.style === "bowl" && box.top > splitCut(o, g).z - 3) add(["split_pct", "face_height_pct"], "The face reaches the lid. Move the face lower or the lid split higher.");
    }
  }
  if (o.style === "hollow" && o.opening === "bottom" && o.tealight_fit) {
    const fit = tealightFit(o);
    if (fit.opening < TEALIGHT_OPENING_MM - EPS || fit.height < TEALIGHT_HEIGHT_MM - EPS) {
      const need = minTealightDiameter(o);
      limits.diameter_mm = [need ?? 50, 180];
      add(["diameter_mm"], need
        ? `A tealight needs a ${TEALIGHT_OPENING_MM} mm opening and ${TEALIGHT_HEIGHT_MM} mm of height inside. With these settings the pumpkin must be at least ${need} mm wide (it is ${fit.opening.toFixed(0)} mm wide inside now).`
        : "A tealight does not fit inside with these settings. Make the wall thinner or the base wider.");
    }
  }
  if (hasStem(o) && o.stem === "peg") {
    limits.peg_diameter_mm = [4, Math.max(4, round1(o.stem_width_mm * 0.8))];
    if (o.peg_diameter_mm > o.stem_width_mm * 0.8 + EPS) add(["peg_diameter_mm"], `The peg can be at most ${limits.peg_diameter_mm[1]} mm across for a ${o.stem_width_mm} mm stem.`);
  }
  return { limits, errors, fieldErrors };
}

function errorField(message) {
  const text = String(message ?? "");
  if (/lattice/i.test(text)) return "lattice_cols";
  if (/tealight/i.test(text)) return "diameter_mm";
  if (/face/i.test(text)) return "face";
  if (/peg|stem/i.test(text)) return "stem";
  if (/wall/i.test(text)) return "wall_mm";
  if (/lid|split/i.test(text)) return "split_pct";
  return null;
}

const when = (obj, extra) => o => Object.entries(obj).every(([k, v]) => (Array.isArray(v) ? v.includes(o[k]) : o[k] === v)) && (!extra || extra(o));
const notVase = o => !isVase(o);
const stemShown = o => !noTop(o);

const SCHEMA = {
  style: { type: "enum", label: "Pumpkin type", options: [
    { value: "solid", label: "Solid" },
    { value: "hollow", label: "Hollow shell" },
    { value: "vase", label: "Vase mode (open top, one wall)" },
    { value: "bowl", label: "Bowl with lid" }
  ], default: "solid", randomize: false, group: "type", section: "type",
  help: "Solid is a keepsake. A hollow shell can be a tealight cover. Vase mode is a solid model for your slicer's Spiral vase setting. A bowl comes with a lid." },
  opening: { type: "enum", label: "Hollow shell opening", options: [
    { value: "bottom", label: "Open bottom (tealight cover)" },
    { value: "top", label: "Open top" },
    { value: "closed", label: "Sealed" }
  ], default: "bottom", randomize: false, visibleWhen: { style: "hollow" }, group: "type", section: "type",
  help: "A sealed shell traps its print supports unless the face is cut through." },
  tealight_fit: { type: "bool", label: "Fit a tealight (41 mm opening, 17 mm tall)", default: false, randomize: false, visibleWhen: when({ style: "hollow", opening: "bottom" }), group: "type", section: "type" },
  multicolor: { type: "bool", label: "Multi-color (AMS / multi-material)", default: true, randomize: false, group: "type", section: "type",
    help: "Off prints every part in the body color: an inlay becomes an engraving and the stem is its own part." },
  stem: { type: "enum", label: "Stem", options: [
    { value: "fused", label: "Printed attached" },
    { value: "peg", label: "Separate, with a peg" },
    { value: "none", label: "No stem" }
  ], default: "fused", randomize: false, visibleWhen: stemShown, group: "type", section: "stem",
  help: "A peg stem prints on its own and plugs into a hole in the top. Attached prints with the pumpkin (its own color when multi-color)." },
  wall_mm: { type: "number", label: "Wall thickness", min: 1.2, max: 4, step: 0.2, default: 1.6, unit: "mm", advanced: true, visibleWhen: hollowStyle, group: "type", section: "type",
    help: "Hollow shells need at least 1.2 mm; a bowl needs 2 mm so its lid joint is strong enough." },
  opening_pct: { type: "int", label: "Opening width", min: 45, max: 90, step: 5, default: 60, unit: "%", advanced: true, visibleWhen: o => isVase(o) || (o.style === "hollow" && o.opening === "top"), group: "type", section: "type" },
  split_pct: { type: "int", label: "Lid split height", min: 55, max: 90, step: 1, default: 78, unit: "%", advanced: true, visibleWhen: { style: "bowl" }, group: "type", section: "type" },

  diameter_mm: { type: "number", label: "Width", min: 50, max: 180, step: 1, default: 80, unit: "mm", randomize: false, group: "size", section: "shape" },
  height_pct: { type: "int", label: "Height (squat to tall)", min: 55, max: 130, step: 1, default: 82, unit: "%", group: "size", section: "shape" },
  boxiness_pct: { type: "int", label: "Boxiness", min: 0, max: 100, step: 5, default: 20, unit: "%", advanced: true, group: "size", section: "shape" },
  taper_pct: { type: "int", label: "Pear shape (top to bottom heavy)", min: -30, max: 30, step: 1, default: 0, unit: "%", advanced: true, group: "size", section: "shape" },
  oblong_pct: { type: "int", label: "Oblong (stretched sideways)", min: 0, max: 25, step: 1, default: 0, unit: "%", advanced: true, group: "size", section: "shape" },
  twist_deg: { type: "int", label: "Lobe twist", min: -90, max: 90, step: 5, default: 0, unit: "°", advanced: true, group: "size", section: "shape" },
  dimple_pct: { type: "int", label: "Stem dimple depth", min: 0, max: 20, step: 1, default: 8, unit: "%", advanced: true, group: "size", section: "shape" },
  flat_base_pct: { type: "int", label: "Flat base width", min: 30, max: 90, step: 5, default: 50, unit: "%", advanced: true, group: "size", section: "shape",
    help: "Never narrower than 30 mm across, so the pumpkin stands and sticks to the bed." },

  segments: { type: "int", label: "Lobes", min: 6, max: 16, step: 1, default: 10, group: "ribs", section: "ribs" },
  rib_depth_pct: { type: "int", label: "Groove depth", min: 0, max: 25, step: 1, default: 9, unit: "%", group: "ribs", section: "ribs" },
  rib_sharpness: { type: "int", label: "Groove sharpness", min: 1, max: 8, step: 1, default: 3, advanced: true, group: "ribs", section: "ribs", help: "1 is a soft wave, 8 a narrow crease." },
  irregularity_pct: { type: "int", label: "Natural irregularity", min: 0, max: 100, step: 5, default: 0, unit: "%", advanced: true, group: "ribs", section: "ribs" },
  seed: { type: "int", label: "Irregularity seed", min: 1, max: 999, step: 1, default: 7, advanced: true, visibleWhen: o => o.irregularity_pct > 0, group: "ribs", section: "ribs" },

  decoration: { type: "enum", label: "Surface", options: [
    { value: "smooth", label: "Smooth" },
    { value: "ridges", label: "Fine ridges" },
    { value: "knit", label: "Knitted" },
    { value: "lattice", label: "Lattice (cut through)" }
  ], default: "smooth", randomize: false, group: "surface", section: "surface" },
  texture_depth_mm: { type: "number", label: "Texture depth", min: 0.2, max: 1, step: 0.1, default: 0.5, unit: "mm", advanced: true, visibleWhen: { decoration: ["ridges", "knit"] }, group: "surface", section: "surface" },
  fine_ridges: { type: "int", label: "Ridges per lobe", min: 2, max: 8, step: 1, default: 4, advanced: true, visibleWhen: { decoration: "ridges" }, group: "surface", section: "surface" },
  knit_per_lobe: { type: "int", label: "Stitches per lobe", min: 2, max: 5, step: 1, default: 3, advanced: true, visibleWhen: { decoration: "knit" }, group: "surface", section: "surface" },
  lattice_shape: { type: "enum", label: "Lattice holes", options: [
    { value: "diamond", label: "Diamonds" },
    { value: "round", label: "Circles" },
    { value: "slot", label: "Tall slots" }
  ], default: "diamond", advanced: true, visibleWhen: { decoration: "lattice" }, group: "surface", section: "surface" },
  lattice_cols: { type: "int", label: "Holes around", min: 6, max: 36, step: 1, default: 20, advanced: true, visibleWhen: { decoration: "lattice" }, group: "surface", section: "surface" },
  lattice_rows: { type: "int", label: "Hole rows", min: 3, max: 12, step: 1, default: 6, advanced: true, visibleWhen: { decoration: "lattice" }, group: "surface", section: "surface" },
  lattice_open_pct: { type: "int", label: "Hole size", min: 30, max: 80, step: 5, default: 55, unit: "%", advanced: true, visibleWhen: { decoration: "lattice" }, group: "surface", section: "surface", help: "Of the space between holes. The bars between them stay at least 1.6 mm." },

  face: { type: "enum", label: "Face", options: [
    { value: "none", label: "No face" },
    { value: "cute", label: "Cute" },
    { value: "traditional", label: "Traditional jack-o'-lantern" },
    { value: "happy", label: "Happy" },
    { value: "spooky", label: "Spooky" },
    { value: "surprised", label: "Surprised" },
    { value: "sleepy", label: "Sleepy" },
    { value: "custom", label: "Custom (pick each feature)" }
  ], default: "cute", visibleWhen: notVase, group: "face", section: "face" },
  face_style: { type: "enum", label: "Face style", options: [
    { value: "inlay", label: "Inlay (own color)" },
    { value: "engraved", label: "Engraved" },
    { value: "cutout", label: "Cut through (hollow only)" }
  ], default: "inlay", randomize: false, visibleWhen: o => hasFace(o), group: "face", section: "face" },
  eye_shape: { type: "enum", label: "Eyes", options: [
    { value: "circle", label: "Round" }, { value: "oval", label: "Oval" }, { value: "triangle", label: "Triangle" },
    { value: "angry", label: "Angry" }, { value: "happy", label: "Happy arches" }, { value: "slit", label: "Sleepy slits" },
    { value: "star", label: "Stars" }, { value: "heart", label: "Hearts" }, { value: "diamond", label: "Diamonds" }
  ], default: "oval", advanced: true, visibleWhen: when({ face: "custom" }, notVase), group: "face", section: "face" },
  nose_shape: { type: "enum", label: "Nose", options: [
    { value: "none", label: "None" }, { value: "triangle", label: "Triangle" }, { value: "round", label: "Round" },
    { value: "diamond", label: "Diamond" }, { value: "nostrils", label: "Nostrils" }
  ], default: "triangle", advanced: true, visibleWhen: when({ face: "custom" }, notVase), group: "face", section: "face" },
  mouth_shape: { type: "enum", label: "Mouth", options: [
    { value: "none", label: "None" }, { value: "smile", label: "Smile" }, { value: "grin", label: "Big grin" },
    { value: "jagged", label: "Jagged teeth" }, { value: "zigzag", label: "Zigzag" }, { value: "round", label: "Round" }, { value: "cat", label: "Cat" }
  ], default: "smile", advanced: true, visibleWhen: when({ face: "custom" }, notVase), group: "face", section: "face" },
  cheeks: { type: "bool", label: "Cheeks (blush)", default: true, advanced: true, visibleWhen: o => hasCheeks(o) && o.face_style !== "cutout", group: "face", section: "face" },
  face_size_pct: { type: "int", label: "Face size", min: 30, max: 90, step: 5, default: 60, unit: "%", advanced: true, visibleWhen: o => hasFace(o), group: "face", section: "face" },
  face_height_pct: { type: "int", label: "Face height", min: 25, max: 75, step: 1, default: 50, unit: "%", advanced: true, visibleWhen: o => hasFace(o), group: "face", section: "face" },
  face_depth_mm: { type: "number", label: "Inlay / engraving depth", min: 0.4, max: 2.4, step: 0.2, default: 1.2, unit: "mm", advanced: true, visibleWhen: o => hasFace(o) && o.face_style !== "cutout", group: "face", section: "face" },

  stem_height_mm: { type: "number", label: "Stem height", min: 6, max: 40, step: 1, default: 14, unit: "mm", advanced: true, visibleWhen: o => hasStem(o), group: "stem", section: "stem" },
  stem_width_mm: { type: "number", label: "Stem width", min: 6, max: 24, step: 1, default: 11, unit: "mm", advanced: true, visibleWhen: o => hasStem(o), group: "stem", section: "stem" },
  stem_bend_pct: { type: "int", label: "Stem curl", min: 0, max: 100, step: 5, default: 35, unit: "%", advanced: true, visibleWhen: o => hasStem(o), group: "stem", section: "stem" },
  stem_ridges: { type: "int", label: "Stem ridges", min: 3, max: 8, step: 1, default: 6, advanced: true, visibleWhen: o => hasStem(o), group: "stem", section: "stem" },
  peg_diameter_mm: { type: "number", label: "Peg width", min: 4, max: 10, step: 0.5, default: 6, unit: "mm", advanced: true, visibleWhen: o => hasStem(o) && o.stem === "peg", group: "stem", section: "stem" },
  peg_length_mm: { type: "number", label: "Peg length", min: 4, max: 14, step: 1, default: 8, unit: "mm", advanced: true, visibleWhen: o => hasStem(o) && o.stem === "peg", group: "stem", section: "stem" },
  peg_clearance_mm: { type: "number", label: "Peg clearance", min: 0.1, max: 0.5, step: 0.05, default: 0.25, unit: "mm", advanced: true, visibleWhen: o => hasStem(o) && o.stem === "peg", group: "stem", section: "stem", help: "Gap around the peg in its hole. Raise it if your printer is tight." },

  body_color: { type: "color", label: "Pumpkin color", default: "#f28a1d", group: "colors", section: "colors" },
  stem_color: { type: "color", label: "Stem color", default: "#3f7d2a", visibleWhen: o => o.multicolor && hasStem(o), group: "colors", section: "colors" },
  face_color: { type: "color", label: "Face color", default: "#2b1a10", visibleWhen: o => o.multicolor && hasFace(o) && o.face_style !== "cutout", group: "colors", section: "colors" },
  cheek_color: { type: "color", label: "Cheek color", default: "#ff7f9e", advanced: true, visibleWhen: o => o.multicolor && hasCheeks(o) && o.face_style !== "cutout" && o.cheeks, group: "colors", section: "colors" }
};

const SECTIONS = {
  type: "Pumpkin type",
  shape: "Size and shape",
  ribs: "Lobes",
  surface: "Surface",
  face: "Face",
  stem: "Stem",
  colors: "Colors"
};
const FOCUS = [
  { part: "Pumpkin", section: "shape" },
  { part: "Bowl", section: "shape" },
  { part: "Lid", section: "type" },
  { part: "Stem", section: "stem" },
  { part: "Face", section: "face" },
  { part: "Cheeks", section: "face" }
];

const PRESETS = {
  cute: {},
  classic: { style: "hollow", opening: "bottom", tealight_fit: true, multicolor: false, stem: "peg", face: "traditional", face_style: "cutout", diameter_mm: 110 },
  knitted: { decoration: "knit", rib_depth_pct: 6, texture_depth_mm: 0.7, face: "cute" },
  ridged: { style: "hollow", opening: "bottom", tealight_fit: true, multicolor: false, stem: "peg", decoration: "ridges", segments: 12, rib_depth_pct: 12, face: "none", diameter_mm: 120 },
  lattice: { style: "hollow", opening: "bottom", tealight_fit: true, multicolor: false, stem: "peg", decoration: "lattice", face: "none", diameter_mm: 120 },
  bowl: { style: "bowl", wall_mm: 2.4, stem: "peg", face: "none", diameter_mm: 105 },
  vase: { style: "vase", segments: 12, rib_depth_pct: 14, diameter_mm: 100 }
};

// Ready-made designs, offered before customizing. Each is a partial parameter set over the
// defaults (the default design is the cute solid pumpkin).
const DESIGNS = [
  { id: "cute", label: "Cute pumpkin", blurb: "A solid pumpkin with an inlaid cute face and a green stem. The default.", group: "Solid", params: PRESETS.cute },
  { id: "knitted", label: "Knitted pumpkin", blurb: "Cosy knit stitches with a cute face.", group: "Solid", params: PRESETS.knitted },
  { id: "ghost", label: "Ghost pumpkin", blurb: "A pale pumpkin with a spooky inlaid face.", group: "Solid", params: { body_color: "#efe8da", face: "spooky", segments: 12, rib_depth_pct: 10, face_color: "#2b2b3a" } },
  { id: "cinderella", label: "Squat and deep-ribbed", blurb: "A wide, flat pumpkin with deep grooves.", group: "Shapes", params: { height_pct: 62, boxiness_pct: 30, segments: 14, rib_depth_pct: 14, dimple_pct: 12, face: "happy" } },
  { id: "twisted", label: "Twisted gourd", blurb: "Tall, with lobes that spiral up.", group: "Shapes", params: { height_pct: 105, twist_deg: 45, segments: 12, rib_depth_pct: 13, taper_pct: -10, face: "none" } },
  { id: "mini", label: "Mini keepsake", blurb: "A small, happy pumpkin.", group: "Shapes", params: { diameter_mm: 55, height_pct: 78, face: "happy", segments: 8 } },
  { id: "classic", label: "Jack-o'-lantern", blurb: "A hollow tealight cover with a cut-through traditional face. Single color; the stem plugs in.", group: "Lanterns", params: PRESETS.classic },
  { id: "ridged", label: "Ridged tealight", blurb: "Twelve ridged lobes; an electric tealight glows through the walls.", group: "Lanterns", params: PRESETS.ridged },
  { id: "lattice", label: "Lattice lantern", blurb: "A hollow pumpkin with diamond cut-outs.", group: "Lanterns", params: PRESETS.lattice },
  { id: "bowl", label: "Pumpkin bowl", blurb: "A bowl with a removable lid and a plug-in stem.", group: "Containers", params: PRESETS.bowl },
  { id: "vase", label: "Pumpkin vase", blurb: "A single-wall ribbed vase for your slicer's vase mode.", group: "Containers", params: PRESETS.vase }
];

export default {
  id: "pumpkin",
  version: 1,
  title: "Pumpkin",
  blurb: "Design a pumpkin: solid, hollow tealight cover, vase or bowl with a lid, with a face, knit or lattice surface, and a plug-in or attached stem.",
  category: "seasonal",
  origin: "house",
  rights: { publishable: true, note: "House design, generated from first principles; reference models were only studied for proportions and printability." },
  schema: SCHEMA,
  rules,
  errorField,
  sections: SECTIONS,
  focus: FOCUS,
  presets: PRESETS,
  designs: DESIGNS,
  defaultDesign: "cute",
  // A pumpkin is a round 3D object: start in 3D and call the flat views what they show.
  initialView: "3d",
  viewLabels: { front: "Top", back: "Bottom" }
};
