// Lightweight geometry-font support. The built-in font is intentionally
// algorithmic (5x7 cells) so the app ships no font binaries. Users can also
// load their own TTF/OTF/WOFF file locally; opentype.js turns it into outlines
// in the browser without uploading it.

const GLYPHS = {
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],
  'J':['00111','00010','00010','00010','10010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','10101','10011','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','10101','01010'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  ':':['00000','00110','00110','00000','00110','00110','00000'],
  '/':['00001','00010','00010','00100','01000','01000','10000'],
  '#':['01010','11111','01010','01010','11111','01010','01010'],
  '&':['01100','10010','10100','01000','10101','10010','01101'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '?':['01110','10001','00001','00010','00100','00000','00100'],
  '!':['00100','00100','00100','00100','00100','00000','00100'],
  // Glyphs fill the whole 7-row cell (row 6 is the baseline row), so the comma's tail uses
  // the bottom row, stepping left of the dot; the apostrophe mirrors it at the top.
  ',':['00000','00000','00000','00000','00110','00110','01100'],
  "'":['00110','00110','01100','00000','00000','00000','00000'],
  ' ':[ '00000','00000','00000','00000','00000','00000','00000']
};

// Typographic variants drawn with an existing glyph.
const ALIASES = { '’': "'", '‘': "'", '–': '-', '—': '-' };
const glyphKey = ch => ALIASES[ch] ?? ch;

/** Characters (after upper-casing) the built-in block font cannot draw; they render as '?'. */
export function unsupportedBlockChars(text) {
  const missing = new Set();
  for (const ch of String(text || '').toUpperCase()) {
    if (ch === '\n' || ch === '\r') continue;
    if (!GLYPHS[glyphKey(ch)]) missing.add(ch);
  }
  return [...missing];
}

export const BLOCK_SUBSTITUTION_WARNING = "Some characters aren't available in the built-in font and were replaced with '?'.";

function rect(x0, y0, x1, y1) {
  return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
}

export function blockText(CrossSection, text) {
  const upper = String(text || '').toUpperCase();
  const polygons = [];
  const cell = 1;
  const gap = 0.16;
  const advance = 6;
  let x = 0;
  for (const ch of upper) {
    const rows = GLYPHS[glyphKey(ch)] || GLYPHS['?'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (rows[row][col] !== '1') continue;
        const x0 = x + col * cell;
        const y0 = -(row + 1) * cell;
        polygons.push(rect(x0 - gap/2, y0 - gap/2, x0 + cell + gap/2, y0 + cell + gap/2));
      }
    }
    x += advance;
  }
  if (!polygons.length) return CrossSection.union([]);
  const cs = CrossSection.ofPolygons(polygons);
  const b = cs.bounds();
  const centered = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]);
  cs.delete?.();
  return centered;
}

function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return [u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]];
}
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
    u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
  ];
}

function flattenOpenTypePath(path, curveSteps = 10) {
  const contours = [];
  let contour = [];
  let current = [0,0];
  let start = [0,0];
  const push = (p) => {
    const q = [p[0], -p[1]]; // OpenType's vertical axis to model XY.
    const last = contour[contour.length - 1];
    if (!last || Math.hypot(q[0]-last[0], q[1]-last[1]) > 1e-6) contour.push(q);
  };
  const close = () => {
    if (contour.length >= 3) contours.push(contour);
    contour = [];
  };
  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      close(); current = [cmd.x, cmd.y]; start = current; push(current);
    } else if (cmd.type === 'L') {
      current = [cmd.x, cmd.y]; push(current);
    } else if (cmd.type === 'Q') {
      const p0 = current, p1 = [cmd.x1, cmd.y1], p2 = [cmd.x, cmd.y];
      for (let i=1;i<=curveSteps;i++) push(quad(p0,p1,p2,i/curveSteps));
      current = p2;
    } else if (cmd.type === 'C') {
      const p0=current, p1=[cmd.x1,cmd.y1], p2=[cmd.x2,cmd.y2], p3=[cmd.x,cmd.y];
      for (let i=1;i<=curveSteps;i++) push(cubic(p0,p1,p2,p3,i/curveSteps));
      current = p3;
    } else if (cmd.type === 'Z') {
      push(start); close(); current = start;
    }
  }
  close();
  return contours;
}

// opentype.js throws on GSUB lookup types it doesn't implement, which many
// real-world fonts contain. Fall back to plain per-glyph layout with kerning.
function fontTextPath(font, text) {
  const size = 1000;
  try {
    return font.getPath(text, 0, 0, size, { kerning: true, features: { liga: true } });
  } catch {
    const scale = size / font.unitsPerEm;
    const glyphs = Array.from(text, ch => font.charToGlyph(ch));
    return glyphsPath(font, glyphs, scale, size);
  }
}

function glyphsPath(font, glyphs, scale, size) {
  const commands = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    commands.push(...g.getPath(x, 0, size).commands);
    x += (g.advanceWidth || 0) * scale;
    if (glyphs[i + 1]) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  return { commands };
}

export function fontText(CrossSection, font, text) {
  if (!font) throw new Error('Choose a local font file first.');
  const path = fontTextPath(font, String(text || ''));
  const contours = flattenOpenTypePath(path, 12);
  if (!contours.length) return CrossSection.union([]);
  const cs = CrossSection.ofPolygons(contours, 'EvenOdd');
  const b = cs.bounds();
  const centered = cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]);
  cs.delete?.();
  return centered;
}

export function fitCrossSection(cs, { maxWidth, maxHeight, centerX = 0, centerY = 0 }) {
  if (cs.isEmpty()) return cs;
  const b = cs.bounds();
  const w = b.max[0] - b.min[0];
  const h = b.max[1] - b.min[1];
  if (!(w > 0 && h > 0)) throw new Error('Text geometry has invalid bounds.');
  const scale = Math.min(maxWidth / w, maxHeight / h);
  const scaled = cs.scale([scale, scale]);
  const sb = scaled.bounds();
  const placed = scaled.translate([centerX - (sb.min[0]+sb.max[0])/2, centerY - (sb.min[1]+sb.max[1])/2]);
  scaled.delete?.();
  return placed;
}
