import { reliefSolid } from "./relief.js";

export const HEAD_COLUMNS = 192, HEAD_ROWS = 176;

export function headRadius(y, o) {
  const center = -0.07, lower = y < center;
  const v = (y - center) / (lower ? 0.43 : 0.57);
  const exponent = lower ? 3 - 0.4 * Math.abs(v) ** 6 : 2.2;
  const chin = lower ? o.chin_fullness_pct / 100 : 1;
  return Math.max(lower ? 0.05 : 0.00005, Math.min(0.5, 0.5 * Math.max(0, 1 - v * v) ** (1 / exponent) * chin));
}

export function eyeDimensions(o, side) {
  const size = o.eye_size_pct / 100;
  return { x: side * o.head_width_mm * 0.247, y: -o.head_height_mm * 0.028, rx: o.head_width_mm * 0.17 * size, ry: o.head_height_mm * 0.215 * size, angle: side * -7 };
}

export function noseDimensions(o, side) {
  return { x: side * o.head_width_mm * 0.065, y: -o.head_height_mm * 0.195, rx: o.head_width_mm * 0.014, ry: o.head_height_mm * 0.029, angle: side * 25 };
}
export function grinHeight(x, o) {
  const smile = 0.47 * o.smile_width_pct / 100;
  return -0.355 + 0.22 * (x / smile) ** 2;
}
export function headHeight(x, y, o) {
  const radius = headRadius(y, o);
  const horizontal = Math.max(0, 1 - (x / radius) ** 2) ** 0.52;
  const vertical = Math.max(0, 1 - ((y + 0.1) / 0.6) ** 2) ** 0.42;
  let height = horizontal * vertical;
  const underside = Math.max(0, Math.min(1, (-0.47 - y) / 0.03));
  height *= 1 - 0.38 * underside * underside * (3 - 2 * underside);
  for (const side of [-1, 1]) {
    const e = eyeDimensions(o, side), angle = e.angle * Math.PI / 180;
    const dx = x * o.head_width_mm - e.x, dy = y * o.head_height_mm - e.y;
    const u = (dx * Math.cos(angle) + dy * Math.sin(angle)) / e.rx;
    const v = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / e.ry;
    const r2 = u * u + v * v;
    if (r2 > 1 && r2 < 1.4) height += 0.022 * Math.sin(Math.PI * (Math.sqrt(r2) - 1) / (Math.sqrt(1.4) - 1)) ** 2;
    if (r2 < 1) height -= o.eye_recess_pct / 100 * (1 - r2) ** 0.65;
    const nose = noseDimensions(o, side), rotation = nose.angle * Math.PI / 180;
    const nx = x * o.head_width_mm - nose.x, ny = y * o.head_height_mm - nose.y;
    const nu = (nx * Math.cos(rotation) + ny * Math.sin(rotation)) / nose.rx;
    const nv = (-nx * Math.sin(rotation) + ny * Math.cos(rotation)) / nose.ry;
    const nr2 = nu * nu + nv * nv;
    if (nr2 < 1) height -= 0.075 * (1 - nr2) ** 0.45;
  }
  if (y > -0.217 && y < -0.135) {
    const width = 0.016 * (-0.135 - y) / 0.082;
    if (Math.abs(x) < width) height -= 0.09;
  }
  const smile = 0.47 * o.smile_width_pct / 100;
  if (Math.abs(x) < smile) {
    const grin = grinHeight(x, o);
    if (y < grin && y > grin - 0.075) {
      const spacing = 2 * smile / o.tooth_count;
      const index = Math.min(o.tooth_count - 1, Math.floor((x + smile) / spacing));
      const toothX = -smile + (index + 0.5) * spacing;
      const variation = 1 + 0.045 * Math.cos(index * 2.4);
      const u = (x - toothX) / (spacing * 0.44), v = (y - grin + 0.0375) / (0.035 * variation);
      const crown = Math.max(0, 1 - u ** 4 - v ** 4) ** 0.55;
      height -= 0.105 - 0.098 * crown;
    }
  }
  return Math.max(0, Math.min(1, height));
}

export function headSolid(s, o) {
  const base = Math.min(2.4, o.head_depth_mm * 0.3);
  return reliefSolid(s, {
    width: o.head_width_mm, height: o.head_height_mm, columns: HEAD_COLUMNS, rows: HEAD_ROWS,
    bounds: y => { const radius = headRadius(y, o); return [-radius, radius]; },
    surface: (x, y) => base + headHeight(x, y, o) * (o.head_depth_mm - base)
  });
}

