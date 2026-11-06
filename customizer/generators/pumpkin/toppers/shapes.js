import { solidFromMesh } from '../mesh.js';

// Smooth ring loft, including swept tips. Rings: [x, z, radius, tiltDegrees?, yScale?].
export function loft(wasm, rings, t, { segments = 96, ripple = 0, waves = 12 } = {}) {
  const pos = [], idx = [];
  for (const [x, z, radius, tilt = 0, ys = 1] of rings) {
    const a = tilt * Math.PI / 180;
    for (let i = 0; i < segments; i++) {
      const th = i / segments * Math.PI * 2;
      const r = radius * (1 + ripple * Math.cos(th * waves));
      pos.push(x + Math.cos(th) * r * Math.cos(a), Math.sin(th) * r * ys, z - Math.cos(th) * r * Math.sin(a));
    }
  }
  const bottom = pos.length / 3;
  pos.push(rings[0][0], 0, rings[0][1]);
  const last = rings.at(-1), top = pos.length / 3;
  pos.push(last[0], 0, last[1]);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(bottom, j, i);
    for (let k = 0; k < rings.length - 1; k++) {
      const a = k * segments + i, b = k * segments + j, c = b + segments, d = a + segments;
      idx.push(a, b, c, a, c, d);
    }
    idx.push(top, (rings.length - 1) * segments + i, (rings.length - 1) * segments + j);
  }
  return t(solidFromMesh(wasm, { pos: new Float32Array(pos), idx: new Uint32Array(idx) }, 'hat'));
}

export function tools(wasm, t) {
  const { Manifold, CrossSection } = wasm;
  const ball = (r, p, n = 20) => t(t(Manifold.sphere(r, n)).translate(p));
  const union = shapes => t(Manifold.union(shapes));
  const line = (points, r = 0.35) => union(points.slice(1).map((p, i) => t(Manifold.hull([ball(r, points[i], 12), ball(r, p, 12)]))));
  const front = (cs, depth, y, z) => t(t(t(cs.extrude(depth)).rotate([90, 0, 0])).translate([0, y, z]));
  const star = (radius, inner, count = 5) => t(new CrossSection([Array.from({ length: count * 2 }, (_, i) => {
    const a = i / count * Math.PI + Math.PI / 2;
    const r = i % 2 ? inner : radius;
    return [Math.cos(a) * r, Math.sin(a) * r];
  })]));
  return { ball, union, line, front, star };
}
