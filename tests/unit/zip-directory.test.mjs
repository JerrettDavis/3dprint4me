import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { readZipDirectory } from "../../public/assets/js/print-estimation/three-mf.js";
import { buildZip, UNIX_MADE_BY, unixMode } from "../support/zip-fixtures.mjs";

const limits = resolveModelLimits();

test("directory entries expose crc, directory and special-file flags", () => {
  const bytes = buildZip([
    { name: "stl/", data: "" },
    { name: "stl/a.stl", data: "solid a", method: "deflate" },
    { name: "link.stl", data: "x", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o120777) },
    { name: "plain.stl", data: "y", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o100644) }
  ]);
  const entries = [...readZipDirectory(bytes, limits).values()];
  assert.deepEqual(entries.map(entry => [entry.name, entry.isDirectory, entry.special]), [
    ["stl/", true, false], ["stl/a.stl", false, false], ["link.stl", false, true], ["plain.stl", false, false]
  ]);
  assert.equal(typeof entries[1].crc32, "number");
});

test("names equal under case folding or Unicode normalization are duplicates", () => {
  for (const names of [["a.stl", "A.STL"], ["café.stl", "café.stl"]]) {
    assert.throws(() => readZipDirectory(buildZip(names.map(name => ({ name, data: "x" }))), limits), error => error.name === "ModelAnalysisError" && error.code === "zip_duplicate", names.join(" vs "));
  }
});
