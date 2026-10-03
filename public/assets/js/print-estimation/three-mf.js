import { createMeshAccumulator, ModelAnalysisError } from "./mesh.js?v=295d8d664ce2c0cd";

// 3MF is ZIP + XML. Only the model relationship and referenced model parts are
// expanded; thumbnails, metadata, and slicer settings are never decompressed.
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const THREE_MF_UNITS = Object.freeze({ micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 });
const THREE_MF_MODEL_REL = /3dmanufacturing\/2013\/01\/3dmodel$/;
const THREE_MF_SETTINGS = /^metadata\/(?:.*\.config|slic3r_pe.*|prusa.*|.*project_settings.*|.*model_settings.*|.*\.gcode)$/i;
const threeMfUtf8 = new TextDecoder("utf-8");
const THREE_MF_TAG = /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const THREE_MF_ATTRIBUTE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const THREE_MF_IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

function zipSafeName(name) {
  if (!name || name.length > 512 || /[\u0000-\u001f\\:]/.test(name) || name.startsWith("/")) return false;
  return !name.split("/").some(segment => segment === ".." || segment === ".");
}

/** Reads a ZIP central directory with hard limits. ZIP64, encryption, and traversal are refused. */
export function readZipDirectory(bytes, limits) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== ZIP_LOCAL) throw new ModelAnalysisError("malformed", "The 3MF container is not a ZIP archive.");
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset--) {
    if (view.getUint32(offset, true) === ZIP_EOCD) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ModelAnalysisError("malformed", "The 3MF archive directory is missing.");
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new ModelAnalysisError("zip_unsupported", "ZIP64 archives are not supported.");
  if (count > limits.maxZipEntries) throw new ModelAnalysisError("zip_limit", `The archive has ${count} entries; the limit is ${limits.maxZipEntries}.`);
  if (directoryOffset + directorySize > eocd) throw new ModelAnalysisError("malformed", "The archive directory is out of bounds.");
  const entries = new Map();
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || view.getUint32(cursor, true) !== ZIP_CENTRAL) throw new ModelAnalysisError("malformed", "An archive directory entry is invalid.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = threeMfUtf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!zipSafeName(name)) throw new ModelAnalysisError("zip_unsafe_path", "The archive contains an unsafe path.");
    if (flags & 0x1) throw new ModelAnalysisError("zip_encrypted", "Encrypted archive entries are not supported.");
    if (![0, 8].includes(method)) throw new ModelAnalysisError("zip_unsupported", `Compression method ${method} is not supported.`);
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) throw new ModelAnalysisError("zip_unsupported", "ZIP64 entries are not supported.");
    const key = name.toLowerCase();
    if (entries.has(key)) throw new ModelAnalysisError("malformed", "The archive contains duplicate entry names.");
    entries.set(key, { name, method, compressedSize, uncompressedSize, localOffset });
  }
  return entries;
}

async function readZipEntry(bytes, entry, budget, limits, inflateRaw) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.localOffset + 30 > bytes.length || view.getUint32(entry.localOffset, true) !== ZIP_LOCAL) throw new ModelAnalysisError("malformed", "An archive entry header is invalid.");
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  if (start + entry.compressedSize > bytes.length) throw new ModelAnalysisError("malformed", "An archive entry is truncated.");
  if (entry.uncompressedSize > budget.remaining) throw new ModelAnalysisError("zip_limit", "The archive expands beyond the analysis limit.");
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) throw new ModelAnalysisError("zip_limit", "An archive entry has an unsafe compression ratio.");
  const data = bytes.subarray(start, start + entry.compressedSize);
  let output;
  if (entry.method === 0) output = data;
  else {
    try { output = await inflateRaw(data, entry.uncompressedSize); }
    catch (error) {
      if (error?.name === "ModelAnalysisError") throw error;
      throw new ModelAnalysisError("zip_limit", "An archive entry could not be expanded within its declared size.");
    }
  }
  if (output.length !== entry.uncompressedSize) throw new ModelAnalysisError("malformed", "An archive entry size does not match its directory.");
  budget.remaining -= output.length;
  return output;
}

function threeMfAttributes(source) {
  const attributes = {};
  THREE_MF_ATTRIBUTE.lastIndex = 0;
  for (let match = THREE_MF_ATTRIBUTE.exec(source); match; match = THREE_MF_ATTRIBUTE.exec(source)) {
    const name = match[1].includes(":") ? match[1].split(":").pop() : match[1];
    attributes[name] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function threeMfXmlText(bytes) {
  const xml = threeMfUtf8.decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ModelAnalysisError("xml_forbidden", "3MF XML must not declare a DTD or entities.");
  return xml;
}

function parseThreeMfTransform(value) {
  if (value == null || value === "") return THREE_MF_IDENTITY;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some(part => !Number.isFinite(part))) throw new ModelAnalysisError("malformed", "A 3MF transform is invalid.");
  return parts;
}

/** Row-vector 3MF matrices: apply `inner` first, then `outer`. */
function composeThreeMfTransforms(inner, outer) {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11] = inner;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11] = outer;
  return [
    a0 * b0 + a1 * b3 + a2 * b6, a0 * b1 + a1 * b4 + a2 * b7, a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6, a3 * b1 + a4 * b4 + a5 * b7, a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6, a6 * b1 + a7 * b4 + a8 * b7, a6 * b2 + a7 * b5 + a8 * b8,
    a9 * b0 + a10 * b3 + a11 * b6 + b9, a9 * b1 + a10 * b4 + a11 * b7 + b10, a9 * b2 + a10 * b5 + a11 * b8 + b11
  ];
}

/** Parses one 3MF model part into objects and build items with bounded node counts. */
export function parseThreeMfModelXml(xml, counters, limits) {
  const objects = new Map();
  const items = [];
  let unit = "millimeter";
  let current = null;
  let inBuild = false;
  THREE_MF_TAG.lastIndex = 0;
  for (let match = THREE_MF_TAG.exec(xml); match; match = THREE_MF_TAG.exec(xml)) {
    counters.nodes += 1;
    if (counters.nodes > limits.maxXmlNodes) throw new ModelAnalysisError("too_complex", "The 3MF XML exceeds the node limit.");
    const closing = match[1] === "/";
    const tag = match[2];
    if (closing) {
      if (tag === "object") current = null;
      else if (tag === "build") inBuild = false;
      continue;
    }
    if (tag === "vertex" && current) {
      const { x, y, z } = threeMfAttributes(match[3]);
      const values = [Number(x), Number(y), Number(z)];
      if (values.some(value => !Number.isFinite(value))) throw new ModelAnalysisError("invalid_number", "A 3MF vertex is not numeric.");
      current.vertices.push(values[0], values[1], values[2]);
    } else if (tag === "triangle" && current) {
      const { v1, v2, v3 } = threeMfAttributes(match[3]);
      const indices = [Number(v1), Number(v2), Number(v3)];
      if (indices.some(index => !Number.isInteger(index) || index < 0)) throw new ModelAnalysisError("malformed", "A 3MF triangle index is invalid.");
      counters.triangles += 1;
      if (counters.triangles > limits.maxTriangles) throw new ModelAnalysisError("too_many_triangles", "The 3MF has more triangles than the analysis limit.");
      current.triangles.push(indices[0], indices[1], indices[2]);
    } else if (tag === "object") {
      const attributes = threeMfAttributes(match[3]);
      counters.objects += 1;
      if (counters.objects > limits.maxObjects) throw new ModelAnalysisError("too_complex", "The 3MF has too many objects.");
      current = { id: attributes.id, type: attributes.type || "model", vertices: [], triangles: [], components: [] };
      if (!current.id) throw new ModelAnalysisError("malformed", "A 3MF object is missing its id.");
      objects.set(current.id, current);
      if (match[4] === "/") current = null;
    } else if (tag === "component" && current) {
      const attributes = threeMfAttributes(match[3]);
      current.components.push({ objectId: attributes.objectid, transform: parseThreeMfTransform(attributes.transform), path: attributes.path || null });
    } else if (tag === "build") {
      inBuild = match[4] !== "/";
    } else if (tag === "item" && inBuild) {
      const attributes = threeMfAttributes(match[3]);
      items.push({ objectId: attributes.objectid, transform: parseThreeMfTransform(attributes.transform), path: attributes.path || null });
    } else if (tag === "model") {
      const attributes = threeMfAttributes(match[3]);
      unit = attributes.unit || "millimeter";
      if (!Object.hasOwn(THREE_MF_UNITS, unit)) throw new ModelAnalysisError("malformed", "The 3MF unit is not supported.");
    }
  }
  for (const object of objects.values()) {
    const vertexCount = object.vertices.length / 3;
    for (const index of object.triangles) if (index >= vertexCount) throw new ModelAnalysisError("malformed", "A 3MF triangle references a missing vertex.");
  }
  return { objects, items, unit };
}

function normalizePartPath(path) {
  const cleaned = String(path).replace(/^\/+/, "");
  if (!zipSafeName(cleaned)) throw new ModelAnalysisError("zip_unsafe_path", "A 3MF part path is unsafe.");
  return cleaned.toLowerCase();
}

/** Bounded 3MF geometry: units, components, and build-item transforms applied. */
export async function parseThreeMf(bytes, limits, inflateRaw) {
  if (!(bytes instanceof Uint8Array)) throw new ModelAnalysisError("malformed", "3MF input must be bytes.");
  if (bytes.length > limits.maxModelBytes) throw new ModelAnalysisError("too_large", "The 3MF file exceeds the size limit.");
  if (typeof inflateRaw !== "function") throw new ModelAnalysisError("zip_unsupported", "No bounded decompressor is available.");
  const entries = readZipDirectory(bytes, limits);
  const budget = { remaining: limits.maxZipUncompressedBytes };
  const read = async key => {
    const entry = entries.get(key);
    if (!entry) throw new ModelAnalysisError("malformed", `The 3MF part ${key} is missing.`);
    return readZipEntry(bytes, entry, budget, limits, inflateRaw);
  };
  let rootPath = "3d/3dmodel.model";
  if (entries.has("_rels/.rels")) {
    const rels = threeMfXmlText(await read("_rels/.rels"));
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      const attributes = threeMfAttributes(match[1]);
      if (THREE_MF_MODEL_REL.test(attributes.Type ?? "") && attributes.Target) { rootPath = normalizePartPath(attributes.Target); break; }
    }
  }
  const counters = { nodes: 0, triangles: 0, objects: 0 };
  const parts = new Map();
  const loadPart = async path => {
    if (parts.has(path)) return parts.get(path);
    if (parts.size >= limits.maxModelParts) throw new ModelAnalysisError("too_complex", "The 3MF references too many model parts.");
    const parsed = parseThreeMfModelXml(threeMfXmlText(await read(path)), counters, limits);
    parts.set(path, parsed);
    return parsed;
  };
  const root = await loadPart(rootPath);
  const scale = THREE_MF_UNITS[root.unit];
  const mesh = createMeshAccumulator();
  let instanced = 0;
  const instantiate = async (partPath, objectId, transform, depth) => {
    if (depth > limits.maxComponentDepth) throw new ModelAnalysisError("too_complex", "3MF components are nested too deeply.");
    const part = await loadPart(partPath);
    const object = part.objects.get(String(objectId));
    if (!object) throw new ModelAnalysisError("malformed", "A 3MF build item references a missing object.");
    if (object.triangles.length) {
      instanced += object.triangles.length / 3;
      if (instanced > limits.maxInstancedTriangles) throw new ModelAnalysisError("too_complex", "The 3MF build expands beyond the triangle limit.");
      const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] = transform;
      const v = object.vertices;
      const point = index => {
        const x = v[index * 3]; const y = v[index * 3 + 1]; const z = v[index * 3 + 2];
        return [(x * m0 + y * m3 + z * m6 + m9) * scale, (x * m1 + y * m4 + z * m7 + m10) * scale, (x * m2 + y * m5 + z * m8 + m11) * scale];
      };
      mesh.beginInstance();
      for (let index = 0; index < object.triangles.length; index += 3) {
        const a = point(object.triangles[index]); const b = point(object.triangles[index + 1]); const c = point(object.triangles[index + 2]);
        mesh.add(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
      mesh.endInstance();
    }
    for (const component of object.components) {
      await instantiate(component.path ? normalizePartPath(component.path) : partPath, component.objectId, composeThreeMfTransforms(component.transform, transform), depth + 1);
    }
  };
  const buildItems = root.items.length ? root.items : [...root.objects.values()].filter(object => object.type === "model").map(object => ({ objectId: object.id, transform: THREE_MF_IDENTITY, path: null }));
  for (const item of buildItems) await instantiate(item.path ? normalizePartPath(item.path) : rootPath, item.objectId, item.transform, 0);
  const embeddedSlicerSettings = [...entries.values()].some(entry => THREE_MF_SETTINGS.test(entry.name));
  return {
    format: "3mf", unit: root.unit, unitAssumed: false, buildItemCount: root.items.length, noBuildItems: root.items.length === 0,
    objectCount: counters.objects, modelParts: parts.size, embeddedSlicerSettings, ...mesh.result()
  };
}
