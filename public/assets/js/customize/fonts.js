// Curated, self-hosted fonts for generators (isomorphic: the browser form, the build worker and
// the server's re-validation all read this list). Every file is served same-origin from
// /customize/fonts/ (CSP font-src 'self'); its license text ships beside it and is recorded in
// customizer/static/fonts/LICENSES.md. Only SIL Open Font License 1.1 fonts belong here.
const font = (id, label, file, licenseFile, category = "display") => Object.freeze({ id, label, file, license: "OFL-1.1", licenseFile, category });

// Listed in picker order (FONT_CATEGORIES), so FONT_OPTIONS follows this array.
export const FONTS = Object.freeze([
  font("inter-bold", "Inter Bold", "Inter-Bold.ttf", "OFL-inter.txt", "sans"),
  font("montserrat-extrabold", "Montserrat ExtraBold", "Montserrat-ExtraBold.ttf", "OFL-montserrat.txt", "sans"),
  font("open-sans-bold", "Open Sans Bold", "OpenSans-Bold.ttf", "OFL-opensans.txt", "sans"),
  font("poppins-bold", "Poppins Bold", "Poppins-Bold.ttf", "OFL-poppins.txt", "sans"),
  font("work-sans-bold", "Work Sans Bold", "WorkSans-Bold.ttf", "OFL-worksans.txt", "sans"),
  font("cinzel-bold", "Cinzel Bold", "Cinzel-Bold.ttf", "OFL-cinzel.txt", "serif"),
  font("spectral-bold", "Spectral Bold", "Spectral-Bold.ttf", "OFL-spectral.txt", "serif"),
  font("crimson-text-bold", "Crimson Text Bold", "CrimsonText-Bold.ttf", "OFL-crimsontext.txt", "serif"),
  font("cardo-bold", "Cardo Bold", "Cardo-Bold.ttf", "OFL-cardo.txt", "serif"),
  font("gelasio-bold", "Gelasio Bold", "Gelasio-Bold.ttf", "OFL-gelasio.txt", "serif"),
  font("zilla-slab-bold", "Zilla Slab Bold", "ZillaSlab-Bold.ttf", "OFL-zillaslab.txt", "slab"),
  font("arvo-bold", "Arvo Bold", "Arvo-Bold.ttf", "OFL-arvo.txt", "slab"),
  font("jetbrains-mono-bold", "JetBrains Mono Bold", "JetBrainsMono-Bold.ttf", "OFL-jetbrainsmono.txt", "mono"),
  font("ibm-plex-mono-bold", "IBM Plex Mono Bold", "IBMPlexMono-Bold.ttf", "OFL-ibmplexmono.txt", "mono"),
  font("sacramento", "Sacramento", "Sacramento-Regular.ttf", "OFL-sacramento.txt", "script"),
  font("alex-brush", "Alex Brush", "AlexBrush-Regular.ttf", "OFL-alexbrush.txt", "script"),
  font("kaushan-script", "Kaushan Script", "KaushanScript-Regular.ttf", "OFL-kaushanscript.txt", "script"),
  font("caveat-bold", "Caveat Bold", "Caveat-Bold.ttf", "OFL-caveat.txt", "handwriting"),
  font("indie-flower", "Indie Flower", "IndieFlower-Regular.ttf", "OFL-indieflower.txt", "handwriting"),
  font("patrick-hand", "Patrick Hand", "PatrickHand-Regular.ttf", "OFL-patrickhand.txt", "handwriting"),
  font("pacifico", "Pacifico", "Pacifico-Regular.ttf", "OFL-pacifico.txt"),
  font("lobster", "Lobster", "Lobster-Regular.ttf", "OFL-lobster.txt"),
  font("bebas-neue", "Bebas Neue", "BebasNeue-Regular.ttf", "OFL-bebasneue.txt"),
  font("righteous", "Righteous", "Righteous-Regular.ttf", "OFL-righteous.txt"),
  font("caveat-brush", "Caveat Brush", "CaveatBrush-Regular.ttf", "OFL-caveatbrush.txt"),
  font("rubik-mono-one", "Rubik Mono One", "RubikMonoOne-Regular.ttf", "OFL-rubikmonoone.txt"),
  font("bangers", "Bangers", "Bangers-Regular.ttf", "OFL-bangers.txt"),
  font("titan-one", "Titan One", "TitanOne-Regular.ttf", "OFL-titanone.txt"),
  font("unifraktur-cook", "UnifrakturCook", "UnifrakturCook-Bold.ttf", "OFL-unifrakturcook.txt", "blackletter"),
  font("pirata-one", "Pirata One", "PirataOne-Regular.ttf", "OFL-pirataone.txt", "blackletter"),
  font("medievalsharp", "MedievalSharp", "MedievalSharp-Regular.ttf", "OFL-medievalsharp.txt", "fantasy"),
  font("uncial-antiqua", "Uncial Antiqua", "UncialAntiqua-Regular.ttf", "OFL-uncialantiqua.txt", "fantasy"),
  font("metamorphous", "Metamorphous", "Metamorphous-Regular.ttf", "OFL-metamorphous.txt", "fantasy"),
  font("cinzel-decorative-bold", "Cinzel Decorative Bold", "CinzelDecorative-Bold.ttf", "OFL-cinzeldecorative.txt", "fantasy"),
  font("rye", "Rye", "Rye-Regular.ttf", "OFL-rye.txt", "western"),
  font("sancreek", "Sancreek", "Sancreek-Regular.ttf", "OFL-sancreek.txt", "western")
]);

export const findFont = id => FONTS.find(f => f.id === id);

// The groups the picker shows, in order. The neutral families are offered in bold or heavy weights
// on purpose (thin strokes print badly); the label names the weight, e.g. "Montserrat ExtraBold".
export const FONT_CATEGORIES = Object.freeze([
  Object.freeze({ id: "sans", label: "Sans-serif" }),
  Object.freeze({ id: "serif", label: "Serif" }),
  Object.freeze({ id: "slab", label: "Slab serif" }),
  Object.freeze({ id: "mono", label: "Monospace" }),
  Object.freeze({ id: "script", label: "Script" }),
  Object.freeze({ id: "handwriting", label: "Handwriting" }),
  Object.freeze({ id: "display", label: "Display" }),
  Object.freeze({ id: "blackletter", label: "Blackletter" }),
  Object.freeze({ id: "fantasy", label: "Fantasy & medieval" }),
  Object.freeze({ id: "western", label: "Western" })
]);

// The curated fonts as picker options in FONT_CATEGORIES order; `group` is the heading to show.
const curatedOptions = () => FONT_CATEGORIES.flatMap(c => FONTS.filter(f => f.category === c.id)
  .map(f => Object.freeze({ value: f.id, label: f.label, face: f.id, group: c.label })));

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
  ...curatedOptions(),
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
  ...curatedOptions()
]);

/** Schema entry for one location's font override. `key` should end in `_font`. */
export const locationFontField = (key, label, { group = "text", section, visibleWhen } = {}) => ({
  [key]: { type: "enum", label, picker: "font", options: LOCATION_FONT_OPTIONS, default: FONT_INHERIT, locationFont: true, group, ...(section ? { section } : {}), ...(visibleWhen ? { visibleWhen } : {}) }
});

/** Curated font ids that the override keys of `params` ask for (the page and worker load them). */
export const locationFontIds = (generator, params) => {
  const ids = new Set();
  for (const [key, def] of Object.entries(generator.schema ?? {})) {
    if (!def.locationFont) continue;   // a flag, not option identity: this module may be loaded twice (with and without ?v=)
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
