// Customer image tracing. Pure and isomorphic: the page decodes the image onto a bounded canvas
// in the browser and passes the RGBA pixels here; only the resulting contours (plain arrays)
// go to the build worker. The image itself never leaves the browser.
//
// Method: box-downsample to at most `maxCells` cells on the long edge, threshold luminance
// (transparent pixels count as white), drop isolated single-cell specks and pinholes, then emit
// one rectangle per run of dark cells (runs repeated on the next rows are merged into one
// taller rectangle). imageCrossSection unions the rectangles and rounds the staircase a little.
// This is a silhouette tracer: a photograph comes out posterized (one flat shape), so the
// threshold and invert controls are how a customer picks what becomes the raised outline.

export const MAX_SOURCE_SIDE = 4096;
export const MAX_SOURCE_PIXELS = MAX_SOURCE_SIDE * MAX_SOURCE_SIDE;
export const MAX_CONTOUR_POINTS = 200_000;
const MAX_COORD = 1e5;
const MOSTLY_DARK = 0.98;

const isInt = v => Number.isInteger(v);

export function traceImage({ pixels, width, height, threshold = 128, invert = false, maxCells = 96 } = {}) {
  if (!(width > 0 && height > 0) || !pixels || pixels.length === 0) throw new Error("The image is empty.");
  if (!isInt(width) || !isInt(height)) throw new Error("The image data is malformed.");
  if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error(`The image is too large. Use an image at most ${MAX_SOURCE_SIDE} pixels on each side.`);
  }
  if (!(pixels instanceof Uint8ClampedArray || pixels instanceof Uint8Array)) throw new Error("The image data is malformed.");
  if (pixels.length !== width * height * 4) throw new Error("The image data is malformed: its length doesn't match its size.");
  if (!isInt(threshold) || threshold < 0 || threshold > 255) throw new Error("The threshold must be a whole number from 0 to 255.");
  if (!isInt(maxCells) || maxCells < 8 || maxCells > 256) throw new Error("The trace resolution must be 8–256 cells.");

  // Box-downsample to cw × ch cells; each cell averages its source pixels' luminance.
  const scale = Math.min(1, maxCells / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale)), ch = Math.max(1, Math.round(height * scale));
  const dark = new Uint8Array(cw * ch);
  let darkCount = 0;
  for (let cy = 0; cy < ch; cy++) {
    const y0 = Math.floor((cy * height) / ch), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / ch));
    for (let cx = 0; cx < cw; cx++) {
      const x0 = Math.floor((cx * width) / cw), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cw));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4, a = pixels[i + 3] / 255;
        sum += (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) * a + 255 * (1 - a);
        n++;
      }
      const lum = sum / n;
      const on = invert ? lum >= threshold : lum < threshold;
      if (on) { dark[cy * cw + cx] = 1; darkCount++; }
    }
  }
  if (darkCount > MOSTLY_DARK * cw * ch) {
    throw new Error("Almost the whole image traces as one solid block, so there's no outline. Lower the threshold, or turn on Invert.");
  }

  // Smoothing: clear dark cells with no dark 4-neighbour; fill light cells enclosed on all 4 sides.
  const at = (x, y) => (x >= 0 && y >= 0 && x < cw && y < ch ? dark[y * cw + x] : 0);
  const smooth = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const nb = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1);
    smooth[y * cw + x] = dark[y * cw + x] ? (nb > 0 ? 1 : 0) : (nb === 4 ? 1 : 0);
  }

  const contours = maskToContours(smooth, cw, ch);
  if (!contours.length) {
    throw new Error("There is nothing to trace: no part of the image is darker than the threshold. Raise the threshold, turn on Invert, or choose an image with a dark subject.");
  }
  return contours;
}

// Run-length rectangles; a run repeated on consecutive rows grows one rectangle downwards.
// Y is flipped so the image is upright (+Y up).
function maskToContours(mask, cw, ch) {
  const contours = [];
  let open = new Map(); // "start,end" -> rectangle [x0, x1, yTop, yBottom]
  const close = r => contours.push([[r[0], r[3]], [r[1], r[3]], [r[1], r[2]], [r[0], r[2]]]);
  for (let y = 0; y < ch; y++) {
    const next = new Map();
    let x = 0;
    while (x < cw) {
      if (!mask[y * cw + x]) { x++; continue; }
      const start = x;
      while (x < cw && mask[y * cw + x]) x++;
      const key = `${start},${x}`;
      const rect = open.get(key) ?? [start, x, ch - y, ch - y];
      open.delete(key);
      rect[3] = ch - y - 1;
      next.set(key, rect);
    }
    for (const r of open.values()) close(r);
    open = next;
  }
  for (const r of open.values()) close(r);
  return contours;
}

// ---- Multi-color tracing ---------------------------------------------------------------
// A logo with several inks: the background is the dominant color along the image's border (or
// transparent); every other cell snaps to the nearest color of `palette` (hex strings), and each
// palette color gets its own contours in one shared cell grid, so the layers register exactly.
// Returns [{ index, contours }] for the palette entries that have ink, in palette order.
const hexRgb = hex => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex)); if (!m) throw new Error("The palette holds an invalid color."); const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// "Redmean" distance: close to perceived difference without a color-space conversion.
const colorDistance = (a, b) => { const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db); };
const BACKGROUND_DISTANCE = 90;   // a cell this close to the background color is background

export function traceLayers({ pixels, width, height, palette, maxCells = 200 } = {}) {
  if (!(width > 0 && height > 0) || !pixels || pixels.length === 0) throw new Error("The image is empty.");
  if (!isInt(width) || !isInt(height)) throw new Error("The image data is malformed.");
  if (width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE || width * height > MAX_SOURCE_PIXELS) {
    throw new Error(`The image is too large. Use an image at most ${MAX_SOURCE_SIDE} pixels on each side.`);
  }
  if (!(pixels instanceof Uint8ClampedArray || pixels instanceof Uint8Array)) throw new Error("The image data is malformed.");
  if (pixels.length !== width * height * 4) throw new Error("The image data is malformed: its length doesn't match its size.");
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 8) throw new Error("The logo palette must hold 1–8 colors.");
  if (!isInt(maxCells) || maxCells < 8 || maxCells > 256) throw new Error("The trace resolution must be 8–256 cells.");
  const inks = palette.map(hexRgb);

  const scale = Math.min(1, maxCells / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale)), ch = Math.max(1, Math.round(height * scale));
  const rgb = new Float32Array(cw * ch * 3), opaque = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    const y0 = Math.floor((cy * height) / ch), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / ch));
    for (let cx = 0; cx < cw; cx++) {
      const x0 = Math.floor((cx * width) / cw), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4, al = pixels[i + 3] / 255;
        r += pixels[i] * al; g += pixels[i + 1] * al; b += pixels[i + 2] * al; a += al; n++;
      }
      const k = cy * cw + cx;
      if (a / n >= 0.5) { opaque[k] = 1; rgb[k * 3] = r / a; rgb[k * 3 + 1] = g / a; rgb[k * 3 + 2] = b / a; }
    }
  }
  // Background: the most common (4 bits per channel) color on the border, unless the border is mostly transparent.
  const votes = new Map();
  let borderCells = 0, borderOpaque = 0;
  const vote = (cx, cy) => {
    const k = cy * cw + cx;
    borderCells++;
    if (!opaque[k]) return;
    borderOpaque++;
    const key = ((rgb[k * 3] >> 4) << 8) | ((rgb[k * 3 + 1] >> 4) << 4) | (rgb[k * 3 + 2] >> 4);
    votes.set(key, (votes.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < cw; x++) { vote(x, 0); if (ch > 1) vote(x, ch - 1); }
  for (let y = 1; y < ch - 1; y++) { vote(0, y); if (cw > 1) vote(cw - 1, y); }
  let background = null;
  if (borderOpaque > 0.5 * borderCells) {
    const [key] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    background = [((key >> 8) & 15) * 16 + 8, ((key >> 4) & 15) * 16 + 8, (key & 15) * 16 + 8];
  }
  const masks = inks.map(() => new Uint8Array(cw * ch));
  const counts = inks.map(() => 0);
  for (let k = 0; k < cw * ch; k++) {
    if (!opaque[k]) continue;
    const c = [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]];
    if (background && colorDistance(c, background) < BACKGROUND_DISTANCE) continue;
    let best = 0, bestD = Infinity;
    inks.forEach((ink, i) => { const d = colorDistance(c, ink); if (d < bestD) { bestD = d; best = i; } });
    masks[best][k] = 1; counts[best]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) throw new Error("There is nothing to trace: every part of the image matches its background. Choose an image with a clearly different subject.");
  if (total > MOSTLY_DARK * cw * ch) throw new Error("Almost the whole image counts as ink, so there is no background to leave out. Use an image with a plain or transparent background.");
  const at = (m, x, y) => (x >= 0 && y >= 0 && x < cw && y < ch ? m[y * cw + x] : 0);
  const layers = [];
  masks.forEach((mask, index) => {
    if (!counts[index]) return;
    const smooth = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const nb = at(mask, x - 1, y) + at(mask, x + 1, y) + at(mask, x, y - 1) + at(mask, x, y + 1);
      smooth[y * cw + x] = mask[y * cw + x] ? (nb > 0 ? 1 : 0) : (nb === 4 ? 1 : 0);
    }
    const contours = maskToContours(smooth, cw, ch);
    if (contours.length) layers.push({ index, contours });
  });
  if (!layers.length) throw new Error("There is nothing to trace in this image.");
  return layers;
}

/** Throws a readable error unless `contours` is bounded, well-formed traced data. */
export function checkContours(contours) {
  const malformed = () => new Error("The traced image outline is malformed. Choose the image again.");
  if (!Array.isArray(contours) || !contours.length) throw malformed();
  let points = 0;
  for (const c of contours) {
    if (!Array.isArray(c) || c.length < 3) throw malformed();
    points += c.length;
    if (points > MAX_CONTOUR_POINTS) throw new Error("The traced image is too detailed. Choose a simpler image or adjust the threshold.");
    for (const p of c) {
      if (!Array.isArray(p) || p.length !== 2) throw malformed();
      const [x, y] = p;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) throw malformed();
    }
  }
  return contours;
}

const signedArea2 = pts => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return a;
};

/** Unions traced contours (in cell units) into one CrossSection with lightly rounded corners. */
export function imageCrossSection(CrossSection, contours) {
  checkContours(contours);
  const temps = [];
  const t = o => { temps.push(o); return o; };
  try {
    const ccw = contours.map(c => (signedArea2(c) < 0 ? [...c].reverse() : c));
    const raw = t(CrossSection.ofPolygons(ccw, "Positive"));
    // Close seams between touching rectangles, then round the pixel staircase slightly.
    const merged = t(t(raw.offset(0.05, "Miter", 2)).offset(-0.05, "Miter", 2));
    const rounded = t(t(merged.offset(-0.3, "Round", 2, 16)).offset(0.3, "Round", 2, 16));
    return rounded.simplify(0.02);
  } finally {
    for (const o of temps) o.delete();
  }
}
