import { roundedRect } from "../../framework/shapes.js";
import { threadSpec } from "../../../public/assets/js/customize/skeleton.js";
import { eyeDimensions, HEAD_COLUMNS, HEAD_ROWS, headSolid, noseDimensions } from "./head.js";

export function scope(wasm) {
  const temps = [], solids = [];
  const t = o => { temps.push(o); return o; };
  const add = (name, color, solid) => {
    // Dense-mesh Boolean trims can leave numerical sheets with no printable volume.
    const pieces = solid.decompose();
    try {
      const printable = pieces.filter(p => Math.abs(p.volume()) > 1e-8);
      if (!printable.length) throw new Error(`No printable volume in ${name}.`);
      solids.push({ name, color, solid: wasm.Manifold.union(printable) });
    } finally { pieces.forEach(p => p.delete()); }
  };
  const done = ok => {
    for (const o of temps) o.delete();
    if (!ok) for (const s of solids) s.solid.delete();
  };
  return { wasm, t, add, solids, done };
}

export function capsule(s, a, b, width) {
  const { CrossSection } = s.wasm, { t } = s;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cs = t(roundedRect(CrossSection, width, length + width, width / 2 - 0.001));
  return t(t(cs.rotate(-Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI)).translate([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
}

export function beam(s, a, b, width, depth) {
  return s.t(capsule(s, a, b, width).extrude(depth));
}

export function skull(s, o, { attachment = "none", bore = false } = {}) {
  const { CrossSection, Manifold } = s.wasm, { t } = s;
  const w = o.head_width_mm, h = o.head_height_mm, depth = o.head_depth_mm, base = Math.min(2.4, depth * 0.3);
  let body = headSolid(s, o);

  if (attachment !== "none") {
    const hole = o.hole_diameter_mm / 2, outer = hole + o.loop_wall_mm;
    const cy = attachment === "loop" ? h / 2 + outer * 0.55 : h / 2 - outer;
    const holeCS = t(t(CrossSection.circle(hole, 48)).translate([0, cy]));
    if (attachment === "loop") {
      const loop = t(t(CrossSection.circle(outer, 48)).translate([0, cy]));
      body = t(body.add(t(loop.extrude(base))));
    }
    body = t(body.subtract(t(holeCS.extrude(depth + 1))));
  }
  const features = [];
  for (const x of [-1, 1]) {
    const eye = eyeDimensions(o, x), margin = Math.max(w / HEAD_COLUMNS, h / HEAD_ROWS) / 2;
    features.push(t(t(t(t(CrossSection.circle(1, 96)).scale([eye.rx + margin, eye.ry + margin])).rotate(eye.angle)).translate([eye.x, eye.y])));
    const nose = noseDimensions(o, x);
    features.push(t(t(t(t(CrossSection.circle(1, 48)).scale([nose.rx + margin, nose.ry + margin])).rotate(nose.angle)).translate([nose.x, nose.y])));
  }
  features.push(t(CrossSection.ofPolygons([[-w * 0.016, -h * 0.217], [w * 0.016, -h * 0.217], [0, -h * 0.135]])));
  const featureCS = t(CrossSection.union(features));
  const skin = t(body.subtract(t(body.translate([0, 0, -o.inlay_depth_mm]))));
  const face = t(t(featureCS.extrude(depth + 1)).intersect(skin));
  body = t(body.subtract(face));
  if (bore) body = t(body.subtract(screw(s, o, true)));
  return { body, face };
}

// A single-start helical radial profile; both mating surfaces share pitch and phase.
export function screw(s, o, female = false) {
  const { Manifold, Mesh } = s.wasm, { t } = s, spec = threadSpec(o);
  const N = 64, layers = Math.ceil(spec.height / spec.pitch * 32);
  const vertices = [], triangles = [];
  for (let j = 0; j <= layers; j++) {
    const z = spec.height * j / layers;
    for (let i = 0; i < N; i++) {
      const angle = 2 * Math.PI * i / N;
      const phase = ((i / N - z / spec.pitch) % 1 + 1) % 1;
      const wave = Math.max(0, 1 - Math.abs(phase - 0.5) / 0.4);
      const lead = female ? 1 : Math.min(1, z / 0.6, (spec.height - z) / 0.6);
      const r = spec.radius - spec.ridge + spec.ridge * wave * lead + (female ? spec.clearance : 0);
      vertices.push(r * Math.cos(angle), r * Math.sin(angle), z);
      if (j < layers) {
        const a = j * N + i, b = j * N + (i + 1) % N, c = a + N, d = b + N;
        triangles.push(a, b, c, b, d, c);
      }
    }
  }
  const bottom = vertices.length / 3; vertices.push(0, 0, 0);
  const top = vertices.length / 3; vertices.push(0, 0, spec.height);
  for (let i = 0; i < N; i++) {
    triangles.push(bottom, (i + 1) % N, i);
    triangles.push(top, layers * N + i, layers * N + (i + 1) % N);
  }
  const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(vertices), triVerts: new Uint32Array(triangles) });
  try { return t(Manifold.ofMesh(mesh)); } finally { mesh.delete?.(); }
}

export function jointSpec(o) {
  // Orthogonal round loops have their largest minimum separation at one centerline radius.
  const centerRadius = o.joint_wall_mm + o.joint_clearance_mm + 0.8;
  return { radius: centerRadius + o.joint_wall_mm / 2, distance: centerRadius, z: centerRadius / Math.sqrt(2) + o.joint_wall_mm / 2 - 0.4 };
}

export function jointLink(s, o, angle, inflate = 0) {
  const { t, wasm: { CrossSection, Manifold } } = s;
  const { radius, z } = jointSpec(o), wall = o.joint_wall_mm;
  const tube = t(t(CrossSection.circle(wall / 2 + inflate, 24)).translate([radius - wall / 2, 0]));
  const solid = t(t(tube.revolve(64)).rotate([0, angle, 0]));
  const raised = t(solid.translate([0, 0, z]));
  const bed = t(t(Manifold.cube([4 * radius, 4 * radius, 4 * radius], true)).translate([0, 0, 2 * radius - inflate]));
  return t(raised.intersect(bed));
}

export function jointPair(s, o, a, direction) {
  const { t } = s, { distance, radius } = jointSpec(o);
  const deg = -Math.atan2(direction[0], direction[1]) * 180 / Math.PI;
  const b = [a[0] + direction[0] * distance, a[1] + direction[1] * distance];
  const place = (link, xy) => t(t(link.rotate([0, 0, deg])).translate([...xy, 0]));
  const proximal = place(jointLink(s, o, 45), a);
  const distal = place(jointLink(s, o, -45), b);
  return { proximal, distal, end: [b[0] + direction[0] * (radius - o.joint_wall_mm / 2), b[1] + direction[1] * (radius - o.joint_wall_mm / 2)] };
}
