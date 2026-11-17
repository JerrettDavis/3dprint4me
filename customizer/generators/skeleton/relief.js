export function reliefSolid(s, { width, height, columns, rows, bounds, surface, gridFloor = false }) {
  const { Manifold, Mesh } = s.wasm, stride = columns + 1;
  const vertices = [], triangles = [];
  for (let j = 0; j <= rows; j++) {
    const y = j / rows - 0.5, [left, right] = bounds(y);
    for (let i = 0; i <= columns; i++) {
      const x = left + (right - left) * i / columns;
      vertices.push(x * width, y * height, surface(x, y));
      if (j < rows && i < columns) {
        const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
        triangles.push(a, b, c, b, d, c);
      }
    }
  }
  const boundary = [];
  for (let i = 0; i <= columns; i++) boundary.push(i);
  for (let j = 1; j <= rows; j++) boundary.push(j * stride + columns);
  for (let i = columns - 1; i >= 0; i--) boundary.push(rows * stride + i);
  for (let j = rows - 1; j > 0; j--) boundary.push(j * stride);
  const floorStart = vertices.length / 3;
  if (gridFloor) {
    for (let k = 0; k < floorStart; k++) vertices.push(vertices[k * 3], vertices[k * 3 + 1], 0);
    const topCount = triangles.length;
    for (let i = 0; i < topCount; i += 3) triangles.push(floorStart + triangles[i], floorStart + triangles[i + 2], floorStart + triangles[i + 1]);
  } else for (const k of boundary) vertices.push(vertices[k * 3], vertices[k * 3 + 1], 0);
  const center = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let i = 0; i < boundary.length; i++) {
    const next = (i + 1) % boundary.length;
    const a = boundary[i], b = boundary[next], c = floorStart + (gridFloor ? a : i), d = floorStart + (gridFloor ? b : next);
    triangles.push(a, c, b, b, c, d);
    if (!gridFloor) triangles.push(center, d, c);
  }
  const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(vertices), triVerts: new Uint32Array(triangles) });
  try { return s.t(Manifold.ofMesh(mesh)); } finally { mesh.delete?.(); }
}
