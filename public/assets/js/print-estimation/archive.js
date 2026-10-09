import { modelFormat } from "./geometry.js?v=d34d74bea0b5707a";
import { ModelAnalysisError } from "./mesh.js?v=d34d74bea0b5707a";
import { readZipDirectory, readZipEntry } from "./three-mf.js?v=d34d74bea0b5707a";

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

/** Display label for an archive-supplied name: strips control, DEL, C1 and bidi characters, caps at 255. */
export const entryLabel = name => String(name).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 255);

/**
 * One label per model, in archive order, unique within the pack. Names that collapse to the same
 * label (a shared 255-character prefix, or a difference only in stripped characters) keep the
 * first label; a later one gets " (n)" with n starting at its 1-based archive position. Browser
 * and server both use this, so a local part name always maps to exactly one server part.
 */
export function uniqueEntryLabels(names) {
  const used = new Set();
  return names.map((name, index) => {
    let label = entryLabel(name);
    for (let n = index + 1; used.has(label); n++) {
      const suffix = ` (${n})`;
      label = `${entryLabel(name).slice(0, 255 - suffix.length)}${suffix}`;
    }
    used.add(label);
    return label;
  });
}

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
