// Route-shield template contours are kept in their original authored order so
// the SVG preview remains stable. Manifold's positive winding fill rule,
// however, requires exterior contours to be counter-clockwise. Call
// positiveContour() before passing any of these outlines to CrossSection.ofPolygons().

export const OUTER = [[-19.071,-27.23],[-19.071,-18.843],[-21.089,-17.207],[-23.208,-14.561],[-24.567,-11.678],[-25.17,-9.152],[-25.297,-6.558],[-24.801,-3.173],[-24.04,-0.814],[-21.261,5.28],[-20.703,8.563],[-20.871,10.376],[-21.515,12.541],[-22.974,15.505],[-24.582,17.942],[-15.274,27.34],[-11.328,25.58],[-7.997,25.145],[-5.002,25.417],[-3.247,25.919],[-0.001,27.815],[3.246,25.919],[6.941,25.175],[11.328,25.58],[15.274,27.34],[24.581,17.942],[21.732,13.073],[20.991,10.916],[20.703,8.564],[21.395,4.906],[23.943,-0.574],[24.728,-2.892],[25.257,-5.95],[25.169,-9.152],[24.347,-12.282],[22.862,-15.093],[20.86,-17.426],[17.976,-19.501],[17.898,-27.522],[17.391,-27.815],[-18.486,-27.815]];
export const UPPER = [[-18.759,13.206],[-19.53,15.029],[-20.958,17.602],[-14.759,23.859],[-11.463,22.716],[-7.997,22.33],[-5.64,22.466],[-3.902,22.778],[-1.616,23.549],[-0.001,24.4],[1.614,23.549],[3.33,22.928],[6.816,22.363],[10.605,22.547],[12.309,22.932],[14.758,23.859],[20.958,17.602],[18.884,13.542],[18.057,10.629],[-18.058,10.629]];
export const LOWER = [[-18.083,-16.093],[-19.599,-14.698],[-21.335,-12.144],[-22.075,-10.218],[-22.497,-7.164],[-22.337,-5.189],[-21.901,-3.227],[-18.563,4.475],[-18.013,6.787],[-17.891,8.619],[17.89,8.619],[18.066,6.438],[18.598,4.369],[21.8,-2.902],[22.319,-5.077],[22.496,-7.164],[22.075,-10.218],[21.334,-12.144],[19.599,-14.698],[17.666,-16.396],[15.867,-17.403],[13.92,-18.052],[7.457,-18.819],[3.874,-19.56],[1.686,-20.407],[-0.001,-21.408],[-2.215,-20.162],[-4.785,-19.316],[-14.418,-17.924],[-16.335,-17.183]];

export function signedArea2(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return twiceArea;
}

export function positiveContour(points) {
  return signedArea2(points) < 0 ? [...points].reverse() : [...points];
}

// Interpolate the authored curves, retaining explicit corners and straight
// runs. Chord-weighted Hermite tangents stay continuous across unequal spans.
function smoothContour(points, corners) {
  const sharp = new Set(corners);
  const sub = (a, b) => a.map((v, j) => v - b[j]);
  const length = v => Math.hypot(...v);
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    const a = points[i], b = points[next];
    const before = sub(a, points[(i + points.length - 1) % points.length]);
    const span = sub(b, a), after = sub(points[(i + 2) % points.length], b);
    const d = length(span);
    const tangent = (u, v) => u.map((x, j) => (x / length(u) + v[j] / length(v)) * d / 2);
    const m0 = sharp.has(i) ? span : tangent(before, span);
    const m1 = sharp.has(next) ? span : tangent(span, after);
    const steps = sharp.has(i) && sharp.has(next) ? 1 : Math.max(4, Math.ceil(d / 0.25));
    for (let k = 0; k < steps; k++) {
      if (k === 0) { result.push([...a]); continue; }
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      result.push(a.map((x, j) => (2*t3-3*t2+1)*x + (t3-2*t2+t)*m0[j] + (-2*t3+3*t2)*b[j] + (t3-t2)*m1[j]));
    }
  }
  points.splice(0, points.length, ...result);
}

smoothContour(OUTER, [0, 1, 14, 15, 20, 24, 25, 37, 38, 39, 40]);
smoothContour(UPPER, [2, 3, 9, 15, 16, 18, 19]);
smoothContour(LOWER, [9, 10, 25]);
