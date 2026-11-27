import { contrastRatio } from "../color.js?v=aedca5e5a0dd9e90";
import { findFont, FONT_SPEC } from "../fonts.js?v=aedca5e5a0dd9e90";
import { PRODUCT_MEDIA } from "../product-media.js?v=aedca5e5a0dd9e90";

const designs = [
  { id: "snowman", group: "Solid winter scenes", label: "Snowman", blurb: "A scarf, a top hat and falling snow.", params: {} },
  { id: "sledding", group: "Solid winter scenes", label: "Sledding", blurb: "A bundled-up rider on a snowy slope.", params: { scene: "sledding", font: "kaushan-script", plate_color: "#183f67", accent_color: "#ffc969" } },
  { id: "reindeer", group: "Solid winter scenes", label: "Reindeer", blurb: "A woodland reindeer beneath a winter star.", params: { scene: "reindeer", font: "alex-brush", plate_color: "#16473e", accent_color: "#efb47c" } },
  { id: "winter-tree", group: "Solid winter scenes", label: "Winter tree", blurb: "A decorated evergreen with a star topper.", params: { scene: "winter-tree", font: "lobster", plate_color: "#49345f", accent_color: "#9bdcaa" } },
  { id: "snowflake-lace", group: "Cut-through ornaments", label: "Snowflake lace", blurb: "An open snowflake joined to the ring at six points.", params: { scene: "snowflake-lace", font: "alex-brush", plate_color: "#20526e", snow_color: "#fff5db" } },
  { id: "woodland-cutout", group: "Cut-through ornaments", label: "Woodland cutout", blurb: "A reindeer and winter sky with no solid background.", params: { scene: "woodland-cutout", font: "lobster", plate_color: "#235c49", snow_color: "#fff5db" } },
  { id: "round-photo", group: "Photo frames", label: "Round photo frame", blurb: "A round window with a recessed seat for a paper photo.", params: { scene: "round-photo", font: "alex-brush", plate_color: "#772d43", accent_color: "#efb47c" } },
  { id: "square-photo", group: "Photo frames", label: "Square photo frame", blurb: "A rounded-square window with a recessed seat for a paper photo.", params: { scene: "square-photo", font: "kaushan-script", plate_color: "#244858", accent_color: "#90d7cb" } }
].map(design => ({
  ...design,
  image: PRODUCT_MEDIA[design.id === "snowman" ? "holiday-ornament" : `holiday-ornament-${design.id}`]
}));

const isOpenwork = scene => scene === "snowflake-lace" || scene === "woodland-cutout";
const scriptOptions = ["pacifico", "alex-brush", "kaushan-script", "lobster"].map(id => ({
  value: id, label: findFont(id).label, face: id
}));
const option = (value, label) => ({ value, label });
const raised = option("raised", "Raised");
const cutThrough = option("cut-through", "Cut through");
const hasYear = p => Boolean(p.year?.trim());

export default {
  id: "holiday-ornament", version: 3, title: "Holiday ornament",
  blurb: "Personalize winter scenes, openwork ornaments and photo frames with a cursive name and optional year.",
  category: "seasonal", origin: "house",
  rights: { publishable: true, note: "Original house vector geometry; no external artwork or meshes are used." },
  initialView: "front",
  font: FONT_SPEC,
  preserveDesignFields: ["name", "name_finish", "year", "year_side", "year_finish"],
  sections: { design: "Scene & lettering", size: "Size", colors: "Colors" },
  focus: [{ part: "Name", section: "design" }, { part: "Year", section: "design" }, { part: "Scene", section: "design" }, { part: "Ornament", section: "size" }],
  schema: {
    scene: { type: "enum", label: "Winter scene", options: designs.map(d => ({ value: d.id, label: d.label })), default: "snowman", group: "shape", section: "design" },
    name: { type: "text", label: "Name", max: 12, default: "Noel", help: "Up to 12 characters. Mixed case looks best in cursive.", group: "text", section: "design" },
    font: { type: "enum", label: "Name font", picker: "font", options: scriptOptions, default: "pacifico", group: "text", section: "design" },
    name_finish: { type: "enum", label: "Name finish", options: [raised, cutThrough], default: "raised", randomize: false, help: "Cut-through lettering uses small stencil bridges to keep enclosed centers attached.", group: "text", section: "design" },
    year: { type: "text", label: "Year (optional)", max: 4, default: "", optional: true, randomize: false, help: "Enter four digits, or leave blank for no year.", group: "text", section: "design" },
    year_side: { type: "enum", label: "Year placement", options: [option("front", "Below the name"), option("rear", "On the back")], default: "front", randomize: false, visibleWhen: hasYear, group: "text", section: "design" },
    year_finish: { type: "enum", label: "Year finish", options: [raised, option("engraved", "Engraved"), cutThrough], default: "raised", randomize: false, visibleWhen: hasYear, help: "Raised rear lettering needs supports on the back only. Cut-through lettering reads backward from the other side.", group: "text", section: "design" },
    diameter_mm: { type: "number", label: "Round body diameter", min: 70, max: 100, step: 5, default: 80, help: "Not including the ribbon loop. The opening is 5 mm wide.", group: "shape", section: "size" },
    plate_color: { type: "color", label: "Ornament color", default: "#80253f", group: "colors", section: "colors" },
    snow_color: { type: "color", label: "Lettering and snow color", default: "#fff5db", group: "colors", section: "colors" },
    accent_color: { type: "color", label: "Scene accent color", default: "#ffb36b", group: "colors", section: "colors", visibleWhen: p => !isOpenwork(p.scene) }
  },
  rules(o) {
    const fieldErrors = {};
    if (hasYear(o) && !/^[0-9]{4}$/.test(o.year.trim())) fieldErrors.year = "Enter a four-digit year.";
    for (const [key, label] of [["snow_color", "Lettering and snow"], ["accent_color", "Scene accent"]]) {
      if (key === "accent_color" && isOpenwork(o.scene)) continue;
      if (o[key] && o.plate_color && contrastRatio(o[key], o.plate_color) < 3) {
        fieldErrors[key] = `${label} color is too similar to the ornament color. Choose a higher-contrast color.`;
      }
    }
    return { errors: Object.values(fieldErrors), fieldErrors };
  },
  errorField: message => message.startsWith("The name") ? "name" : message.startsWith("The year") ? "year" : null,
  presets: Object.fromEntries(designs.map(d => [d.id, d.params])),
  defaultDesign: "snowman",
  designs
};
