// Customer image input for generator pages. The file is decoded in the browser onto a small
// canvas and traced on the main thread; only the traced contours (plain arrays) go to the build
// worker. The image, its bytes and its file name are never stored, logged or sent anywhere.
import { traceImage, checkContours, MAX_SOURCE_SIDE } from "./image-trace.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const WORK_SIDE = 512;   // the decoded image is drawn at most this large before tracing

/** Rejects a file by type and size before it is decoded. Pure; throws a readable error. */
export function checkImageFile(file) {
  if (!file) throw new Error("No image was chosen.");
  if (!IMAGE_TYPES.includes(String(file.type))) throw new Error("That file isn't a PNG, JPEG, WebP or GIF image.");
  if (!(file.size > 0)) throw new Error("That image file is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is larger than 8 MB. Choose a smaller file.");
}

/**
 * Decodes an image file (first frame of an animation; EXIF orientation as the browser applies
 * it) onto a canvas at most WORK_SIDE pixels on its long edge. Returns { pixels, width, height,
 * sourceWidth, sourceHeight }.
 */
export async function decodeImageFile(file) {
  checkImageFile(file);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image couldn't be read. Try a PNG or JPEG file.");
  }
  try {
    const { width, height } = bitmap;
    if (!(width > 0 && height > 0)) throw new Error("The image is empty.");
    if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE) throw new Error(`The image is too large. Use an image at most ${MAX_SOURCE_SIDE} pixels on each side.`);
    const scale = Math.min(1, WORK_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { pixels: data.data, width: w, height: h, sourceWidth: width, sourceHeight: height };
  } finally {
    bitmap.close?.();
  }
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
