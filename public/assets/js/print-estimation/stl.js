import { createMeshAccumulator, ModelAnalysisError } from "./mesh.js?v=fb2ab26d2511eeaf";

const stlLatin1 = new TextDecoder("latin1");
const STL_VERTEX = /\bvertex\s+(\S+)\s+(\S+)\s+(\S+)/g;

function stlLooksLikeText(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024));
  let printable = 0;
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  return printable / sample.length > 0.97;
}

/** Bounded binary/ASCII STL analysis. Coordinates are treated as millimetres. */
export function parseStl(bytes, limits) {
  if (!(bytes instanceof Uint8Array)) throw new ModelAnalysisError("malformed", "STL input must be bytes.");
  if (bytes.length < 15) throw new ModelAnalysisError("empty_file", "The STL file is empty or truncated.");
  if (bytes.length > limits.maxModelBytes) throw new ModelAnalysisError("too_large", "The STL file exceeds the size limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  const binaryExact = declared >= 0 && 84 + declared * 50 === bytes.length;
  const header = stlLatin1.decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  const mesh = createMeshAccumulator();
  if (!binaryExact && /^\s*solid\b/i.test(header) && stlLooksLikeText(bytes)) {
    const source = stlLatin1.decode(bytes);
    const coordinates = [];
    STL_VERTEX.lastIndex = 0;
    mesh.beginInstance();
    for (let match = STL_VERTEX.exec(source); match; match = STL_VERTEX.exec(source)) {
      coordinates.push(Number(match[1]), Number(match[2]), Number(match[3]));
      if (coordinates.length === 9) {
        if (mesh.triangles >= limits.maxTriangles) throw new ModelAnalysisError("too_many_triangles", "The STL has more triangles than the analysis limit.");
        mesh.add(...coordinates);
        coordinates.length = 0;
      }
    }
    if (coordinates.length) throw new ModelAnalysisError("malformed", "An ASCII STL facet is incomplete.");
    mesh.endInstance();
    return { format: "stl", encoding: "ascii", unit: "millimeter", unitAssumed: true, ...mesh.result() };
  }
  if (!binaryExact) throw new ModelAnalysisError("malformed", declared >= 0 ? `Binary STL declares ${declared} triangles but its length does not match.` : "The STL header is truncated.");
  if (declared > limits.maxTriangles) throw new ModelAnalysisError("too_many_triangles", "The STL has more triangles than the analysis limit.");
  mesh.beginInstance();
  for (let index = 0, offset = 84; index < declared; index++, offset += 50) {
    mesh.add(
      view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true),
      view.getFloat32(offset + 24, true), view.getFloat32(offset + 28, true), view.getFloat32(offset + 32, true),
      view.getFloat32(offset + 36, true), view.getFloat32(offset + 40, true), view.getFloat32(offset + 44, true)
    );
  }
  mesh.endInstance();
  return { format: "stl", encoding: "binary", unit: "millimeter", unitAssumed: true, ...mesh.result() };
}
