import { sampleVaseEnvelope } from '../../../public/assets/js/customize/vase-dimensions.js';
function dimension(p, key, lo, hi) {
  if (!Number.isFinite(p[key]) || p[key] < lo || p[key] > hi) {
    throw new RangeError(`Vase ${key} must be from ${lo} to ${hi} mm.`);
  }
  return p[key];
}

function envelope(wasm, rings, segments, height, extension = 0) {
  const stations = extension ? [
    { ...rings[0], z: -extension }, ...rings, { ...rings.at(-1), z: height + extension },
  ] : rings;
  const positions = [], triangles = [];
  for (const ring of stations) for (let i = 0; i < segments; i++) {
    const angle = ring.angles[i];
    positions.push(ring.radii[i] * Math.cos(angle), ring.radii[i] * Math.sin(angle), ring.z);
  }
  for (let row = 0; row < stations.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments;
    triangles.push(a, b, b + segments, a, b + segments, a + segments);
  }
  const bottom = positions.length / 3;
  positions.push(0, 0, stations[0].z);
  const top = positions.length / 3;
  positions.push(0, 0, stations.at(-1).z);
  const offset = (stations.length - 1) * segments;
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    triangles.push(bottom, next, i, top, offset + i, offset + next);
  }
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(positions), triVerts: new Uint32Array(triangles) });
  try { return new wasm.Manifold(mesh); } finally { mesh.delete?.(); }
}

// A sphere triangulation is inscribed. Scale by its measured inradius so the
// erosion polyhedron CONTAINS the requested thickness ball, including at edges.
function erosionKernel(wasm, thickness) {
  const sphere = wasm.Manifold.sphere(1, 8);
  try {
    const mesh = sphere.getMesh();
    try {
      let inradius = Infinity;
      const v = index => Array.from(mesh.vertProperties.slice(index * mesh.numProp, index * mesh.numProp + 3));
      for (let i = 0; i < mesh.triVerts.length; i += 3) {
        const [a, b, c] = Array.from(mesh.triVerts.slice(i, i + 3), v);
        const u = b.map((value, k) => value - a[k]), w = c.map((value, k) => value - a[k]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        inradius = Math.min(inradius, Math.abs(a.reduce((sum, value, k) => sum + value * n[k], 0)) / Math.hypot(...n));
      }
      if (!Number.isFinite(inradius) || inradius <= 0) throw new Error('Vase wall kernel could not be constructed.');
      return sphere.scale(thickness / inradius * 1.00001);
    } finally { mesh.delete?.(); }
  } finally { sphere.delete(); }
}

export default function build(p, { wasm }) {
  const { rings, segments, height, diameter } = sampleVaseEnvelope(p);
  const wall = dimension(p, 'wall_mm', 0.8, 4);
  const base = dimension(p, 'base_mm', 0.8, 6);
  if (!['solid', 'hollow'].includes(p.construction)) throw new RangeError('Choose a solid or hollow vase construction.');
  const temps = [];
  const keep = solid => { temps.push(solid); return solid; };
  try {
    const rawOuter = keep(envelope(wasm, rings, segments, height));
    const outer = keep(rawOuter.simplify(1e-6));
    if (outer.status() !== 'NoError') throw new Error('The vase envelope could not be built. Try milder shape settings.');
    let result;
    if (p.construction === 'solid') result = outer.translate([0, 0, 0]);
    else {
      const rawExtended = keep(envelope(wasm, rings, segments, height, wall * 3));
      // Manifold bounds every moved surface by this tolerance. Increase the
      // erosion radius by the same amount so simplification cannot thin walls.
      const cavityTolerance = 0.2;
      const extended = keep(rawExtended.simplify(cavityTolerance));
      if (extended.numTri() > 16000) {
        throw new RangeError('This hollow vase is too detailed. Reduce pattern frequency, twist, or organic displacement, or choose solid slicer vase mode.');
      }
      const kernel = keep(erosionKernel(wasm, wall + cavityTolerance + 0.00001));
      const eroded = keep(extended.minkowskiDifference(kernel));
      const regionCube = keep(wasm.Manifold.cube([diameter * 3, diameter * 3, height + wall * 4]));
      const region = keep(regionCube.translate([-diameter * 1.5, -diameter * 1.5, base]));
      const cavity = keep(eroded.intersect(region));
      const pieces = cavity.decompose();
      const mouth = cavity.slice(height);
      try {
        if (cavity.isEmpty() || pieces.length !== 1 || mouth.area() < Math.PI * 4) {
          throw new RangeError('The hollow vase has a closed or narrow cavity. Widen the neck, reduce wall thickness, or reduce relief.');
        }
      } finally { mouth.delete(); pieces.forEach(piece => piece.delete()); }
      const shell = keep(outer.subtract(cavity));
      if (shell.status() !== 'NoError' || shell.isEmpty()) throw new Error('The hollow vase could not be built. Try milder settings.');
      result = shell.translate([0, 0, 0]);
    }
    return {
      solids: [{ name: p.construction === 'solid' ? 'Vase solid · spiral print' : 'Vase hollow · normal print', color: p.color, solid: result }],
      filenameBase: `vase-${p.construction}-${p.pattern}`,
      ...(p.construction === 'solid' ? { slicerSettings: {
        spiral_mode: '1', top_shell_layers: '0', top_shell_thickness: '0',
        bottom_shell_layers: '6', bottom_shell_thickness: '1.2', layer_height: '0.2',
        wall_loops: '1', line_width: '0.45', sparse_infill_density: '0%',
      } } : {}),
      warnings: [
        p.construction === 'solid'
          ? 'Solid slicer input: enable spiral/vase mode, no top layers or infill, and suitable bottom layers. Planning volume describes the solid input, not spiral material use.'
          : 'Modeled walls and base: print normally with spiral/vase mode off. Wall erosion may make local walls thicker than the selected minimum.',
        'Inspect sliced layers for steep overhangs, thin relief, bed fit, and unsupported regions. Print quality and water retention depend on printer and material; neither is certified.',
      ],
    };
  } finally { temps.reverse().forEach(solid => solid.delete()); }
}
