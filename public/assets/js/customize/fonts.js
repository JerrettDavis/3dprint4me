// Curated, self-hosted fonts for generators (isomorphic: the browser form, the build worker and
// the server's re-validation all read this list). Every file is served same-origin from
// /customize/fonts/ (CSP font-src 'self'); its license text ships beside it and is recorded in
// customizer/static/fonts/LICENSES.md. Only SIL Open Font License 1.1 fonts belong here.
const font = (id, label, file, licenseFile, category = "display") => Object.freeze({ id, label, file, license: "OFL-1.1", licenseFile, category });

export const FONTS = Object.freeze([
  font("pacifico", "Pacifico", "Pacifico-Regular.ttf", "OFL-pacifico.txt"),
  font("lobster", "Lobster", "Lobster-Regular.ttf", "OFL-lobster.txt"),
  font("bebas-neue", "Bebas Neue", "BebasNeue-Regular.ttf", "OFL-bebasneue.txt"),
  font("righteous", "Righteous", "Righteous-Regular.ttf", "OFL-righteous.txt"),
  font("caveat-brush", "Caveat Brush", "CaveatBrush-Regular.ttf", "OFL-caveatbrush.txt"),
  font("rubik-mono-one", "Rubik Mono One", "RubikMonoOne-Regular.ttf", "OFL-rubikmonoone.txt"),
  font("bangers", "Bangers", "Bangers-Regular.ttf", "OFL-bangers.txt"),
  font("titan-one", "Titan One", "TitanOne-Regular.ttf", "OFL-titanone.txt")
]);

export const findFont = id => FONTS.find(f => f.id === id);

// ---- The font control every generator shares ---------------------------------------------
// One definition, so every customizer offers the same choices in the same order: the built-in
// block font, the curated fonts above, a font installed on the customer's computer, or a font
// file they pick. The last two are fonts we did not vet, so using one needs the customer's
// confirmation that they may use it for a printed item (font_license_ack). The font itself is
// read in the browser and never uploaded; only the confirmation is recorded with the request.
export const FONT_BLOCK = "block";
export const FONT_SYSTEM = "system";
export const FONT_CUSTOM = "custom";
export const FONT_KEY = "font";
export const FONT_ACK_KEY = "font_license_ack";

export const FONT_OPTIONS = Object.freeze([
  Object.freeze({ value: FONT_BLOCK, label: "Block (built-in)", face: FONT_BLOCK }),
  ...FONTS.map(f => Object.freeze({ value: f.id, label: f.label, face: f.id })),
  Object.freeze({ value: FONT_SYSTEM, label: "Installed on this computer", face: FONT_SYSTEM }),
  Object.freeze({ value: FONT_CUSTOM, label: "My own font file", face: FONT_CUSTOM })
]);

// ---- Per-location font override ----------------------------------------------------------
// A generator may let a text location (upper line, back text, a plate's second line...) use its own
// font. The override is an enum `<location>_font` whose default `inherit` means "use the main font".
// Overrides offer only fonts we ship (block or curated): a customer's own file or installed font
// is a single, license-confirmed choice and stays the main font only.
export const FONT_INHERIT = "inherit";
export const LOCATION_FONT_OPTIONS = Object.freeze([
  Object.freeze({ value: FONT_INHERIT, label: "Same as main font", face: FONT_BLOCK }),
  Object.freeze({ value: FONT_BLOCK, label: "Block (built-in)", face: FONT_BLOCK }),
  ...FONTS.map(f => Object.freeze({ value: f.id, label: f.label, face: f.id }))
]);

/** Schema entry for one location's font override. `key` should end in `_font`. */
export const locationFontField = (key, label, { group = "text", section, visibleWhen } = {}) => ({
  [key]: { type: "enum", label, picker: "font", options: LOCATION_FONT_OPTIONS, default: FONT_INHERIT, group, ...(section ? { section } : {}), ...(visibleWhen ? { visibleWhen } : {}) }
});

/** Curated font ids that the override keys of `params` ask for (the page and worker load them). */
export const locationFontIds = (generator, params) => {
  const ids = new Set();
  for (const [key, def] of Object.entries(generator.schema ?? {})) {
    if (def.options !== LOCATION_FONT_OPTIONS) continue;
    const v = params?.[key];
    if (v && v !== FONT_INHERIT && v !== FONT_BLOCK && findFont(v)) ids.add(v);
  }
  return [...ids];
};

/** True for the two choices that bring a font we have not vetted. */
export const fontNeedsLicense = value => value === FONT_SYSTEM || value === FONT_CUSTOM;

export const FONT_ACK_LABEL = "I have the right to use this font to make a printed item.";
export const FONT_ACK_HELP = "We can't check a font's license. Many fonts forbid commercial use or embedding, so confirm yours allows this before continuing. The font stays on this device and is never uploaded.";
export const FONT_ACK_REQUIRED = "Confirm that you may use this font for a printed item.";

/**
 * The schema entries to spread into a generator's schema: { font, font_license_ack }.
 * `used` (params => boolean) says when the design prints text at all (a keychain tag has none);
 * the font controls show only then.
 */
export const fontSchema = (group = "text", used = () => true) => ({
  [FONT_KEY]: { type: "enum", label: "Font", picker: "font", options: FONT_OPTIONS, default: FONT_BLOCK, group, visibleWhen: params => used(params) },
  [FONT_ACK_KEY]: { type: "bool", label: FONT_ACK_LABEL, help: FONT_ACK_HELP, default: false, transient: true, visibleWhen: params => used(params) && fontNeedsLicense(params[FONT_KEY]), group }
});

/** What the page needs to know to drive the shared font control (see framework/app.js). */
export const FONT_SPEC = Object.freeze({ key: FONT_KEY, custom: FONT_CUSTOM, system: FONT_SYSTEM, ack: FONT_ACK_KEY, curated: true });

/** The rule fragment every generator's rules() includes: the confirmation is required (when the font is used). */
export const fontRule = (params, used = true) => (used && fontNeedsLicense(params[FONT_KEY]) && params[FONT_ACK_KEY] !== true
  ? { errors: [FONT_ACK_REQUIRED], fieldErrors: { [FONT_ACK_KEY]: FONT_ACK_REQUIRED } }
  : { errors: [], fieldErrors: {} });

/** Shown when the chosen font is a file or an installed font that hasn't been picked yet. */
export const fontNeededMessage = mode => (mode === FONT_SYSTEM
  ? "Choose an installed font below, or pick one of the listed fonts."
  : "Choose a font file below, or pick one of the listed fonts.");
export const FONT_NOT_LOADED = "The selected font isn't loaded. Try again, or pick another font.";
