import { package3mf } from "./three-mf.js";
import { redactSensitive } from "../../public/assets/js/customize/schema.js";

export function manifoldToMesh(manifold) {
  const mesh = manifold.getMesh();
  const vertices = new Array(mesh.numVert);
  for (let i = 0; i < mesh.numVert; i++) { const j = i * mesh.numProp; vertices[i] = [mesh.vertProperties[j], mesh.vertProperties[j + 1], mesh.vertProperties[j + 2]]; }
  const triangles = new Array(mesh.triVerts.length / 3);
  for (let i = 0, t = 0; i < mesh.triVerts.length; i += 3, t++) triangles[t] = [mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]];
  mesh.delete?.();
  return weldSlivers({ vertices, triangles });
}

// Boolean results are exported in float32, so two vertices a few millionths of a millimetre apart
// can land on the same printed coordinates and leave a zero-area fin (a triangle with two
// coincident corners). Merging such a pair and dropping the fin keeps the mesh closed (the fin's
// two long edges become one) and removes what the site's analyzer would call a degenerate triangle.
export function weldSlivers(mesh) {
  const { vertices, triangles } = mesh;
  // The 3MF writer prints six decimals, so that is the precision that matters.
  const q = v => Math.round(v * 1e6);
  const same = (a, b) => q(a[0]) === q(b[0]) && q(a[1]) === q(b[1]) && q(a[2]) === q(b[2]);
  let parent = null;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const slivers = [];
  triangles.forEach(([a, b, c], k) => {
    const A = vertices[a], B = vertices[b], C = vertices[c];
    if (a === b || b === c || a === c || same(A, B) || same(B, C) || same(A, C)) slivers.push(k);
  });
  if (!slivers.length) return mesh;
  parent = Array.from({ length: vertices.length }, (_, i) => i);
  const join = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry); };
  for (const k of slivers) {
    const [a, b, c] = triangles[k];
    if (same(vertices[a], vertices[b])) join(a, b);
    if (same(vertices[b], vertices[c])) join(b, c);
    if (same(vertices[a], vertices[c])) join(a, c);
  }
  const drop = new Set(slivers);
  const kept = [];
  triangles.forEach((tri, k) => {
    if (drop.has(k)) return;
    const [a, b, c] = tri.map(find);
    if (a !== b && b !== c && a !== c) kept.push([a, b, c]);
  });
  return { vertices, triangles: kept };
}

export const safeName = s => String(s || "custom").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";

const fail = (code, message) => Object.assign(new Error(message), { code });

// Accepts #rgb, #rrggbb, #rrggbbaa; returns lowercase #rrggbb or null.
function normalizeColor(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map(c => c + c).join("");
  return `#${h.slice(0, 6)}`;
}

export const MESH_CLEAN_TOLERANCE_MM = 1e-6;

const free = o => { try { o?.delete?.(); } catch { /* best effort */ } };

export async function buildModel(generator, params, ctx) {
  const built = await generator.build(params, ctx);
  const { solids = [], warnings = [], title = generator.title ?? generator.id, filenameBase = generator.id } = built;
  const shiftedCopies = [];
  try {
    if (!solids.length) throw fail("no-geometry", "The model has no geometry.");
    const colorOf = solids.map(s => {
      const c = normalizeColor(s.color);
      if (!c) throw fail("invalid-color", `Part "${s.name}" has an invalid color "${s.color}".`);
      return c;
    });
    const colors = new Set(colorOf);
    if (colors.size > 5) throw fail("too-many-colors", `The model uses ${colors.size} colors; at most 5 are supported.`);
    let minX = Infinity, minY = Infinity;
    for (const s of solids) { const b = s.solid.boundingBox(); minX = Math.min(minX, b.min[0]); minY = Math.min(minY, b.min[1]); }
    const delta = [-minX + 2, -minY + 2, 0];
    const parts = solids.map((s, i) => {
      const shifted = s.solid.translate(delta);
      shiftedCopies.push(shifted);
      // Boolean results can keep zero-area (collinear) triangles; the site's analyzer flags them
      // as "the mesh may need repair" on the order page. Collapsing edges within 1e-6 mm removes
      // them; surfaces may move by up to that tolerance (measured over every default and preset:
      // relative volume change <= 2e-7, bounds shift <= 1e-6 mm, genus unchanged).
      const clean = shifted.simplify(MESH_CLEAN_TOLERANCE_MM);
      shiftedCopies.push(clean);
      return { name: s.name, color: colorOf[i], mesh: manifoldToMesh(clean) };
    });
    let meta = generator.schema ? redactSensitive(generator, params) : { ...params };
    if (generator.publicParams) meta = generator.publicParams(meta);
    const parameters = { ...meta, template: `${generator.id}-v${generator.version ?? 1}`, generator: "browser/manifold-3d" };
    const data = package3mf(parts, { title, description: "Parametrically generated in-browser by 3dprint4.me.", parameters });
    return {
      data, parts, warnings,
      filename: `${safeName(filenameBase)}.3mf`,
      metrics: { part_count: parts.length, unique_colors: colors.size, triangles: parts.reduce((n, p) => n + p.mesh.triangles.length, 0) }
    };
  } finally {
    for (const c of shiftedCopies) free(c);
    for (const s of solids) free(s.solid);
  }
}
