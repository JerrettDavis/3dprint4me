import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  const a = await child(2, "base.stl"); await child(3, "lid.stl");
  await repo.selectParts(zip.id, [{ partId: a.id, quantity: 1 }]);
  assert.deepEqual(await repo.orphanedParts({ limit: 10 }), []);
  assert.equal((await repo.attachSession({ sessionId: session.id, ownershipHash: session.ownershipHash, requestId: "req_1" })).attached, true);
  assert.deepEqual((await repo.orphanedParts({ limit: 10 })).map(row => row.archiveEntry), ["stl/lid.stl"]);
});
