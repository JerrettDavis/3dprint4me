// Binary STL from a built model's parts. STL has no colors or part names, so every part (the
// pumpkin, its stem, a face inlay, a bowl's lid) becomes one combined mesh, each part keeping the
// position it has on the plate. Use the 3MF when you need the separate colored parts.
const HEADER = "3dprint4.me customizer";

export function partsToStl(parts) {
  let count = 0;
  for (const part of parts) count += part.mesh.triangles.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  for (let i = 0; i < HEADER.length; i++) view.setUint8(i, HEADER.charCodeAt(i));
  view.setUint32(80, count, true);
  let offset = 84;
  for (const { mesh } of parts) {
    const v = mesh.vertices;
    for (const [a, b, c] of mesh.triangles) {
      const A = v[a], B = v[b], C = v[c];
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const value of [nx, ny, nz, ...A, ...B, ...C]) { view.setFloat32(offset, value, true); offset += 4; }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** The STL file name for a 3MF file name. */
export const stlFilename = name => String(name ?? "model.3mf").replace(/\.3mf$/i, "") + ".stl";
