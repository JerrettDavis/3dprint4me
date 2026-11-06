// Exact reference shell: worker-only, embedded compressed mesh keeps offline builds local.
import { gunzipSync } from 'fflate';
import { DATA, CROWN_DATA, REFERENCE } from './reference-data.js';
import { solidFromMesh } from './mesh.js';
export { REFERENCE };

const meshes = new Map();
function referenceMesh(data) {
  if (!meshes.has(data)) {
    const raw = gunzipSync(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const count = view.getUint32(0, true), triangles = view.getUint32(4, true);
    const pos = new Float32Array(count * 3), idx = new Uint32Array(triangles * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = view.getFloat32(8 + i * 4, true);
    for (let i = 0; i < idx.length; i++) idx[i] = view.getUint32(8 + pos.byteLength + i * 4, true);
    meshes.set(data, { pos, idx });
  }
  return meshes.get(data);
}

// Coordinates keep the socket at x=y=0; only the original base is translated to z=0.
export function referencePumpkin(wasm) {
  const original = solidFromMesh(wasm, referenceMesh(DATA), 'reference pumpkin');
  try { return original.translate([0, 0, -REFERENCE.minZ]); }
  finally { original.delete(); }
}

export function referenceCrown(wasm, clearance = 0.2) {
  const original = solidFromMesh(wasm, referenceMesh(CROWN_DATA), 'reference crown');
  const bore = wasm.Manifold.cylinder(18.95, 2.01, 2.01, 96);
  let filled;
  try {
    filled = original.add(bore);
    return filled.translate([0, 0, -REFERENCE.minZ + clearance]);
  } finally { original.delete(); bore.delete(); filled?.delete(); }
}
