// Wraps flat position/index arrays (from pumpkin-shape.js or stem.js) as a Manifold. The mesh
// constructor checks topology only, so a folded surface would pass: the builder's nesting check
// (cavity must stay inside the outer) and the extremes tests are what catch that.
export function solidFromMesh(wasm, { pos, idx }, what = "pumpkin") {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: pos, triVerts: idx });
  let solid;
  try { solid = new wasm.Manifold(mesh); } finally { mesh.delete?.(); }
  if (solid.status() !== "NoError") {
    solid.delete();
    throw new Error(`The ${what} shape can't be built with these settings. Try milder values for the shape, twist or groove settings.`);
  }
  return solid;
}
