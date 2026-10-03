// Built-in icon library. Original house artwork (no third-party icons), authored as polygon
// contours in a 0-100 box with +Y up. An icon is the union of its `contours` minus its `holes`;
// both are filled with the positive winding rule after normalizing each contour to
// counter-clockwise, so authoring direction never matters and holes never depend on winding.
// `pieces` is how many separate printed pieces the icon is meant to be (1 = one connected relief).
// Every icon is checked by tests at 28 mm: no positive feature and no gap thinner than 0.8 mm.

const TAU = 2 * Math.PI;

function signedArea2(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}
/** Counter-clockwise copy of a contour (Manifold's positive fill rule needs CCW outers). */
export const positiveContour = points => (signedArea2(points) < 0 ? [...points].reverse() : [...points]);

const ellipse = (cx, cy, rx, ry, n = 72) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((i / n) * TAU), cy + ry * Math.sin((i / n) * TAU)]);
const circle = (cx, cy, r, n = 48) => ellipse(cx, cy, r, r, n);
const arc = (cx, cy, r, from, to, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});
function roundedRect(x0, y0, x1, y1, r, n = 8) {
  const pts = [];
  const corners = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
  for (const [cx, cy, start] of corners) pts.push(...arc(cx, cy, r, start, start + 90, n));
  return pts;
}
const cubic = (p0, p1, p2, p3, n = 16) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
});
const mirrorX = pts => pts.map(([x, y]) => [100 - x, y]).reverse();

// Toilet, seen from the front and a little above: cistern with a lid and a flush button, the
// seat as a ring around the bowl opening, the bowl tapering to a flared foot. A shallow groove
// under the front of the seat separates seat from bowl without splitting the piece.
function toilet() {
  const bowlLeft = cubic([8, 52], [8, 34], [26, 26], [34, 18]);
  const bowl = [...bowlLeft, ...mirrorX(bowlLeft)];
  const foot = [[36, 20], [64, 20], [62, 10], [72, 6], [72, 1], [28, 1], [28, 6], [38, 10]];
  const rimGroove = (() => {
    // The band between the seat's lower edge and a slightly larger ellipse, front part only.
    const outer = arc(50, 52, 45.5, 220, 320, 40).map(([x, y]) => [x, 52 + (y - 52) * (19 / 45.5)]);
    const inner = arc(50, 52, 42, 320, 220, 40).map(([x, y]) => [x, 52 + (y - 52) * (14 / 42)]);
    return [...outer, ...inner];
  })();
  return {
    label: "Toilet",
    pieces: 1,
    contours: [
      roundedRect(26, 62, 74, 92, 4),     // cistern
      roundedRect(21, 89, 79, 99, 3),     // cistern lid
      ellipse(50, 52, 42, 14),            // seat
      bowl,
      foot
    ],
    holes: [
      circle(50, 79, 5),                  // flush button
      ellipse(50, 53, 29, 7.5),           // bowl opening inside the seat ring
      rimGroove
    ]
  };
}

// Classic parametric heart, with the bottom tip rounded slightly so it prints.
function heart() {
  const pts = Array.from({ length: 96 }, (_, i) => {
    const t = (i / 96) * TAU;
    return [50 + 3.0 * 16 * Math.sin(t) ** 3, 52 + 3.0 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  });
  return { label: "Heart", pieces: 1, contours: [pts], holes: [] };
}

// House: roof with eaves and a chimney, walls with a door and two windows.
function house() {
  return {
    label: "House",
    pieces: 1,
    contours: [
      [[3, 50], [50, 96], [97, 50]],                   // roof with eaves
      [[16, 2], [84, 2], [84, 56], [16, 56]],          // walls
      [[64, 70], [77, 70], [77, 92], [64, 92]]         // chimney
    ],
    holes: [
      roundedRect(41, 2.5, 59, 32, 2).map(([x, y]) => [x, y < 3 ? -1 : y]),   // door, open at the bottom
      roundedRect(23, 30, 35, 42, 1.5),                // windows
      roundedRect(65, 30, 77, 42, 1.5)
    ]
  };
}

// Mug: a rounded body and a C-shaped handle, with two wisps of steam above (separate pieces).
function mug() {
  const handle = [...arc(66, 44, 21, -100, 100, 32), ...arc(66, 44, 11.5, 100, -100, 32)];
  const wisp = x0 => {
    const left = cubic([x0, 82], [x0 - 6, 88], [x0 + 6, 94], [x0, 100], 12);
    return [...left, ...left.slice().reverse().map(([x, y]) => [x + 5, y])];
  };
  return {
    label: "Mug",
    pieces: 3,
    contours: [
      roundedRect(8, 4, 66, 74, 7),
      handle,
      wisp(24),
      wisp(44)
    ],
    holes: []
  };
}

export const ICONS = Object.freeze({ toilet: toilet(), heart: heart(), house: house(), mug: mug() });

/**
 * The icon as a CrossSection scaled so its long side is 100 units and centered on the origin.
 * Unknown ids are an error (never an inherited property such as "toString").
 */
export function iconCrossSection(CrossSection, id) {
  if (!Object.hasOwn(ICONS, id)) throw new Error("Unknown icon. Choose one of the built-in icons or your own image.");
  const icon = ICONS[id];
  const temps = [];
  const t = o => { temps.push(o); return o; };
  try {
    let cs = t(CrossSection.ofPolygons(icon.contours.filter(c => c.length >= 3).map(positiveContour), "Positive"));
    if (icon.holes.length) cs = t(cs.subtract(t(CrossSection.ofPolygons(icon.holes.map(positiveContour), "Positive"))));
    const b = cs.bounds();
    const s = 100 / Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
    const scaled = t(cs.scale([s, s]));
    const sb = scaled.bounds();
    return scaled.translate([-(sb.min[0] + sb.max[0]) / 2, -(sb.min[1] + sb.max[1]) / 2]);
  } finally {
    for (const o of temps) o.delete();
  }
}
