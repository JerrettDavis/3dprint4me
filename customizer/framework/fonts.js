// Font loading for the build worker. Curated fonts are self-hosted under /customize/fonts/
// (same origin; CSP connect-src 'self'). A customer's own font file arrives as bytes and is
// parsed locally; it is never uploaded or stored. No remote font services.
import * as opentype from "opentype.js";
import { FONTS } from "../../public/assets/js/customize/fonts.js";

// Curated, self-hosted OFL fonts: id -> { file, label } (derived from the shared FONTS list).
export const CURATED_FONTS = Object.freeze(Object.fromEntries(FONTS.map(f => [f.id, Object.freeze({ file: f.file, label: f.label })])));

const parse = (opentype.parse ?? opentype.default?.parse);
const curatedCache = new Map();
// The last customer file only, in this worker's memory, so moving a slider doesn't re-parse it.
let lastCustom = { key: null, font: null };

const toArrayBuffer = bytes => {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  throw new Error("Font file bytes are missing.");
};

function parseFont(buffer) {
  try {
    return parse(buffer);
  } catch {
    throw new Error("That font file couldn't be read. Try a TTF, OTF or WOFF file.");
  }
}

/**
 * Returns an opentype.js Font or null (the built-in block font).
 * fontId: curated id (fetched same-origin, parsed once, cached); "block" or none -> null.
 * fontBytes: customer file bytes (parsed locally; the latest one is kept by fontKey).
 */
export async function loadFont({ fontId, fontBytes, fontKey, fetchImpl = (...a) => fetch(...a) } = {}) {
  if (fontBytes) {
    if (fontKey && lastCustom.key === fontKey) return lastCustom.font;
    const font = parseFont(toArrayBuffer(fontBytes));
    lastCustom = { key: fontKey ?? null, font };
    return font;
  }
  if (!fontId || fontId === "block") return null;
  const entry = Object.hasOwn(CURATED_FONTS, fontId) ? CURATED_FONTS[fontId] : null;
  if (!entry) throw new Error("That font isn't available.");
  if (!curatedCache.has(fontId)) {
    const pending = Promise.resolve()
      .then(() => fetchImpl(`/customize/fonts/${encodeURIComponent(entry.file)}`, { credentials: "same-origin" }))
      .then(response => { if (!response.ok) throw new Error("The font couldn't be loaded. Check your connection and try again."); return response.arrayBuffer(); })
      .then(parseFont)
      .catch(error => { curatedCache.delete(fontId); throw error; });
    curatedCache.set(fontId, pending);
  }
  return curatedCache.get(fontId);
}
