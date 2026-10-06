import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip } from "../support/zip-fixtures.mjs";

// A closed 10 mm cube as ASCII STL (12 triangles).
const cube = name => {
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const facets = f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n");
  return `solid ${name}\n${facets}\nendsolid ${name}\n`;
};

async function harness(zipBytes) {
  const root = await mkdtemp(join(tmpdir(), "pack-analysis-"));
  const fileStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const repository = createLocalPrintRepository({ path: join(root, "state.json"), workLookup: async () => null });
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts: { materialCost: async () => ({ source: "fallback", landedCentsPerKg: 2000 }) }, limits: serverModelLimits() });
  const created = await useCases.create({});
  // The browser PUTs to the signed URL; here the same bytes are written straight to the authorized path.
  const upload = async bytes => {
    const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: bytes.length, contentType: "application/zip" });
    await fileStore.put((await repository.findAsset(auth.assetId)).blobPath, bytes);
    return auth.assetId;
  };
  const assetId = await upload(zipBytes);
  return { root, fileStore, repository, useCases, created, assetId, upload, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("a ZIP upload is authorized and analyzed into measured child parts", async () => {
  const zip = buildZip([{ name: "stl/", data: "" }, { name: "stl/a.stl", data: cube("a"), method: "deflate" }, { name: "stl/b.stl", data: cube("b"), method: "deflate" }, { name: "views/1.png", data: "png" }]);
  const h = await harness(zip);
  try {
    const first = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(first.status, "pack");
    assert.deepEqual(first.pack.parts.map(part => [part.name, part.format, part.state, part.quantity, part.selected]), [["stl/a.stl", "stl", "ready", 1, false], ["stl/b.stl", "stl", "ready", 1, false]]);
    assert.deepEqual(first.pack.parts[0].dimensionsMm, [10, 10, 10]);
    assert.deepEqual(first.pack.ignored, [{ name: "views/1.png", kind: "image" }]);
    assert.equal(JSON.stringify(first).includes("print-estimates/"), false, "no private paths in the public view");
    const second = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.deepEqual(second, first);
    assert.equal((await h.repository.listChildren(h.assetId)).length, 2, "re-analysis never duplicates children");
  } finally { await h.cleanup(); }
});

test("a refused archive fails the pack and stores no children", async () => {
  const zip = buildZip([{ name: "../evil.stl", data: cube("x") }]);
  const h = await harness(zip);
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "failed");
    assert.equal((await h.repository.listChildren(h.assetId)).length, 0);
    assert.equal((await h.repository.findAsset(h.assetId)).state, "failed");
  } finally { await h.cleanup(); }
});

test("one corrupt part is reported unavailable without sinking the pack", async () => {
  const zip = buildZip([{ name: "good.stl", data: cube("g"), method: "deflate" }, { name: "bad.stl", data: "not a mesh", method: "deflate" }]);
  const h = await harness(zip);
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "pack");
    assert.deepEqual(result.pack.parts.map(part => [part.name, part.state]), [["bad.stl", "failed"], ["good.stl", "ready"]]);
  } finally { await h.cleanup(); }
});

test("a session cannot accumulate more than twice the pack part limit", async () => {
  const many = n => buildZip(Array.from({ length: n }, (_, i) => ({ name: `p${i}.stl`, data: cube(`p${i}`), method: "deflate" })));
  const h = await harness(many(16));
  try {
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: h.assetId })).status, "pack");
    const second = await h.upload(many(16));
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: second })).status, "pack", "32 parts is within 2 x 16");
    const third = await h.upload(many(1));
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: third })).status, "failed", "a 33rd part is refused");
    assert.equal((await h.repository.listChildren(third)).length, 0);
  } finally { await h.cleanup(); }
});

for (const [label, lie] of [["a wrong CRC", { crc: 1234 }], ["a wrong declared size", { declaredSize: 5 }]]) {
  test(`an entry with ${label} fails the whole pack and stores no children`, async () => {
    const zip = buildZip([{ name: "ok.stl", data: cube("ok"), method: "deflate" }, { name: "liar.stl", data: cube("liar"), method: "deflate", ...lie }]);
    const h = await harness(zip);
    try {
      const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
      assert.equal(result.status, "failed");
      assert.equal((await h.repository.listChildren(h.assetId)).length, 0);
      assert.equal((await h.repository.findAsset(h.assetId)).state, "failed");
      assert.deepEqual(await h.useCases.analyze({ ...h.created, assetId: h.assetId }), result, "re-analysis of a refused pack stays failed");
      assert.equal((await h.repository.listChildren(h.assetId)).length, 0);
    } finally { await h.cleanup(); }
  });
}

test("a ZIP cannot be finalized as a submission", async () => {
  const h = await harness(buildZip([{ name: "a.stl", data: cube("a") }]));
  try {
    await assert.rejects(h.useCases.analyze({ ...h.created, assetId: h.assetId }, { purpose: "submission" }), error => error.status === 400);
  } finally { await h.cleanup(); }
});
