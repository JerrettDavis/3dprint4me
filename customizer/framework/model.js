import { package3mf } from "./three-mf.js";

export function manifoldToMesh(manifold) {
  const mesh = manifold.getMesh();
  const vertices = new Array(mesh.numVert);
  for (let i = 0; i < mesh.numVert; i++) { const j = i * mesh.numProp; vertices[i] = [mesh.vertProperties[j], mesh.vertProperties[j + 1], mesh.vertProperties[j + 2]]; }
  const triangles = new Array(mesh.triVerts.length / 3);
  for (let i = 0, t = 0; i < mesh.triVerts.length; i += 3, t++) triangles[t] = [mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]];
  mesh.delete?.();
  return { vertices, triangles };
}

export const safeName = s => String(s || "custom").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";

export async function buildModel(generator, params, ctx) {
  const built = await generator.build(params, ctx);
  const { solids, warnings = [], title = generator.title ?? generator.id, filenameBase = generator.id } = built;
  if (!solids.length) throw new Error("The model has no geometry.");
  let minX = Infinity, minY = Infinity;
  for (const s of solids) { const b = s.solid.boundingBox(); minX = Math.min(minX, b.min[0]); minY = Math.min(minY, b.min[1]); }
  const delta = [-minX + 2, -minY + 2, 0];
  const parts = solids.map(s => {
    const shifted = s.solid.translate(delta);
    const mesh = manifoldToMesh(shifted);
    shifted.delete?.();
    return { name: s.name, color: s.color, mesh };
  });
  for (const s of solids) s.solid.delete?.();
  const colors = new Set(parts.map(p => String(p.color).toLowerCase()));
  if (colors.size > 5) throw new Error(`The model uses ${colors.size} colors; at most 5 are supported.`);
  const parameters = { ...params, template: `${generator.id}-v${generator.version ?? 1}`, generator: "browser/manifold-3d" };
  const data = package3mf(parts, { title, description: "Parametrically generated in-browser by 3dprint4.me.", parameters });
  return {
    data, parts, warnings,
    filename: `${filenameBase}.3mf`,
    metrics: { part_count: parts.length, unique_colors: colors.size, triangles: parts.reduce((n, p) => n + p.mesh.triangles.length, 0) }
  };
}
