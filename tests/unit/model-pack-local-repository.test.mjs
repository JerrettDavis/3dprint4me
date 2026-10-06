import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";

async function seeded(t) {
  const directory = await mkdtemp(join(tmpdir(), "model-pack-local-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = createLocalPrintRepository({ path: join(directory, "state.json"), workLookup: async () => null });
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  const child = (n, name, extra = {}) => repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/bbbbbbbbb${n}-part${n}.stl`, originalName: name, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `stl/${name}`, ...extra });
  return { repo, session, zip, child };
}

test("children, usage counts and part selection behave like the Neon adapter", async t => {
  const { repo, session, zip, child } = await seeded(t);
  assert.equal(zip.parentAssetId, null); assert.equal(zip.quantity, 1); assert.equal(zip.selected, false);
  const a = await child(2, "base.stl"); const b = await child(3, "lid.stl"); const c = await child(4, "panel.stl");
  assert.equal(a.parentAssetId, zip.id); assert.equal(a.archiveEntry, "stl/base.stl"); assert.equal(a.quantity, 1); assert.equal(a.selected, false);
  assert.deepEqual(await repo.sessionUsage(session.id), { assets: 1, parts: 3, estimates: 0 });
  assert.deepEqual((await repo.listChildren(zip.id)).map(row => row.archiveEntry), ["stl/base.stl", "stl/lid.stl", "stl/panel.stl"]);
  const selected = await repo.selectParts(zip.id, [{ partId: a.id, quantity: 2 }, { partId: c.id, quantity: 1 }]);
  assert.deepEqual(selected.map(row => [row.archiveEntry, row.selected, row.quantity]), [["stl/base.stl", true, 2], ["stl/lid.stl", false, 1], ["stl/panel.stl", true, 1]]);
  const again = await repo.selectParts(zip.id, [{ partId: b.id, quantity: 5 }]);
  assert.deepEqual(again.map(row => [row.selected, row.quantity]), [[false, 1], [true, 5], [false, 1]]);
});

test("undefined pack fields fall back to defaults", async t => {
  const { child } = await seeded(t);
  const row = await child(2, "base.stl", { parentAssetId: undefined, archiveEntry: undefined, quantity: undefined, selected: undefined });
  assert.deepEqual([row.parentAssetId, row.archiveEntry, row.quantity, row.selected], [null, null, 1, false]);
});

test("orphanedParts returns only unselected children of attached sessions", async t => {
  const { repo, session, zip, child } = await seeded(t);
  const a = await child(2, "base.stl"); const b = await child(3, "lid.stl");
  for (const row of [zip, a, b]) await repo.markAssetUploaded(row.id, 10);
  await repo.selectParts(zip.id, [{ partId: a.id, quantity: 1 }]);
  assert.deepEqual(await repo.orphanedParts({ limit: 10 }), []);
  assert.equal((await repo.attachSession({ sessionId: session.id, ownershipHash: session.ownershipHash, requestId: "req_1" })).attached, true);
  assert.deepEqual((await repo.orphanedParts({ limit: 10 })).map(row => row.archiveEntry), ["stl/lid.stl"]);
  const rows = await Promise.all([zip.id, a.id, b.id].map(id => repo.findAsset(id)));
  assert.deepEqual(rows.map(row => row.requestId ?? null), ["req_1", "req_1", null]);
});

test("a stale never-attached ZIP of an attached session is orphaned; fresh and attached ones are not", async t => {
  const directory = await mkdtemp(join(tmpdir(), "model-pack-local-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = new Date("2026-01-01T00:00:00Z");
  const repo = createLocalPrintRepository({ path: join(directory, "state.json"), now: () => clock, workLookup: async () => null });
  const mk = async (n, analyzing) => {
    const session = await repo.createSession({ id: `est_${String(n).repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(clock.getTime() + 3_600_000).toISOString() });
    const zip = await repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
    await repo.markAssetUploaded(zip.id, 100);
    if (analyzing) await repo.claimPackAnalysis(zip.id);
    await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: `r${n}` });
    return zip;
  };
  const stale = await mk(1, true);
  const attachedZip = await mk(3, false);
  clock = new Date(clock.getTime() + 11 * 60_000);
  const fresh = await mk(2, true);
  assert.equal((await repo.findAsset(attachedZip.id)).requestId, "r3");
  assert.equal((await repo.findAsset(fresh.id)).requestId ?? null, null);
  assert.deepEqual((await repo.orphanedParts({ limit: 10 })).map(row => row.id), [stale.id]);
});

test("a child inherits the ZIP retention hold", async t => {
  const directory = await mkdtemp(join(tmpdir(), "model-pack-local-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = createLocalPrintRepository({ path: join(directory, "state.json"), workLookup: async () => ({ status: "completed", completedAt: "2020-01-01T00:00:00Z" }) });
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: "p/a-pack.zip", originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  await repo.markAssetUploaded(zip.id, 100);
  const kid = await repo.createAsset({ id: `asset_${"2".repeat(32)}`, sessionId: session.id, blobPath: "p/b-part.stl", originalName: "p.stl", format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: "p.stl" });
  await repo.markAssetUploaded(kid.id, 10);
  await repo.selectParts(zip.id, [{ partId: kid.id, quantity: 1 }]);
  await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "req_1" });
  const cutoff = new Date().toISOString();
  assert.deepEqual((await repo.retentionCandidates({ completedBefore: cutoff })).map(row => row.id).sort(), [zip.id, kid.id]);
  const file = join(directory, "state.json");
  const hold = async value => {
    const state = JSON.parse(await readFile(file, "utf8"));
    state.assets.find(row => row.id === zip.id).retentionHold = value;
    await writeFile(file, JSON.stringify(state));
  };
  await hold(true);
  assert.deepEqual(await repo.retentionCandidates({ completedBefore: cutoff }), []);
  await hold(false);
  assert.equal((await repo.retentionCandidates({ completedBefore: cutoff })).length, 2);
});
