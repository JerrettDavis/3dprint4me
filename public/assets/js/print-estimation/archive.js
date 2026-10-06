import { modelFormat } from "./geometry.js?v=4eed843a69c17184";
import { ModelAnalysisError } from "./mesh.js?v=4eed843a69c17184";
import { readZipDirectory, readZipEntry } from "./three-mf.js?v=4eed843a69c17184";

// Shared, dependency-free ZIP model-pack inspector (browser and server run the same rules).
// Entries are untrusted: only the central directory is believed, only STL/3MF entries are
// inflated (each with a hard output bound), and the first violation fails the whole archive.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) c = CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const KINDS = [
  ["image", /\.(png|jpe?g|gif|webp|svg|bmp)$/i],
  ["document", /\.(md|txt|pdf|docx?|rtf)$/i],
  ["source", /\.(scad|step|stp|f3d|fcstd|py|js|json|ini|gcode)$/i],
  ["archive", /\.(zip|7z|rar|gz|tgz|tar|bz2)$/i]
];
export function archiveEntryKind(name) {
  return KINDS.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";
}
export const isArchiveName = name => /\.zip$/i.test(String(name ?? ""));

/** `inflateRaw(bytes, maxOutput)` must enforce maxOutput (Node `zlib` or browser DecompressionStream). */
export async function inspectArchive({ bytes, limits, inflateRaw }) {
  if (!(bytes instanceof Uint8Array)) throw new ModelAnalysisError("malformed", "Archive input must be bytes.");
  const entries = [...readZipDirectory(bytes, limits).values()];
  let declared = 0;
  const candidates = [];
  const ignored = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    declared += entry.uncompressedSize;
    if (declared > limits.maxZipUncompressedBytes) throw new ModelAnalysisError("zip_limit", "The archive expands beyond the analysis limit.");
    if (entry.special) { ignored.push({ name: entry.name.slice(0, 255), kind: "special" }); continue; }
    const format = modelFormat(entry.name);
    if (!format) { ignored.push({ name: entry.name.slice(0, 255), kind: archiveEntryKind(entry.name) }); continue; }
    if (entry.uncompressedSize > limits.maxModelBytes) throw new ModelAnalysisError("zip_limit", "A model in the archive exceeds the size limit.");
    candidates.push({ entry, format });
  }
  if (!candidates.length) throw new ModelAnalysisError("no_models", "The archive contains no STL or 3MF models.");
  if (candidates.length > limits.maxPackParts) throw new ModelAnalysisError("too_many_parts", `The archive has ${candidates.length} models; the limit is ${limits.maxPackParts}.`);
  const ranges = candidates.map(({ entry }) => [entry.localOffset, entry.localOffset + entry.compressedSize]).sort((x, y) => x[0] - y[0]);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index][0] < ranges[index - 1][1] || ranges[index][0] === ranges[index - 1][0]) throw new ModelAnalysisError("malformed", "Archive entries share data.");
  }
  const budget = { remaining: limits.maxZipUncompressedBytes };
  const models = [];
  for (const [index, { entry, format }] of candidates.entries()) {
    const data = await readZipEntry(bytes, entry, budget, limits, inflateRaw);
    if (crc32(data) !== entry.crc32) throw new ModelAnalysisError("malformed", "An archive entry failed its checksum.");
    models.push({ index, name: entry.name, format, bytes: data });
  }
  return { models, ignored };
}
