import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = name => {
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const facets = f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n");
  return `solid ${name}\n${facets}\nendsolid ${name}\n`;
};
const twoPart = () => buildZip([{ name: "a.stl", data: cube("a"), method: "deflate" }, { name: "b.stl", data: cube("b"), method: "deflate" }]);

async function harness(zipBytes, { wrapStore = s => s, wrapRepo = r => r } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pack-recovery-"));
  const baseStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const statePath = join(root, "state.json");
  const baseRepo = createLocalPrintRepository({ path: statePath, workLookup: async () => null });
  const logged = [];
  const fileStore = wrapStore(baseStore);
  const repository = wrapRepo(baseRepo);
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts: { materialCost: async () => ({ source: "fallback", landedCentsPerKg: 2000 }) }, limits: serverModelLimits(), logFailure: code => logged.push(code) });
  const created = await useCases.create({});
  const upload = async bytes => {
    const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: bytes.length, contentType: "application/zip" });
    await baseStore.put((await baseRepo.findAsset(auth.assetId)).blobPath, bytes);
    return auth.assetId;
  };
  const assetId = await upload(zipBytes);
  return { root, statePath, baseStore, baseRepo, repository, fileStore, useCases, created, assetId, upload, logged, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("concurrent analysis of one ZIP succeeds once, conflicts once, and never duplicates children", async () => {
  const h = await harness(twoPart());
  try {
    const results = await Promise.allSettled([h.useCases.analyze({ ...h.created, assetId: h.assetId }), h.useCases.analyze({ ...h.created, assetId: h.assetId })]);
    const ok = results.filter(r => r.status === "fulfilled");
    const bad = results.filter(r => r.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(ok[0].value.status, "pack");
    assert.equal(bad.length, 1);
    assert.equal(bad[0].reason.status, 409);
    assert.equal((await h.baseRepo.listChildren(h.assetId)).length, 2);
  } finally { await h.cleanup(); }
});

test("a stale analyzing claim is recovered: leftovers removed and the pack re-extracted", async () => {
  const h = await harness(twoPart());
  try {
    await h.baseRepo.markAssetUploaded(h.assetId, 1);
    assert.ok(await h.baseRepo.claimPackAnalysis(h.assetId));
    assert.equal(await h.baseRepo.claimPackAnalysis(h.assetId), null, "a fresh claim is not stealable");
    const session = (await h.baseRepo.findAsset(h.assetId)).sessionId;
    const leftovers = [];
    for (const n of [1, 2]) {
      const blobPath = `print-estimates/${session}/bbbbbbbbb${n}-part${n}.stl`;
      await h.baseStore.put(blobPath, new TextEncoder().encode(cube(`l${n}`)));
      leftovers.push(await h.baseRepo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session, blobPath, originalName: `l${n}.stl`, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: null, parentAssetId: h.assetId, archiveEntry: `l${n}.stl` }));
    }
    await assert.rejects(h.useCases.analyze({ ...h.created, assetId: h.assetId }), error => error.status === 409);
    const state = JSON.parse(await readFile(h.statePath, "utf8"));
    state.assets.find(row => row.id === h.assetId).updatedAt = new Date(Date.now() - 3_600_000).toISOString();
    await writeFile(h.statePath, JSON.stringify(state));
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "pack");
    const children = await h.baseRepo.listChildren(h.assetId);
    assert.deepEqual(children.map(child => child.archiveEntry), ["a.stl", "b.stl"]);
    for (const leftover of leftovers) {
      assert.equal(await h.baseRepo.findAsset(leftover.id), null, "leftover record removed");
      assert.equal(await h.baseStore.inspect(leftover.blobPath).catch(() => null), null, "leftover blob removed");
    }
  } finally { await h.cleanup(); }
});

test("a put failure on the second part removes the first part and fails the pack", async () => {
  const puts = [];
  const deletes = [];
  const wrapStore = store => ({ ...store, async put(path, bytes) { if (path.includes("-part")) { puts.push(path); if (puts.length === 2) throw new Error("disk full"); } return store.put(path, bytes); }, async delete(path) { deletes.push(path); return store.delete(path); } });
  const h = await harness(twoPart(), { wrapStore });
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "failed");
    assert.equal((await h.baseRepo.listChildren(h.assetId)).length, 0);
    assert.equal((await h.baseRepo.findAsset(h.assetId)).state, "failed");
    assert.ok(deletes.includes(puts[0]), "first blob deleted");
    assert.equal(await h.baseStore.inspect(puts[0]).catch(() => null), null);
  } finally { await h.cleanup(); }
});

test("a createAsset failure after a successful put deletes that blob", async () => {
  let storedPath = null;
  const wrapStore = store => ({ ...store, async put(path, bytes) { if (path.includes("-part")) storedPath = path; return store.put(path, bytes); } });
  const wrapRepo = repo => ({ ...repo, createAsset: async asset => { if (asset.parentAssetId) throw new Error("db down"); return repo.createAsset(asset); } });
  const h = await harness(twoPart(), { wrapStore, wrapRepo });
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "failed");
    assert.ok(storedPath);
    assert.equal(await h.baseStore.inspect(storedPath).catch(() => null), null, "orphan blob removed");
  } finally { await h.cleanup(); }
});

test("a cleanup failure is logged by code only", async () => {
  let parts = 0;
  const wrapStore = store => ({ ...store, async put(path, bytes) { if (path.includes("-part") && ++parts === 2) throw new Error("disk full"); return store.put(path, bytes); }, async delete() { throw new Error("blob store down /secret/path"); } });
  const h = await harness(twoPart(), { wrapStore });
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "failed");
    assert.ok(h.logged.includes("pack_cleanup_failed"));
    assert.equal(h.logged.some(code => code.includes("/") || code.includes("secret")), false);
  } finally { await h.cleanup(); }
});

test("the part cap is checked before the archive is opened", async () => {
  const many = n => buildZip(Array.from({ length: n }, (_, i) => ({ name: `p${i}.stl`, data: cube(`p${i}`), method: "deflate" })));
  const h = await harness(many(16));
  try {
    await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    await h.useCases.analyze({ ...h.created, assetId: await h.upload(many(16)) });
    const garbage = await h.upload(new Uint8Array(64).fill(7));
    const result = await h.useCases.analyze({ ...h.created, assetId: garbage });
    assert.equal(result.status, "failed");
    assert.equal((await h.baseRepo.findAsset(garbage)).analysisErrorCode, "too_many_parts", "refused before parsing, not as malformed");
    assert.equal((await h.baseRepo.listChildren(garbage)).length, 0);
  } finally { await h.cleanup(); }
});

test("control and bidi override characters are stripped from stored entry names", async () => {
  const name = `evil${String.fromCharCode(0x202e)}ts.stl`;
  const h = await harness(buildZip([{ name, data: cube("x"), method: "deflate" }]));
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "pack");
    assert.equal(result.pack.parts[0].name, "evilts.stl");
    assert.equal((await h.baseRepo.listChildren(h.assetId))[0].archiveEntry, "evilts.stl");
  } finally { await h.cleanup(); }
});

test("entry names that collapse to one label are stored with the browser's unique labels", async () => {
  const h = await harness(buildZip([{ name: "a‮.stl", data: cube("x"), method: "deflate" }, { name: "a.stl", data: cube("y"), method: "deflate" }]));
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.deepEqual(result.pack.parts.map(part => part.name), ["a.stl", "a.stl (2)"]);
    assert.deepEqual((await h.baseRepo.listChildren(h.assetId)).map(child => child.archiveEntry), ["a.stl", "a.stl (2)"]);
  } finally { await h.cleanup(); }
});
