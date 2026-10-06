import assert from "node:assert/strict";
import test from "node:test";

import { archiveEntryKind, crc32, inspectArchive, isArchiveName } from "../../public/assets/js/print-estimation/archive.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { nodeInflateRaw, serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip, UNIX_MADE_BY, unixMode } from "../support/zip-fixtures.mjs";

const limits = resolveModelLimits();
const inspect = (bytes, overrides = {}) => inspectArchive({ bytes, limits: resolveModelLimits(overrides), inflateRaw: nodeInflateRaw });
const stl = (name, extra = {}) => ({ name, data: `solid ${name}\nendsolid ${name}`, method: "deflate", ...extra });

test("a clean pack yields its models and lists everything else as ignored", async () => {
  const bytes = buildZip([
    { name: "stl/", data: "" }, stl("stl/base.stl"), stl("stl/lid.STL"),
    { name: "views/1.png", data: "png" }, { name: "ASSEMBLY.md", data: "# hi" }, { name: "pack.scad", data: "cube(1);" }, { name: "inner.zip", data: "PK" }
  ]);
  const { models, ignored } = await inspect(bytes);
  assert.deepEqual(models.map(model => [model.index, model.name, model.format]), [[0, "stl/base.stl", "stl"], [1, "stl/lid.STL", "stl"]]);
  assert.deepEqual(ignored.map(entry => [entry.name, entry.kind]), [["views/1.png", "image"], ["ASSEMBLY.md", "document"], ["pack.scad", "source"], ["inner.zip", "archive"]]);
  assert.match(new TextDecoder().decode(models[0].bytes), /solid stl\/base\.stl/);
});

test("symlinks and special files are skipped, never extracted", async () => {
  const bytes = buildZip([stl("ok.stl"), { name: "link.stl", data: "target", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o120777) }]);
  const { models, ignored } = await inspect(bytes);
  assert.deepEqual(models.map(model => model.name), ["ok.stl"]);
  assert.deepEqual(ignored, [{ name: "link.stl", kind: "special" }]);
});

const refusals = [
  ["parent traversal", () => buildZip([stl("../evil.stl")]), "zip_unsafe_path"],
  ["absolute path", () => buildZip([stl("/abs.stl")]), "zip_unsafe_path"],
  ["backslash path", () => buildZip([stl("a\\b.stl")]), "zip_unsafe_path"],
  ["drive letter", () => buildZip([stl("C:evil.stl")]), "zip_unsafe_path"],
  ["dot segment", () => buildZip([stl("a/./b.stl")]), "zip_unsafe_path"],
  ["control character", () => buildZip([stl("a\u0000.stl")]), "zip_unsafe_path"],
  ["duplicate by case", () => buildZip([stl("a.stl"), stl("A.stl")]), "zip_duplicate"],
  ["encrypted entry", () => buildZip([stl("a.stl", { flags: 1 })]), "zip_encrypted"],
  ["no models", () => buildZip([{ name: "readme.md", data: "x" }]), "no_models"],
  ["crc mismatch", () => buildZip([stl("a.stl", { crc: 1 })]), "malformed"],
  ["declared size too small (bomb liar)", () => buildZip([{ name: "a.stl", data: "x".repeat(5000), method: "deflate", declaredSize: 10 }]), "zip_limit"],
  // The 3-byte stream against a 4000-byte declaration trips the compression-ratio guard (zip_limit)
  // before the size-mismatch check (malformed); both refuse the whole archive, which is the requirement.
  ["declared size too large", () => buildZip([{ name: "a.stl", data: "abc", method: "deflate", declaredSize: 4000 }]), "zip_limit"],
  ["compression-ratio bomb", () => buildZip([{ name: "a.stl", data: Buffer.alloc(12 * 1024 * 1024), method: "deflate" }]), "zip_limit"],
  ["truncated archive", () => buildZip([stl("a.stl")]).slice(0, -12), "malformed"]
];
for (const [label, build, code] of refusals) {
  test(`refuses the whole archive: ${label}`, async () => {
    await assert.rejects(inspect(build()), error => error.name === "ModelAnalysisError" && error.code === code, label);
  });
}

test("entry-count, part-count, model-size and total-expansion limits", async () => {
  const many = Array.from({ length: 257 }, (_, index) => ({ name: `p${index}.stl`, data: "x" }));
  await assert.rejects(inspect(buildZip(many)), error => error.code === "zip_limit");
  const parts = Array.from({ length: 17 }, (_, index) => stl(`p${index}.stl`));
  await assert.rejects(inspect(buildZip(parts)), error => error.code === "too_many_parts");
  assert.equal((await inspect(buildZip(parts.slice(0, 16)))).models.length, 16);
  await assert.rejects(inspect(buildZip([stl("a.stl")]), { maxModelBytes: 5 }), error => error.code === "zip_limit");
  await assert.rejects(inspect(buildZip([stl("a.stl"), stl("b.stl")]), { maxZipUncompressedBytes: 40 }), error => error.code === "zip_limit");
});

test("crc32, kinds and archive names", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(archiveEntryKind("x.JPG"), "image");
  assert.equal(archiveEntryKind("x.bin"), "other");
  assert.equal(isArchiveName("Pack.ZIP"), true);
  assert.equal(isArchiveName("model.3mf"), false);
});

// Points the second central-directory entry at the first entry's local data.
function shareLocalData(zip) {
  const bytes = new Uint8Array(zip);
  const view = new DataView(bytes.buffer);
  let eocd = bytes.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const first = view.getUint32(view.getUint32(eocd + 16, true) + 42, true);
  let cursor = view.getUint32(eocd + 16, true);
  cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  view.setUint32(cursor + 42, first, true);
  return bytes;
}

test("entries that share local data are refused; a clean multi-model pack passes", async () => {
  const same = name => ({ name, data: "solid x endsolid x", method: "deflate" }); // identical payloads: sharing is only caught by the overlap rule, not CRC
  const entries = [same("a.stl"), same("b.stl"), same("c.stl")];
  assert.equal((await inspect(buildZip(entries))).models.length, 3);
  await assert.rejects(inspect(shareLocalData(buildZip(entries))), error => error.name === "ModelAnalysisError" && error.code === "malformed");
});

test("serverModelLimits caps and sanitises PRINT_ESTIMATE_MAX_PACK_PARTS", () => {
  const parts = value => serverModelLimits(value === undefined ? {} : { PRINT_ESTIMATE_MAX_PACK_PARTS: value }).maxPackParts;
  assert.equal(parts("100"), 32);
  assert.equal(parts("20.7"), 20);
  assert.equal(parts(undefined), 16);
  assert.equal(parts("0"), 16);
  assert.equal(parts("abc"), 16);
});
