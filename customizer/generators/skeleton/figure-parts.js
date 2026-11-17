import { capsule } from "./geometry.js";
import { reliefSolid } from "./relief.js";

export function polygon(s, points) {
  const area = points.reduce((a, p, i) => {
    const q = points[(i + 1) % points.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0);
  return s.t(s.wasm.CrossSection.ofPolygons([area < 0 ? [...points].reverse() : points]));
}

function curve(a, b, c, d, steps = 12) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return [0, 1].map(k => u ** 3 * a[k] + 3 * u ** 2 * t * b[k] + 3 * u * t ** 2 * c[k] + t ** 3 * d[k]);
  });
}

export function roundedBeam(s, a, b, width, depth, endWidth = width) {
  const { t, wasm: { Manifold } } = s;
  const ball = t(t(Manifold.sphere(1, 20)).scale([width / 2, width / 2, depth]));
  const end = t(ball.scale([endWidth / width, endWidth / width, 1]));
  const hull = t(Manifold.hull([t(ball.translate([...a, 0])), t(end.translate([...b, 0]))]));
  s.floor ??= t(t(Manifold.cube([1000, 1000, 100], true)).translate([0, 0, 50]));
  return t(hull.intersect(s.floor));
}

export function tailoredLimb(s, o, start, joint, end, kind) {
  const { t, wasm: { CrossSection } } = s;
  const height = start[1] - end[1], centerY = (start[1] + end[1]) / 2;
  const split = (start[1] - joint[1]) / height;
  const slopeA = (joint[0] - start[0]) / (joint[1] - start[1]);
  const slopeB = (end[0] - joint[0]) / (end[1] - joint[1]);
  const jointSlope = (slopeA + slopeB) / 2;
  const section = v => {
    const upper = v <= split, a = upper ? start : joint, b = upper ? joint : end;
    const u = upper ? v / split : (v - split) / (1 - split), dy = b[1] - a[1];
    const m0 = upper ? slopeA : jointSlope, m1 = upper ? jointSlope : slopeB;
    const x = (2 * u ** 3 - 3 * u ** 2 + 1) * a[0] + (u ** 3 - 2 * u ** 2 + u) * dy * m0
      + (-2 * u ** 3 + 3 * u ** 2) * b[0] + (u ** 3 - u ** 2) * dy * m1;
    const blend = u * u * (3 - 2 * u);
    const width = o.limb_width_mm * (upper ? (kind === "arm" ? 1.18 : 1.12) * (1 - blend) + 0.88 * blend : 0.88 * (1 - blend) + 1.05 * blend);
    const fold = Math.exp(-(((v - split) / 0.025) ** 2));
    const cuff = kind === "arm" ? Math.exp(-(((v - 0.965) / 0.018) ** 2)) : 0;
    const depth = o.limb_depth_mm * (0.87 + 0.13 * Math.sin(Math.PI * v)) - Math.min(0.35, o.limb_depth_mm * 0.1) * (fold + cuff);
    return { x, width, depth, y: start[1] - v * height };
  };
  const raw = reliefSolid(s, {
    width: 1, height, columns: 32, rows: 112, gridFloor: true,
    bounds(y) {
      const p = section(0.5 - y);
      return [p.x - p.width / 2, p.x + p.width / 2];
    },
    surface(x, y) {
      const p = section(0.5 - y), u = (x - p.x) / (p.width / 2);
      return p.depth * (0.16 + 0.84 * Math.sqrt(Math.max(0, 1 - u * u)));
    }
  });
  const solid = t(raw.translate([0, centerY, 0]));
  if (!o.multicolor || !o.pinstripes) return { solid };
  const marks = [-0.28, 0, 0.28].map(offset => {
    const edges = [-1, 1].map(side => Array.from({ length: 113 }, (_, i) => {
      const p = section(i / 112);
      return [p.x + offset * p.width + side * Math.min(o.stripe_width_mm, p.width * 0.18) / 2, p.y];
    }));
    return polygon(s, [...edges[0], ...edges[1].reverse()]);
  });
  const skin = t(solid.subtract(t(solid.translate([0, 0, -0.5]))));
  const inlay = t(t(t(CrossSection.union(marks)).extrude(o.limb_depth_mm + 1)).intersect(skin));
  return { solid, inlay };
}

function jacketRadius(y, o) {
  const waist = o.jacket_waist_pct / 200;
  const points = [[-0.5, 0.43], [-0.3, 0.32], [-0.12, waist], [0.1, 0.38], [0.4, 0.48], [0.5, 0.08]];
  for (let i = 1; i < points.length; i++) {
    if (y > points[i][0]) continue;
    const [a, b] = [points[i - 1], points[i]], u = (y - a[0]) / (b[0] - a[0]), t = u * u * (3 - 2 * u);
    return a[1] * (1 - t) + b[1] * t;
  }
  return points.at(-1)[1];
}

function lapelPaths(o) {
  const w = o.torso_width_mm, h = o.torso_length_mm;
  return [-1, 1].map(side => curve([side * w * 0.29, h * 0.44], [side * w * 0.46, h * 0.3], [side * w * 0.26, -h * 0.09], [0, -h * 0.19], 24));
}

function collarShape(s, o) {
  const w = o.neck_width_mm, top = o.torso_length_mm / 2;
  return polygon(s, [[-w * 0.7, top + 2], [w * 0.7, top + 2], [w * 0.9, top - 3], [0, top - 5], [-w * 0.9, top - 3]]);
}

function distanceToPath(x, y, path) {
  let distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return distance;
}

export function jacket(s, o) {
  const w = o.torso_width_mm, h = o.torso_length_mm, bottom = -h / 2, lapels = lapelPaths(o);
  let body = reliefSolid(s, {
    width: w, height: h, columns: 96, rows: 128,
    bounds: y => { const r = jacketRadius(y, o); return [-r, r]; },
    surface(x, y) {
      const curve = Math.max(0, 1 - (x / jacketRadius(y, o)) ** 2) ** 0.55;
      const chest = 0.72 + 0.28 * Math.exp(-(((y - 0.18) / 0.35) ** 2));
      const distance = Math.min(...lapels.map(path => distanceToPath(x * w, y * h, path)));
      const rib = Math.max(0, 1 - distance / Math.max(1.6, w * 0.095)) ** 1.5;
      return o.body_depth_mm * (0.2 + 0.8 * curve * chest) + rib * curve * 1.35;
    }
  });
  body = s.t(body.add(s.t(collarShape(s, o).extrude(o.body_depth_mm + 0.5))));
  if (o.assembly !== "flex" && o.coat_tail_mm > 0) {
    for (const side of [-1, 1]) {
      const edge = curve([w * 0.4, bottom + 6], [w * 0.49, bottom - o.coat_tail_mm * 0.2], [w * 0.54, bottom - o.coat_tail_mm * 0.7], [w * 0.57, bottom - o.coat_tail_mm]);
      const points = [[w * 0.12, bottom + 6], ...edge, [w * 0.3, bottom - o.coat_tail_mm * 0.42], [w * 0.16, bottom + 1]].map(([x, y]) => [side * x, y]);
      body = s.t(body.add(s.t(polygon(s, points).extrude(Math.min(4, o.body_depth_mm * 0.65)))));
    }
  }
  return body;
}

export function suitInlay(s, o, body) {
  const { t, wasm: { CrossSection } } = s, w = o.torso_width_mm, h = o.torso_length_mm, top = h / 2;
  const collar = collarShape(s, o);
  const shapes = [collar, polygon(s, [[-w * 0.25, top - 1], [w * 0.25, top - 1], [0, top - h * 0.66]])];
  if (o.pinstripes) {
    const spacing = o.stripe_spacing_mm;
    for (let x = -w * 0.35; x <= w * 0.35; x += spacing) {
      shapes.push(capsule(s, [x, -h / 2 + 3], [x, top - 2], o.stripe_width_mm));
    }
  }
  const edges = Array.from({ length: 129 }, (_, i) => { const y = i / 128 - 0.5; return [jacketRadius(y, o) * w, y * h]; });
  const outline = t(polygon(s, [...edges, ...edges.map(([x, y]) => [-x, y]).reverse()]).add(collar));
  const ribs = [];
  for (const path of lapelPaths(o)) for (let i = 1; i < path.length; i++) ribs.push(capsule(s, path[i - 1], path[i], Math.max(2.2, w * 0.11)));
  const cs = t(t(t(CrossSection.union(shapes)).intersect(outline)).subtract(t(CrossSection.union(ribs))));
  const skin = t(body.subtract(t(body.translate([0, 0, -0.6]))));
  return t(t(cs.extrude(o.body_depth_mm + 2)).intersect(skin));
}

export function hand(s, o, wrist, side, direction = [0, -1]) {
  const { t, wasm: { Manifold } } = s;
  const length = o.hand_length_mm, w = o.hand_width_mm, d = Math.min(o.limb_depth_mm, w * 0.65);
  const angle = Math.atan2(direction[0], -direction[1]), cos = Math.cos(angle), sin = Math.sin(angle);
  const at = ([x, y]) => [wrist[0] + side * x * cos - y * sin, wrist[1] + side * x * sin + y * cos];
  const parts = [roundedBeam(s, wrist, at([0, -length * 0.27]), w * 0.58, d, w * 0.85)];
  const digit = (points, width) => {
    for (let i = 1; i < points.length; i++) {
      const taper = 1 - 0.33 * i / (points.length - 1);
      parts.push(roundedBeam(s, at(points[i - 1]), at(points[i]), width * taper, Math.min(d, width * 1.1), width * Math.max(0.5, taper - 0.05)));
    }
  };
  digit(curve([-w * 0.24, -length * 0.12], [-w * 0.7, -length * 0.21], [-w * 0.67, -length * 0.4], [-w * 0.55, -length * 0.49]), o.finger_width_mm * 1.3);
  for (let i = 0; i < 4; i++) {
    const reach = [0.86, 1, 0.92, 0.75][i], root = w * (-0.3 + i * 0.2);
    const knuckle = [root + w * (0.08 + i * 0.04), -length * (0.12 + reach * 0.54)];
    const distal = [root + w * 0.15, -length * reach * 0.86], tip = [root - w * 0.06, -length * reach];
    digit(curve([root, -length * 0.25], [knuckle[0], -length * 0.36], knuckle, knuckle, 5), o.finger_width_mm);
    digit(curve(knuckle, distal, [distal[0], tip[1]], tip, 5), o.finger_width_mm * 0.85);
    parts.push(roundedBeam(s, at(knuckle), at(knuckle), o.finger_width_mm * 1.04, Math.min(d, o.finger_width_mm * 1.2)));
  }
  return t(Manifold.union(parts));
}

export function shoe(s, o, ankle, side) {
  const { t, wasm: { Manifold } } = s, width = o.limb_width_mm;
  const center = [ankle[0] + side * o.foot_length_mm * 0.3, ankle[1] - width * 0.1, 0];
  const shape = t(t(t(Manifold.sphere(1, 48)).scale([(o.foot_length_mm + width) / 2, width * 0.8, o.limb_depth_mm * 1.2])).translate(center));
  s.floor ??= t(t(Manifold.cube([1000, 1000, 100], true)).translate([0, 0, 50]));
  const sole = t(t(Manifold.cube([1000, 1000, 100], true)).translate([ankle[0], ankle[1] - width * 0.55 + 500, 50]));
  return t(t(shape.intersect(s.floor)).intersect(sole));
}

export function cuffCut(s, sleeve, elbow, wrist) {
  const { t, wasm: { Manifold } } = s;
  const dx = wrist[0] - elbow[0], dy = wrist[1] - elbow[1], length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const halfspace = t(t(t(Manifold.cube([1000, 1000, 100], true)).rotate([0, 0, angle])).translate([wrist[0] - 500 * dx / length, wrist[1] - 500 * dy / length, 50]));
  return t(sleeve.intersect(halfspace));
}

export function bow(s, o, attached = false) {
  const { t, wasm: { CrossSection } } = s, w = o.bow_width_mm, parts = [];
  parts.push(polygon(s, [[-0.075, 0.06], [-0.09, 0.16], [-0.025, 0.11], [0.025, 0.11], [0.09, 0.16], [0.075, 0.06], [0.05, -0.1], [0, -0.14], [-0.05, -0.1]].map(([x, y]) => [x * w, y * w])));
  for (const side of [-1, 1]) {
    for (const [x, y] of [[0.2, 0.22], [0.4, 0.19], [0.47, 0.055], [0.5, -0.06], [0.38, -0.22]]) {
      const tipY = y * w * (side < 0 ? 1 : 0.94);
      const path = curve([side * w * 0.035, 0], [side * w * 0.13, tipY * 0.4], [side * x * w * 0.8, tipY * 0.6], [side * x * w, tipY]);
      for (let i = 1; i < path.length; i++) {
        const thickness = Math.max(0.6, o.bow_branch_mm * (1.3 - i / (path.length - 1)));
        parts.push(capsule(s, path[i - 1], path[i], thickness));
      }
    }
  }
  const shape = t(t(CrossSection.union(parts)).extrude(o.body_depth_mm + o.bow_depth_mm + 1));
  const surface = reliefSolid(s, {
    width: w + 4, height: w * 0.6, columns: 64, rows: 48, bounds: () => [-0.5, 0.5],
    surface: (x, y) => o.bow_depth_mm + (attached ? o.body_depth_mm : 0.6) * Math.exp(-((x / 0.2) ** 2) - (y / 0.4) ** 2)
  });
  return t(shape.intersect(surface));
}
