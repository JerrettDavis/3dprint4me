// Font loading for the build worker. Curated fonts are self-hosted under /customize/fonts/
// (same origin; CSP connect-src 'self'). A customer's own font file arrives as bytes and is
// parsed locally; it is never uploaded. No remote font services.
import * as opentype from "opentype.js";

// Curated, self-hosted OFL fonts: id -> { file, label }. Empty until fonts are added (Task 9).
export const CURATED_FONTS = Object.freeze({});

const parse = (opentype.parse ?? opentype.default?.parse);
const curatedCache = new Map();
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
 * Returns an opentype.js Font or null.
 * fontId: curated id (fetched same-origin, cached). fontBytes: customer file bytes (cached by fontKey).
 */
export async function loadFont({ fontId, fontBytes, fontKey, fetchImpl = (...a) => fetch(...a) } = {}) {
  if (fontBytes) {
    if (fontKey && lastCustom.key === fontKey) return lastCustom.font;
    const font = parseFont(toArrayBuffer(fontBytes));
    lastCustom = { key: fontKey ?? null, font };
    return font;
  }
  if (fontId) {
    const entry = Object.hasOwn(CURATED_FONTS, fontId) ? CURATED_FONTS[fontId] : null;
    if (!entry) throw new Error("That font isn't available.");
    if (!curatedCache.has(fontId)) {
      const pending = fetchImpl(`/customize/fonts/${encodeURIComponent(entry.file)}`)
        .then(response => { if (!response.ok) throw new Error("The font couldn't be loaded."); return response.arrayBuffer(); })
        .then(parseFont)
        .catch(error => { curatedCache.delete(fontId); throw error; });
      curatedCache.set(fontId, pending);
    }
    return curatedCache.get(fontId);
  }
  return null;
}
