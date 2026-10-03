// Customer image input for generator pages. The file is decoded in the browser onto a small
// canvas and traced on the main thread; only the traced contours (plain arrays) go to the build
// worker. The image, its bytes and its file name are never stored, logged or sent anywhere.
import { traceImage, checkContours, MAX_SOURCE_SIDE } from "./image-trace.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DECLARED_PIXELS = 64_000_000;   // second guard on the declared size
// Dimensions are read from at most this much. JPEG EXIF/XMP/ICC segments (up to 64 KB each) can
// sit before the frame header, so the window is generous; the marker walk stays step-bounded.
export const HEADER_BYTES = 512 * 1024;
export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const WORK_SIDE = 512;   // the image is decoded at most this large on its long edge

const NOT_AN_IMAGE = "That file isn't a PNG, JPEG, WebP or GIF image.";
const NO_SIZE = "That image's size couldn't be read from the file. Try saving it again as PNG or JPEG.";
const TOO_LARGE = `The image is too large. Use an image at most ${MAX_SOURCE_SIDE} pixels on each side.`;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (b, at, text) => [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** The image type from its first bytes (magic numbers), whatever the file claims; or null. */
export function sniffImageType(b) {
  if (!(b instanceof Uint8Array)) return null;
  if (b.length >= 8 && PNG_MAGIC.every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) return "image/gif";
  if (b.length >= 12 && ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
  return null;
}

function jpegSize(b) {
  // Walk the marker segments up to the first start-of-frame. Every step advances, and the walk
  // is bounded by the buffer and a step count, so a malformed file cannot loop.
  let i = 2;
  for (let steps = 0; steps < 10000 && i + 4 <= b.length; steps++) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                                // fill byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }  // standalone markers
    if (m === 0xd9 || m === 0xda) return null;                         // end / scan before a frame
    const len = be16(b, i + 2);
    if (len < 2) return null;
    // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > b.length || len < 7) return null;
      return { width: be16(b, i + 7), height: be16(b, i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8 ")) {
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (ascii(b, 12, "VP8X")) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
  return null;
}

/**
 * Declared pixel size from an image file's first bytes, without decoding it: PNG (IHDR),
 * GIF (logical screen), WebP (VP8, VP8L, VP8X) and JPEG (first SOF segment). The format is
 * sniffed from the bytes; `mime` is only a hint and is never trusted. Returns null when the
 * header is not one of these formats, is truncated or declares a zero size.
 */
export function readImageSize(bytes, _mime) {
  const b = bytes;
  const type = sniffImageType(b);
  let size = null;
  if (type === "image/png") size = b.length >= 24 && ascii(b, 12, "IHDR") ? { width: be32(b, 16), height: be32(b, 20) } : null;
  else if (type === "image/gif") size = b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : null;
  else if (type === "image/webp") size = webpSize(b);
  else if (type === "image/jpeg") size = jpegSize(b);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** Rejects a missing, empty or over-8 MB file before anything is read. Throws a readable error. */
export function checkImageFile(file) {
  if (!file) throw new Error("No image was chosen.");
  if (!(file.size > 0)) throw new Error("That image file is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is larger than 8 MB. Choose a smaller file.");
}

const defaultCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

/**
 * Decodes an image file (first frame of an animation; EXIF orientation as the browser applies
 * it) to at most WORK_SIDE pixels on its long edge. The declared size is read from the file
 * header first, so an image that would decode to a huge bitmap is refused before any decoding.
 * The decode itself is resized by the browser (only the long side is given, so the aspect ratio
 * is kept even when EXIF rotation swaps the sides). Returns { pixels, width, height,
 * sourceWidth, sourceHeight }. `decode` and `makeCanvas` are injection points for tests.
 */
export async function decodeImageFile(file, { decode = (...a) => createImageBitmap(...a), makeCanvas = defaultCanvas } = {}) {
  checkImageFile(file);
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (!sniffImageType(head)) throw new Error(NOT_AN_IMAGE);
  const declared = readImageSize(head);
  if (!declared) throw new Error(NO_SIZE);
  const { width, height } = declared;
  if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > MAX_DECLARED_PIXELS) throw new Error(TOO_LARGE);
  const scale = Math.min(1, WORK_SIDE / Math.max(width, height));
  const resize = width >= height ? { resizeWidth: Math.max(1, Math.round(width * scale)) } : { resizeHeight: Math.max(1, Math.round(height * scale)) };
  let bitmap;
  try {
    bitmap = await decode(file, { ...resize, resizeQuality: "low" });
  } catch {
    throw new Error("That image couldn't be read. Try a PNG or JPEG file.");
  }
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) throw new Error("The image is empty.");
    const fit = Math.min(1, WORK_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * fit)), h = Math.max(1, Math.round(bitmap.height * fit));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { pixels: data.data, width: w, height: h, sourceWidth: width, sourceHeight: height };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Latest pick wins: each call decodes a file, but only the most recent call's outcome counts.
 * Resolves { data } or { error } for the latest pick, and { stale: true } for a pick that a later
 * one replaced while it was still decoding.
 */
export function createImageLoader(decode = decodeImageFile) {
  let seq = 0;
  return async file => {
    const mine = ++seq;
    try {
      const data = await decode(file);
      return mine === seq ? { data } : { stale: true };
    } catch (error) {
      return mine === seq ? { error: String(error?.message ?? "That image couldn't be read.") } : { stale: true };
    }
  };
}

/** Traces with caching: the same image, threshold and invert reuse the last contours. */
export function createTracer() {
  let last = { image: null, key: "", contours: null };
  return (image, threshold, invert) => {
    const key = `${threshold}:${invert}`;
    if (last.image === image && last.key === key) return last.contours;
    const contours = checkContours(traceImage({ pixels: image.pixels, width: image.width, height: image.height, threshold, invert }));
    last = { image, key, contours };
    return contours;
  };
}

/** Draws the traced rectangles, dark on white, fitted into the canvas. */
export function drawTracePreview(canvas, contours) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!contours?.length) return;
  let maxX = 0, maxY = 0;
  for (const c of contours) for (const [x, y] of c) { maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const s = Math.min(canvas.width / maxX, canvas.height / maxY);
  const ox = (canvas.width - maxX * s) / 2, oy = (canvas.height - maxY * s) / 2;
  ctx.fillStyle = "#1d2733";
  ctx.beginPath();
  for (const c of contours) {
    c.forEach(([x, y], i) => { const px = ox + x * s, py = oy + (maxY - y) * s; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
  }
  ctx.fill("nonzero");
}
