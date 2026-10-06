// Shared, dependency-free mesh metrics used by the browser and the server.
// Files are untrusted: every parser reports failures as ModelAnalysisError codes.

export class ModelAnalysisError extends Error {
  constructor(code, detail = code) {
    super(detail);
    this.name = "ModelAnalysisError";
    this.code = code;
  }
}

export const MODEL_ANALYSIS_LIMITS = Object.freeze({
  maxModelBytes: 25 * 1024 * 1024,
  maxTriangles: 1_500_000,
  maxInstancedTriangles: 4_000_000,
  maxZipEntries: 256,
  maxZipUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlNodes: 4_000_000,
  maxModelParts: 16,
  maxPackParts: 16,
  maxObjects: 10_000,
  maxComponentDepth: 8
});

export function resolveModelLimits(overrides = {}) {
  const limits = { ...MODEL_ANALYSIS_LIMITS };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (Object.hasOwn(MODEL_ANALYSIS_LIMITS, key) && Number.isFinite(Number(value)) && Number(value) > 0) limits[key] = Number(value);
  }
  return Object.freeze(limits);
}

/** Streaming accumulator: bounds, signed volume, and area without retaining vertices. */
export function createMeshAccumulator() {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  let triangles = 0; let degenerate = 0; let areaTwice = 0;
  let instanceVolume6 = 0; let totalVolume6 = 0; let signedTotal6 = 0; let instances = 0;
  const bound = (x, y, z) => {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) throw new ModelAnalysisError("invalid_number", "A vertex coordinate is not a finite number.");
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };
  return {
    beginInstance() { instanceVolume6 = 0; },
    endInstance() { totalVolume6 += Math.abs(instanceVolume6); signedTotal6 += instanceVolume6; instances += 1; instanceVolume6 = 0; },
    add(ax, ay, az, bx, by, bz, cx, cy, cz) {
      bound(ax, ay, az); bound(bx, by, bz); bound(cx, cy, cz);
      const ux = bx - ax; const uy = by - ay; const uz = bz - az;
      const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      const twiceArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!(twiceArea > 1e-12)) degenerate += 1;
      areaTwice += twiceArea;
      instanceVolume6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      triangles += 1;
    },
    get triangles() { return triangles; },
    result() {
      if (!triangles) throw new ModelAnalysisError("no_geometry", "The model contains no triangles.");
      const round = value => Math.round(value * 1000) / 1000;
      return {
        triangleCount: triangles,
        instanceCount: instances,
        boundsMm: { min: [round(minX), round(minY), round(minZ)], max: [round(maxX), round(maxY), round(maxZ)] },
        dimensionsMm: [round(maxX - minX), round(maxY - minY), round(maxZ - minZ)],
        volumeMm3: round(totalVolume6 / 6),
        signedVolumeMm3: round(signedTotal6 / 6),
        surfaceAreaMm2: round(areaTwice / 2),
        degenerateTriangles: degenerate
      };
    }
  };
}
