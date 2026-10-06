import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";

const migration = name => readFileSync(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");

async function seeded() {
  const db = new PGlite();
  for (const file of ["001_service_requests.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql"]) await db.exec(migration(file));
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  const repo = createNeonPrintRepository({ query });
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  const child = (n, name) => repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/bbbbbbbbb${n}-part${n}.stl`, originalName: name, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `stl/${name}` });
  return { db, repo, session, zip, child };
}

test("children, usage counts and part selection run against real Postgres", async () => {
  const { repo, session, zip, child } = await seeded();
  const a = await child(2, "base.stl"); const b = await child(3, "lid.stl"); const c = await child(4, "panel.stl");
  assert.equal(a.parentAssetId, zip.id); assert.equal(a.archiveEntry, "stl/base.stl"); assert.equal(a.quantity, 1); assert.equal(a.selected, false);
  assert.deepEqual(await repo.sessionUsage(session.id), { assets: 1, parts: 3, estimates: 0 });
  assert.deepEqual((await repo.listChildren(zip.id)).map(row => row.archiveEntry), ["stl/base.stl", "stl/lid.stl", "stl/panel.stl"]);
  const selected = await repo.selectParts(zip.id, [{ partId: a.id, quantity: 2 }, { partId: c.id, quantity: 1 }]);
  assert.deepEqual(selected.map(row => [row.archiveEntry, row.selected, row.quantity]), [["stl/base.stl", true, 2], ["stl/lid.stl", false, 1], ["stl/panel.stl", true, 1]]);
  const again = await repo.selectParts(zip.id, [{ partId: b.id, quantity: 5 }]);
  assert.deepEqual(again.map(row => [row.selected, row.quantity]), [[false, 1], [true, 5], [false, 1]]);
});

test("orphanedParts returns only unselected children of attached sessions", async () => {
  const { db, repo, session, zip, child } = await seeded();
  const a = await child(2, "base.stl"); await child(3, "lid.stl");
  await repo.selectParts(zip.id, [{ partId: a.id, quantity: 1 }]);
  assert.deepEqual(await repo.orphanedParts({ limit: 10 }), []);
  await db.query("UPDATE print_estimate_sessions SET state = 'attached' WHERE id = $1", [session.id]);
  assert.deepEqual((await repo.orphanedParts({ limit: 10 })).map(row => row.archiveEntry), ["stl/lid.stl"]);
});

test("a session delete removes a ZIP and its children in one statement", async () => {
  const { db, repo, session, child } = await seeded();
  await child(2, "base.stl");
  await db.query("DELETE FROM print_assets WHERE estimate_session_id = $1", [session.id]);
  assert.deepEqual((await db.query("SELECT id FROM print_assets")).rows, []);
});

test("claimPackAnalysis is won once, loses while fresh, and wins again when stale", async () => {
  const { db, repo, zip } = await seeded();
  assert.equal(await repo.claimPackAnalysis(zip.id), null, "a pending_upload ZIP cannot be claimed");
  await repo.markAssetUploaded(zip.id, 100);
  const won = await repo.claimPackAnalysis(zip.id);
  assert.equal(won.state, "analyzing");
  assert.equal(await repo.claimPackAnalysis(zip.id), null, "fresh claim loses");
  await db.query("UPDATE print_assets SET updated_at = now() - interval '10 minutes' WHERE id = $1", [zip.id]);
  assert.ok(await repo.claimPackAnalysis(zip.id), "stale claim is recoverable");
  assert.equal((await repo.markAssetFailed(zip.id, { code: "malformed", detail: "x" })).state, "failed");
  assert.equal(await repo.claimPackAnalysis(zip.id), null, "a failed ZIP is not re-claimable");
});

test("claimPackAnalysis never claims a non-ZIP asset", async () => {
  const { repo, child } = await seeded();
  const part = await child(2, "base.stl");
  await repo.markAssetUploaded(part.id, 10);
  assert.equal(await repo.claimPackAnalysis(part.id), null);
});
