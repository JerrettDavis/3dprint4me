// The display sign's decoration shapes, each drawn centred on the origin to fill a w × h box (mm)
// as a Manifold CrossSection. Outlines take a stroke thickness; rounded ones a corner radius. The
// contact icons are simple original line drawings sized from their box, never thinner than the
// nozzle prints (the stroke is at least MIN_STROKE). `t` registers temporaries; the result is
// registered too, so the caller copies it if it must outlive the build.
import { roundedRect, star } from "../../framework/shapes.js";

export const MIN_STROKE = 0.8;
const SEGMENTS = 64;
const TAU = Math.PI * 2;

const ellipsePoints = (rx, ry, from = 0, to = TAU, n = SEGMENTS) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [rx * Math.cos(a), ry * Math.sin(a)]; });

function ellipse(CrossSection, w, h) {
  return CrossSection.ofPolygons([ellipsePoints(w / 2, h / 2).slice(0, -1)]);
}

function ellipseRing(CrossSection, w, h, stroke, t) {
  const inner = Math.max(0.01, 2 * stroke);
  const outer = t(ellipse(CrossSection, w, h));
  if (w - inner <= 0 || h - inner <= 0) return outer;
  return t(outer.subtract(t(ellipse(CrossSection, w - inner, h - inner))));
}

// An open ring from `rot` degrees counter-clockwise from +x, `sweep` degrees long, with round ends.
function arc(CrossSection, w, h, stroke, rot, sweep, t) {
  const a0 = (rot * Math.PI) / 180, a1 = a0 + (sweep * Math.PI) / 180;
  const n = Math.max(8, Math.round((SEGMENTS * sweep) / 360));
  const outer = ellipsePoints(w / 2, h / 2, a0, a1, n);
  const inner = ellipsePoints(Math.max(0.01, w / 2 - stroke), Math.max(0.01, h / 2 - stroke), a0, a1, n).reverse();
  const band = t(CrossSection.ofPolygons([[...outer, ...inner]], "NonZero"));
  const mid = [w / 2 - stroke / 2, h / 2 - stroke / 2];
  const caps = [a0, a1].map(a => t(t(CrossSection.circle(stroke / 2, 24)).translate([mid[0] * Math.cos(a), mid[1] * Math.sin(a)])));
  return t(CrossSection.union([band, ...caps]));
}

function heart(CrossSection, w, h) {
  const n = 96;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    return [16 * Math.sin(a) ** 3, 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)];
  });
  return fitPoints(CrossSection, pts, w, h);
}

const fitPoints = (CrossSection, pts, w, h) => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = w / (x1 - x0), sy = h / (y1 - y0);
  return CrossSection.ofPolygons([pts.map(([x, y]) => [(x - (x0 + x1) / 2) * sx, (y - (y0 + y1) / 2) * sy])], "NonZero");
};

const bar = (CrossSection, x0, y0, x1, y1, thick) => {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1e-6;
  const nx = (-dy / len) * thick / 2, ny = (dx / len) * thick / 2;
  return CrossSection.ofPolygons([[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]], "NonZero");
};

function mail(CrossSection, w, h, t) {
  const s = Math.max(MIN_STROKE, 0.13 * Math.min(w, h));
  const outer = t(roundedRect(CrossSection, w, h, Math.min(1, h / 6)));
  const inner = t(roundedRect(CrossSection, Math.max(0.1, w - 2 * s), Math.max(0.1, h - 2 * s), 0.01));
  const flap = [t(bar(CrossSection, -w / 2 + s / 2, h / 2 - s / 2, 0, -h * 0.08, s)), t(bar(CrossSection, w / 2 - s / 2, h / 2 - s / 2, 0, -h * 0.08, s))];
  return t(CrossSection.union([t(outer.subtract(inner)), ...flap.map(f => t(f.intersect(outer)))]));
}

function globe(CrossSection, w, h, t) {
  const s = Math.max(MIN_STROKE, 0.1 * Math.min(w, h));
  const ring = ellipseRing(CrossSection, w, h, s, t);
  const equator = t(bar(CrossSection, -w / 2, 0, w / 2, 0, s));
  const meridian = ellipseRing(CrossSection, w * 0.5, h, s, t);
  return t(CrossSection.union([ring, t(equator.intersect(t(ellipse(CrossSection, w, h)))), t(meridian.intersect(t(ellipse(CrossSection, w, h))))]));
}

function pin(CrossSection, w, h, t) {
  const r = w / 2, cy = h / 2 - r;
  const head = t(t(CrossSection.circle(r, 48)).translate([0, cy]));
  const tip = t(CrossSection.ofPolygons([[[-r * 0.92, cy - r * 0.35], [r * 0.92, cy - r * 0.35], [0, -h / 2]]], "NonZero"));
  const body = t(CrossSection.union([head, tip]));
  const hole = t(t(CrossSection.circle(Math.max(r * 0.4, MIN_STROKE), 32)).translate([0, cy]));
  return t(body.subtract(hole));
}

function phone(CrossSection, w, h, t) {
  const s = Math.max(MIN_STROKE, 0.12 * Math.min(w, h));
  const outer = t(roundedRect(CrossSection, w, h, Math.min(w, h) * 0.2));
  const screen = t(roundedRect(CrossSection, Math.max(0.1, w - 2 * s), Math.max(0.1, h - 3.4 * s), 0.01));
  const screenUp = t(screen.translate([0, s * 0.3]));
  const dot = t(t(CrossSection.circle(Math.max(s * 0.45, 0.4), 16)).translate([0, -h / 2 + s * 0.95]));
  return t(CrossSection.union([t(outer.subtract(screenUp)), dot]));
}

/**
 * The shape for one slot: `kind` is a DECO_KINDS value; `o` carries { w, h, stroke, radius, sweep, rot }.
 * Returns a CrossSection centred on the origin (not rotated, except the arc, which orients itself).
 */
export function decoShape(CrossSection, kind, o, t) {
  const { w, h, stroke, radius, sweep, rot } = o;
  switch (kind) {
    case "frame": {
      const outer = t(roundedRect(CrossSection, w, h, radius));
      const iw = w - 2 * stroke, ih = h - 2 * stroke;
      if (iw <= 0.1 || ih <= 0.1) return outer;
      return t(outer.subtract(t(roundedRect(CrossSection, iw, ih, Math.max(0, radius - stroke)))));
    }
    case "plate": return t(roundedRect(CrossSection, w, h, radius));
    case "ring": return ellipseRing(CrossSection, w, h, stroke, t);
    case "disc": return t(ellipse(CrossSection, w, h));
    case "arc": return arc(CrossSection, w, h, stroke, rot, sweep, t);
    case "line": return t(roundedRect(CrossSection, w, stroke, stroke / 2));
    case "heart": return t(heart(CrossSection, w, h));
    case "star": {
      const s = t(star(CrossSection, 50, 5, 0.42));
      const b = s.bounds();
      const kx = w / (b.max[0] - b.min[0]), ky = h / (b.max[1] - b.min[1]);
      return t(t(s.scale([kx, ky])).translate([-kx * (b.min[0] + b.max[0]) / 2, -ky * (b.min[1] + b.max[1]) / 2]));
    }
    case "diamond": return t(CrossSection.ofPolygons([[[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]]], "NonZero"));
    case "mail": return mail(CrossSection, w, h, t);
    case "globe": return globe(CrossSection, w, h, t);
    case "pin": return pin(CrossSection, w, h, t);
    case "phone": return phone(CrossSection, w, h, t);
    default: throw new Error(`Unknown shape "${String(kind).slice(0, 20)}".`);
  }
}
