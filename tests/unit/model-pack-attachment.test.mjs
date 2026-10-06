import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createRetentionUseCases } from "../../lib/print-estimation/application/retention.js";
import { createNeonWorkRepository } from "../../lib/work-management/adapters/neon-work-repository.js";

const migration = name => readFileSync(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");

async function seeded() {
  const db = new PGlite();
  for (const file of ["001_service_requests.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql"]) await db.exec(migration(file));
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  const repo = createNeonPrintRepository({ query });
  await db.query("INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload) VALUES ('3DP-1','submitted','print','T','N','e@x.co','{}')");
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  await repo.markAssetUploaded(zip.id, 100);
  const kids = [];
  for (const n of [2, 3]) {
    const row = await repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/bbbbbbbbb${n}-part${n}.stl`, originalName: `p${n}.stl`, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `p${n}.stl` });
    await repo.markAssetUploaded(row.id, 10); kids.push(row);
  }
  await repo.selectParts(zip.id, [{ partId: kids[0].id, quantity: 1 }]);
  return { db, query, repo, session, zip, kids };
}

const attachedSet = async (db, zip, kids) => {
  const rows = (await db.query("SELECT id, request_id FROM print_assets ORDER BY id")).rows;
  assert.deepEqual(rows.map(row => [row.id, row.request_id]), [[zip.id, "3DP-1"], [kids[0].id, "3DP-1"], [kids[1].id, null]]);
};

test("attachSession attaches the ZIP and selected parts only", async () => {
  const { db, repo, session, zip, kids } = await seeded();
  const result = await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "3DP-1" });
  assert.equal(result.attached, true);
  await attachedSet(db, zip, kids);
});

test("an analyzing ZIP is not attached", async () => {
  const { db, repo, session, zip } = await seeded();
  assert.ok(await repo.claimPackAnalysis(zip.id));
  await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "3DP-1" });
  const row = (await db.query("SELECT request_id, state FROM print_assets WHERE id = $1", [zip.id])).rows[0];
  assert.deepEqual([row.request_id, row.state], [null, "analyzing"]);
});

test("the sweep deletes unselected parts of attached sessions, objects first", async () => {
  const { repo, session, zip, kids } = await seeded();
  await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "3DP-1" });
  const deleted = [];
  const retention = createRetentionUseCases({ repository: repo, fileStore: { delete: async path => { deleted.push(path); } } });
  const report = await retention.sweep();
  assert.equal(report.orphanedParts, 1);
  assert.deepEqual(deleted, [kids[1].blobPath]);
  assert.equal((await repo.findAsset(kids[1].id)).state, "deleted");
  assert.notEqual((await repo.findAsset(kids[0].id)).state, "deleted");
  assert.notEqual((await repo.findAsset(zip.id)).state, "deleted");
  assert.equal((await retention.sweep()).orphanedParts, 0);
});

test("request completion attaches the ZIP and selected parts in the single completion statement", async () => {
  const { db, query, session, zip, kids } = await seeded();
  await db.query("UPDATE service_requests SET status = 'draft' WHERE id = '3DP-1'");
  const work = createNeonWorkRepository({ query });
  const result = await work.completeRequestWithWork("3DP-1", { service: "print", projectTitle: "T", contact: { name: "N", email: "e@x.co" } }, [], { sessionId: session.id, ownershipHash: "b".repeat(64) });
  assert.equal(result.printEstimate.attached, true);
  assert.equal(result.printEstimate.assets, 2);
  await attachedSet(db, zip, kids);
});
