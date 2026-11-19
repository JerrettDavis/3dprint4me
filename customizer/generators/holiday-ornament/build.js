import { roundedRect, star } from "../../framework/shapes.js";
import { fontTextLines, FONT_CHARS_SKIPPED } from "../../framework/text.js";
import { FONT_NOT_LOADED } from "../../../public/assets/js/customize/fonts.js";

// All illustrated coordinates are laid out on the 80 mm master; the ribbon hole and
// plate/relief heights stay fixed when the illustration is resized.
const BASE = 2.8;
const RELIEF = 0.8;
const PHOTO_DEPTH = 3.2;
const POCKET_DEPTH = 1.0;
const ENGRAVE_DEPTH = 0.6;

function stencil(section, box, t) {
  const signedArea = path => path.reduce((sum, [x, y], i) => {
    const [nx, ny] = path[(i + 1) % path.length];
    return sum + x * ny - y * nx;
  }, 0);
  const intersections = (path, y) => path.flatMap(([x, py], i) => {
    const [nx, ny] = path[(i + 1) % path.length];
    return (py > y) !== (ny > y) ? [x + (nx - x) * ((y - py) / (ny - py))] : [];
  }).sort((a, b) => a - b);
  return section.decompose().map(component => {
    t(component);
    const paths = component.toPolygons();
    const outer = paths.find(path => signedArea(path) > 0);
    let result = component;
    for (const hole of paths.filter(path => signedArea(path) < 0)) {
      const ys = hole.map(([, y]) => y);
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      const inside = intersections(hole, y);
      const outside = intersections(outer, y);
      const index = inside.reduce((best, x, i) => i % 2 && x - inside[i - 1] > inside[best] - inside[best - 1] ? i : best, 1);
      const left = inside[index - 1], right = inside[index];
      const from = (left + right) / 2;
      const lo = outside.findLast(x => x < left);
      const hi = outside.find(x => x > right);
      const to = left - lo < hi - right ? lo - 0.8 : hi + 0.8;
      result = t(result.subtract(box((from + to) / 2, y, Math.abs(to - from), 1.2)));
    }
    return result;
  });
}

function snowman({ disc, ellipse, box, stroke, contour, poly }) {
  return {
    snow: [ellipse(0, -0.5, 9.5, 8), ellipse(-1, 11.6, 6.2, 6.1)],
    accent: [
      box(-1, 17.4, 15.6, 2.3, -9),
      contour([-5.8, 17.6], [[-5.8, 19.8, -5.8, 22.1, -6.6, 23.4], [-3.6, 24.7, 1.8, 24.1, 3.9, 22.5], [3, 20.5, 3, 18.2, 3, 16.8]]),
      contour([-7.1, 7.5], [[-3.5, 5.8, 1.5, 5.6, 5.4, 7.2], [6.9, 6.5, 6.3, 4.6, 5.2, 4.1], [1, 2.6, -4.5, 3.4, -7, 4.5], [-8.2, 5, -8.1, 6.8, -7.1, 7.5]]),
      contour([3.5, 5.3], [[4, 2, 7.6, 1.5, 10.1, 0.6], [9.4, -0.8, 9, -1.6, 8.7, -2.6], [4, -1.8, 1.2, 0.6, 0.6, 4.6]]),
      stroke([[-8, 0.5], [-12.7, 3], [-16.1, 6.4], [-18.8, 7.7]], 1.65),
      stroke([[-15.3, 5.6], [-15.7, 9.5]], 1.4),
      stroke([[8, 1.8], [12.4, 4.1], [15.4, 8], [17.6, 10.4]], 1.65),
      stroke([[14.7, 7.1], [18.3, 7.7]], 1.4),
      poly([[0.1, 10.8], [0.8, 13.2], [7, 11.6], [1, 10.3]]),
      disc(-3.4, 13.5, 0.83), disc(0.9, 14.1, 0.83),
      stroke([[-3.4, 9.8], [-2, 9.1], [-0.4, 9], [1.2, 9.6]], 1.12),
      disc(-1.4, 1.1, 0.95), disc(-0.7, -2.3, 0.95)
    ]
  };
}

function sledding({ disc, ellipse, stroke, contour, box }) {
  return {
    snow: [
      contour([-29, -7.7], [[-23, -1, -18, -3.2, -13, -4.6], [1, -9.1, 15, -11.2, 28, -7.9], [28, -9, 25, -10.7, 20, -11.2], [1, -12.3, -17, -6.5, -29, -9.9]]),
      ellipse(-5.4, 14.3, 3.5, 3.8),
      stroke([[-17.5, 4.3], [-20.3, 4.9], [-23.8, 4.4]], 1.3),
      stroke([[-16, 1.1], [-19.2, 1.7]], 1.2),
      disc(16, 1, 1.2), disc(19.2, 2.7, 0.82), disc(20, -0.8, 0.85)
    ],
    accent: [
      disc(-8.5, 20.6, 1.4), box(-5.6, 17.3, 8.8, 2.3, -15),
      contour([-9.7, 17.9], [[-10.2, 22.1, -3, 22.5, -1.2, 16.3]]),
      contour([-5.9, 11.7], [[-12.5, 11.1, -13.1, 13.5, -18.4, 13.3], [-17.2, 12, -16.9, 11.5, -17, 10.5], [-12.6, 11, -11.4, 7.5, -6.6, 9.1]]),
      contour([-7.6, 10.5], [[-4.3, 11.7, -1.1, 6.1, 0.3, 3.5], [0.2, 0.6, -4.6, 0.3, -6.8, 3.1], [-10.2, 6, -10.2, 9.1, -7.6, 10.5]]),
      stroke([[-5.7, 8.6], [-1.4, 6.2], [3.4, 5.9]], 2.3), disc(4.2, 5.8, 1.42),
      stroke([[-3, 2.7], [3.5, 3], [7.6, 0.2], [8.8, 1]], 2.5),
      stroke([[-11, 2.8], [9, -2]], 2.0), stroke([[-8, 1.8], [-9, -1.6]], 1.65),
      stroke([[5.4, -1.1], [4.5, -4.5]], 1.65),
      stroke([[-12.7, -0.8], [5.9, -5.4], [10.5, -5.8], [13.1, -4.9], [14.2, -3], [13.6, -1.5]], 1.6)
    ]
  };
}

function reindeer({ disc, stroke, contour, starAt }) {
  const eye = disc(11.25, 12.9, 0.87);
  const markings = [eye, disc(-9, 4.1, 0.87), disc(-6, 4.9, 0.94), disc(-3, 4.35, 0.79)];
  return {
    snow: [starAt(-15, 18, 3.8), ...markings],
    accent: [
      contour([-15.3, 3.4], [[-13.4, 9, -7, 6.8, -1.5, 6.2], [2.4, 5.8, 3.4, 9.3, 6.5, 13.7], [8.3, 17.2, 11.7, 15.4, 13, 13.2], [14, 12, 16.6, 12.7, 17.2, 11.1], [17.4, 8, 13, 7.1, 10.2, 8.7], [8.4, 8.3, 8.2, 3.7, 5.1, 0.8], [2.4, -2, -5.5, -0.7, -11, -0.9], [-13.9, -1.3, -15.7, 0.3, -15.3, 3.4]]),
      contour([-14, 2.7], [[-17.5, 2.8, -20.6, 5, -20.2, 8.1], [-17.5, 7.8, -15.2, 7.1, -13.8, 5]]),
      contour([7.7, 12.3], [[3.5, 12.2, 1, 14.4, 0.9, 17.2], [4.5, 17.2, 7.8, 16, 9.5, 13.5]]),
      stroke([[9.4, 14], [9, 17.5], [6.4, 20.4], [4.9, 23], [4.6, 26.1]], 1.65),
      stroke([[6.1, 20.9], [2.8, 22], [1.4, 24.4]], 1.45),
      stroke([[8.8, 17.8], [11.6, 20.2], [12.6, 23.1]], 1.5),
      stroke([[11.5, 20.2], [14.5, 21.3], [15.6, 23.1]], 1.45),
      stroke([[-12.8, 1.3], [-12.7, -2.2], [-15.6, -5.1], [-15.6, -8]], 2.2),
      stroke([[-9.2, 1.3], [-8.6, -2], [-10.5, -5.3], [-9.7, -8]], 1.95),
      stroke([[2.6, 1.7], [1.4, -3.4], [0.8, -8]], 2.05),
      stroke([[5.2, 2], [5.8, -1.5], [8, -4.4], [9.6, -5.2]], 1.9)
    ],
    cut: markings
  };
}

function winterTree({ disc, box, contour, stroke, starAt }) {
  const tier = (y, w, h) => contour([0, y + h], [
    [-w * 0.1, y + h * 0.54, -w * 0.29, y + 3.5, -w * 0.5, y + 1.8],
    [-w * 0.46, y - 0.2, -w * 0.36, y - 0.6, -w * 0.25, y + 0.9],
    [-w * 0.17, y - 0.8, -w * 0.07, y - 0.8, 0, y + 0.4],
    [w * 0.08, y - 0.8, w * 0.18, y - 0.8, w * 0.25, y + 1],
    [w * 0.36, y - 0.6, w * 0.47, y - 0.2, w * 0.5, y + 1.8],
    [w * 0.29, y + 3.5, w * 0.1, y + h * 0.54, 0, y + h]
  ]);
  const ornaments = [
    disc(-2.2, 15, 1.05), disc(3.4, 10.4, 1.22), disc(-6.4, 4.5, 1.2),
    disc(2.1, 2.4, 1.24), disc(8.7, -0.6, 1.24), disc(-4.3, -4.4, 1.08),
    stroke([[-4.5, 10.6], [-2, 9.2], [0.1, 8.5], [2.4, 8.5], [5.4, 9]], 1.2),
    stroke([[-8.5, 0.9], [-5.7, -0.6], [-2.7, -1.6], [0.5, -1.9], [3.7, -1.4], [6.6, 0.1]], 1.25)
  ];
  return {
    snow: [starAt(0, 26.8, 4.2), ...ornaments],
    accent: [tier(10, 16, 13), tier(2, 23, 16), tier(-6, 30, 18), box(0, -6.4, 4.8, 4.8)],
    cut: ornaments
  };
}

const scenes = { snowman, sledding, reindeer, "winter-tree": winterTree };

function snowflakeLace({ stroke, poly, cut }) {
  const rays = [];
  for (let i = 0; i < 6; i++) {
    const theta = Math.PI / 6 + i * Math.PI / 3;
    const point = (d, offset = 0) => [Math.cos(theta) * d - Math.sin(theta) * offset,
      Math.sin(theta) * d + Math.cos(theta) * offset + 2.5];
    rays.push(stroke([point(6), point(31)], 2.7));
    for (const [start, tip, reach] of [[11, 19, 6], [20, 28, 8], [28, 35, 5]]) {
      rays.push(stroke([point(tip, -reach), point(start), point(tip, reach)], start === 11 ? 2 : 2.3));
    }
    const vertices = [[30, 0], [34, 4.5], [42, 0], [34, -4.5]];
    const window = [[32.6, 0], [34.3, 1.55], [37.2, 0], [34.3, -1.55]];
    rays.push(cut(poly(vertices.map(([d, s]) => point(d, s))), poly(window.map(([d, s]) => point(d, s)))));
  }
  const hexagon = radius => poly(Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 6 + i * Math.PI / 3;
    return [radius * Math.cos(angle), 2.5 + radius * Math.sin(angle)];
  }));
  rays.push(cut(hexagon(8), hexagon(4.9)));
  return rays;
}

function woodland({ stroke, poly, starAt }, deer) {
  const fir = (x, y, w, h) => poly([
    [x, y + h], [x - w * 0.28, y + h * 0.57], [x - w * 0.11, y + h * 0.59],
    [x - w * 0.4, y + h * 0.31], [x - w * 0.2, y + h * 0.36], [x - w / 2, y + 3],
    [x - 1.4, y + 4.5], [x - 1.4, y], [x + 1.4, y], [x + 1.4, y + 4.5],
    [x + w / 2, y + 3], [x + w * 0.2, y + h * 0.36], [x + w * 0.4, y + h * 0.31],
    [x + w * 0.11, y + h * 0.59], [x + w * 0.28, y + h * 0.57]
  ]);
  return [
    ...deer.accent,
    stroke([[-39, -7.5], [-30, -7], [-22, -9.1], [-14, -8.5], [-5, -10.8], [8, -9.3], [17, -7.7], [26, -9.5], [39, -7.3]], 3.3),
    fir(-27, -8.5, 15.5, 32), fir(25, -9.7, 15, 27), fir(33, -9.2, 10, 20),
    stroke([[-30, 27], [-21.8, 25.6]], 1.9), starAt(-20, 25.3, 4.6),
    stroke([[30, 28], [23.9, 24.1]], 1.85), starAt(22.8, 23.2, 3.9)
  ];
}

function photoSprigs({ stroke, contour, disc }, round) {
  const sprigs = [];
  for (const side of [-1, 1]) {
    const x = round ? 26.5 : 24.7;
    const point = (dx, y) => [side * (x + dx), y];
    sprigs.push(stroke([point(-1.2, -11), point(2.4, -6), point(3.4, 0), point(2.1, 6.8)], 1.45));
    for (const [dx, y, lean, rise] of [[0.8, -8, -4.3, 5], [2.4, -5, 4.6, 4.4], [3.1, -1.5, -4.4, 4.7], [3.1, 2, 3.9, 4.1], [2.1, 6.2, -2, 4.7]]) {
      sprigs.push(contour(point(dx, y), [
        [...point(dx + lean * 0.08, y + rise * 0.75), ...point(dx + lean * 0.55, y + rise), ...point(dx + lean, y + rise)],
        [...point(dx + lean * 0.92, y + rise * 0.45), ...point(dx + lean * 0.72, y + rise * 0.1), ...point(dx, y)]
      ]));
    }
    sprigs.push(disc(side * (x + 1.2), 13.6, 1.05), disc(side * (x + 4), 11.2, 0.88));
  }
  return sprigs;
}

function flurry({ stroke, starAt }) {
  const crystal = (x, y, r) => Array.from({ length: 3 }, (_, i) => {
    const a = i * Math.PI / 3;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    return stroke([[x - dx, y - dy], [x + dx, y + dy]], 1.08);
  });
  return [
    ...crystal(22, 18, 3), ...crystal(-25, 16, 2.5), ...crystal(27, 8.5, 1.9),
    starAt(-13, 27, 2.4), starAt(17.5, 26, 2.1), starAt(-26, 6.5, 1.85)
  ];
}

export default async function build(p, { wasm, font }) {
  if (!font) throw new Error(FONT_NOT_LOADED);
  const { CrossSection: C } = wasm;
  const temps = [];
  const solids = [];
  const t = value => { temps.push(value); return value; };
  const disc = (x, y, r) => t(t(C.circle(r, r >= 20 ? 120 : 48)).translate([x, y]));
  const ellipse = (x, y, rx, ry) => t(t(t(C.circle(1, 48)).scale([rx, ry])).translate([x, y]));
  const box = (x, y, w, h, angle = 0) => t(t(t(roundedRect(C, w, h, 0.55)).rotate(angle)).translate([x, y]));
  const bridge = (x, y, w, h) => t(t(C.square([w, h], true)).translate([x, y]));
  const poly = points => {
    const area2 = points.reduce((area, [x, y], i) => {
      const [nx, ny] = points[(i + 1) % points.length];
      return area + x * ny - y * nx;
    }, 0);
    return t(C.ofPolygons([area2 < 0 ? points.toReversed() : points]));
  };
  const starAt = (x, y, r) => t(t(star(C, r, 4, 0.44)).translate([x, y]));
  const union = shapes => t(C.union(shapes));
  const cut = (a, b) => t(a.subtract(b));
  const stroke = (points, width) => union([
    ...points.map(([x, y]) => disc(x, y, width / 2)),
    ...points.slice(1).map(([x, y], i) => {
      const [px, py] = points[i];
      const length = Math.hypot(x - px, y - py);
      const dx = (y - py) * width / (2 * length);
      const dy = (px - x) * width / (2 * length);
      return poly([[px + dx, py + dy], [x + dx, y + dy], [x - dx, y - dy], [px - dx, py - dy]]);
    })
  ]);
  const contour = (start, segments) => {
    const points = [start];
    let [x, y] = start;
    for (const [x1, y1, x2, y2, x3, y3] of segments) {
      for (let i = 1; i <= 12; i++) {
        const u = i / 12;
        const v = 1 - u;
        points.push([
          v ** 3 * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u ** 3 * x3,
          v ** 3 * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u ** 3 * y3
        ]);
      }
      [x, y] = [x3, y3];
    }
    return poly(points);
  };
  const r = p.diameter_mm / 2;
  const scale = r / 40;
  const scaled = shape => t(shape.scale([scale, scale]));
  const overlap = (a, b) => t(a.intersect(b));
  function add(name, color, shape, height, z = 0) {
    const raw = t(shape.extrude(height));
    solids.push({ name, color, solid: raw.translate([0, 0, z]) });
  }
  let ok = false;
  try {
    const loopY = r + 0.8;
    const circle = disc(0, 0, 40);
    const loop = cut(disc(0, loopY, 5.5), disc(0, loopY, 2.5));
    const hang = shape => cut(union([scaled(shape), loop]), disc(0, loopY, 2.5));
    const helpers = { disc, ellipse, box, stroke, contour, poly, starAt, cut };
    const warnings = [];
    const year = p.year?.trim();
    const rearYear = p.year_side === "rear";
    const nameThrough = p.name_finish === "cut-through";
    const yearThrough = p.year_finish === "cut-through";
    const yearRaised = p.year_finish === "raised";
    const needsRearSupport = Boolean(year && rearYear && yearRaised);
    const photo = p.scene.endsWith("-photo");
    const openwork = p.scene === "snowflake-lace" || p.scene === "woodland-cutout";
    const frontPair = year && !rearYear;
    // A through-cut is visible on both faces, so it cannot share the name's footprint.
    const separateRearRows = rearYear && (yearThrough || nameThrough);
    const rearStencilPair = year && separateRearRows && openwork;
    let nameBox = { cx: 0, cy: -20, maxW: 48, maxH: 11 };
    let nameZ = BASE;
    const motifFor = scene => cut(union(scene.accent), union(scene.cut ?? []));
    if (photo) {
      const round = p.scene === "round-photo";
      const frameWindow = inset => round ? disc(0, 5, 20.5 + inset) : t(t(roundedRect(C, 35 + 2 * inset, 35 + 2 * inset, 3 + inset)).translate([0, 6]));
      const outline = hang(circle);
      const rear = cut(outline, scaled(frameWindow(1.7)));
      const face = cut(outline, scaled(frameWindow(0)));
      const rearSolid = t(rear.extrude(POCKET_DEPTH));
      const frontSolid = t(t(face.extrude(PHOTO_DEPTH - POCKET_DEPTH)).translate([0, 0, POCKET_DEPTH]));
      solids.push({ name: "Ornament", color: p.plate_color, solid: rearSolid.add(frontSolid) });
      nameZ = PHOTO_DEPTH;
      nameBox = { cx: 0, cy: -23, maxW: 43, maxH: 10 };
      const trim = cut(disc(0, 0, 37.5), disc(0, 0, 36.2));
      const edge = cut(frameWindow(1.7), frameWindow(0.65));
      add("Scene", p.accent_color, scaled(union([
        edge, trim, ...photoSprigs(helpers, round), starAt(-24, 19, 2.6), starAt(24, 19, 2.6)
      ])), RELIEF, nameZ);
      const size = ((round ? 44.4 : 38.4) * scale - 0.5).toFixed(1);
      warnings.push(`Trim a paper photo to ${size} mm ${round ? "across" : "square with rounded corners"}. Insert it from the back and secure it with removable tape. Photo and tape are not included.`);
    } else if (openwork) {
      const ring = cut(circle, disc(0, 0, 36.7));
      const panel = overlap(circle, t(t(roundedRect(C, 73, frontPair ? 22 : 16, 6)).translate([0, frontPair ? -24 : -23])));
      const deer = p.scene === "woodland-cutout" ? reindeer(helpers) : null;
      const lace = deer ? woodland(helpers, deer) : snowflakeLace(helpers);
      const art = cut(union(lace), union(deer?.cut ?? []));
      const shape = overlap(circle, union([ring, panel, art]));
      add("Ornament", p.plate_color, hang(shape), BASE);
      nameBox = { cx: 0, cy: -23, maxW: 49, maxH: 11 };
      warnings.push("The open areas print through. The name is supported by a solid band.");
    } else {
      add("Ornament", p.plate_color, hang(circle), BASE);
      const scene = scenes[p.scene](helpers);
      const motif = motifFor(scene);
      const snow = cut(union([
        cut(disc(0, 0, 37), disc(0, 0, 35.55)),
        ...(p.scene === "sledding" ? [] : [stroke([[-25, -9.5], [-19, -8.1], [-13, -8.6], [-7, -9.3],
          [0, -8.9], [8, -8.2], [15, -8.5], [22, -9.55], [25, -9.2]], 1.45)]),
        ...flurry(helpers), disc(-22, 10.1, 0.9), disc(24, 1, 0.9),
        disc(13, 29, 0.85), disc(-20, 23, 0.8), disc(-28, 11.5, 0.8),
        ...scene.snow
      ]), motif);
      add("Snow and border", p.snow_color, scaled(snow), RELIEF, BASE);
      add("Scene", p.accent_color, scaled(motif), RELIEF, BASE);
    }
    let skippedChars = false;
    function lettering(text, placement, through, label) {
      const { cs, cap, skipped } = fontTextLines(C, font, text, placement, t, { splitBelow: 0 });
      if (cs.isEmpty()) throw new Error(`The ${label} needs at least one character supported by the selected font.`);
      if (cap * scale < 3) throw new Error(`The ${label} is too small to print. Choose a shorter entry, a bolder font, or a larger diameter.`);
      skippedChars ||= skipped;
      const glyphs = t(scaled(cs).offset(0.16, "Round", 2, 20));
      return through ? union(stencil(glyphs, bridge, t)) : glyphs;
    }
    function removeLetters(shape, z, height, label) {
      const base = solids[0];
      const tool = t(t(shape.extrude(height)).translate([0, 0, z]));
      const trimmed = base.solid.subtract(tool);
      const components = trimmed.decompose();
      const connected = components.length === 1;
      components.forEach(component => component.delete());
      if (!connected) {
        trimmed.delete();
        throw new Error(`The ${label} would leave loose pieces. Try a different font or a larger diameter.`);
      }
      base.solid.delete();
      base.solid = trimmed;
    }
    if (frontPair) nameBox = { ...nameBox, cy: photo ? -22 : openwork ? -20.5 : -19, maxH: photo ? 8 : 9 };
    else if (rearStencilPair) nameBox = { ...nameBox, cy: -20, maxH: 8 };
    const letters = lettering(p.name.trim().replace(/\s+/g, " "), nameBox, nameThrough, "name");
    if (nameThrough) removeLetters(letters, -0.1, nameZ + 0.2, "name");
    else add("Name", p.snow_color, letters, RELIEF, nameZ);
    if (year) {
      const cy = frontPair ? (photo ? -31 : openwork ? -30 : -29)
        : rearStencilPair ? -27.8
        : separateRearRows && photo ? -31.7
        : yearThrough ? -30
        : photo || openwork ? nameBox.cy : 0;
      const placement = { cx: 0, cy, maxW: 23, maxH: rearStencilPair ? 5 : 5.6 };
      let digits = lettering(year, placement, yearThrough, "year");
      if (rearYear) digits = t(digits.mirror([1, 0]));
      if (yearThrough) removeLetters(digits, -0.1, nameZ + 0.2, "year");
      else if (yearRaised) add("Year", p.snow_color, digits, RELIEF, rearYear ? -RELIEF : nameZ);
      else removeLetters(digits, rearYear ? -0.1 : nameZ - ENGRAVE_DEPTH, ENGRAVE_DEPTH + 0.1, "year");
    }
    if (needsRearSupport) {
      for (const part of solids) {
        const grounded = part.solid.translate([0, 0, RELIEF]);
        part.solid.delete();
        part.solid = grounded;
      }
    }
    warnings.unshift(needsRearSupport
      ? "Print rear down with build-plate supports under the rear face only. Check the slicer preview; supports are not included in the model."
      : "Print flat back down.");
    if (skippedChars) warnings.push(FONT_CHARS_SKIPPED);
    ok = true;
    return { solids, title: "Holiday ornament", warnings, ...(needsRearSupport ? {
      slicerSettings: { enable_support: "1", support_type: "normal(auto)", support_on_build_plate_only: "1" }
    } : {}) };
  } finally {
    for (const object of temps.reverse()) object.delete();
    if (!ok) for (const { solid } of solids) solid.delete();
  }
}
