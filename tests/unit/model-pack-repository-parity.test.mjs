// Final-review fixes for ZIP model packs, run against both repository adapters: the local JSON
// store and the real Neon SQL on in-process PGlite. Both must behave identically.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createMigratedDatabase } from "../support/pglite-neon.mjs";

const HASH = "b".repeat(64);
const adapters = [
  ["local", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-pack-parity-"));
    const path = join(directory, "state.json");
    const repo = createLocalPrintRepository({ path, workLookup: async () => null });
    const edit = async change => { const state = JSON.parse(await readFile(path, "utf8")); change(state); await writeFile(path, JSON.stringify(state)); };
    return {
      repo,
      setAsset: (id, fields) => edit(state => Object.assign(state.assets.find(row => row.id === id), fields)),
      setSessionState: (id, value) => edit(state => { state.sessions.find(row => row.id === id).state = value; }),
      createRequest: async () => {},
      close: () => rm(directory, { recursive: true, force: true })
    };
  }],
  ["neon-sql-on-pglite", async () => {
    const database = await createMigratedDatabase();
    const repo = createNeonPrintRepository({ query: database.query });
    const columns = { selected: "selected", requestId: "request_id", retentionHold: "retention_hold" };
    return {
      repo,
      setAsset: async (id, fields) => {
        for (const [key, value] of Object.entries(fields)) await database.db.query(`UPDATE print_assets SET ${columns[key]} = $1 WHERE id = $2`, [value, id]);
      },
      setSessionState: (id, value) => database.db.query("UPDATE print_estimate_sessions SET state = $1 WHERE id = $2", [value, id]),
      createRequest: id => database.db.query("INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload) VALUES ($1,'submitted','print','T','N','e@x.co','{}')", [id]),
      close: () => database.close()
    };
  }]
];

const id = (prefix, n) => `${prefix}_${String(n).repeat(32)}`;

async function seed(context, { zips = 1, partsPerZip = 2, sessionN = "a" } = {}) {
  const { repo } = context;
  const session = await repo.createSession({ id: `est_${sessionN.repeat(32)}`, ownershipHash: HASH, assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const packs = [];
  let n = 0;
  for (let z = 0; z < zips; z++) {
    const zipId = `asset_${String(z + 1).padStart(2, "0").repeat(16)}`;
    const zip = await repo.createAsset({ id: zipId, sessionId: session.id, blobPath: `print-estimates/${session.id}/zip${z}-pack.zip`, originalName: `pack${z}.zip`, format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
    await repo.markAssetUploaded(zip.id, 100);
    const kids = [];
    for (let p = 0; p < partsPerZip; p++) {
      n += 1;
      const kid = await repo.createAsset({ id: `asset_${String(z + 1)}${String(p).padStart(2, "0")}${"c".repeat(29)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/part-${z}-${p}.stl`, originalName: `p${p}.stl`, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `p${p}.stl` });
      await repo.markAssetUploaded(kid.id, 10);
      kids.push(kid);
    }
    packs.push({ zip, kids });
  }
  return { session, packs };
}

const estimateRow = ({ sessionId, assetId, purpose, profileId = "geometry:x", marker = 1 }) => ({
  sessionId, assetId, requestId: null, purpose, estimatorType: purpose === "slice" ? "slicer" : "geometry", confidence: "rough", engine: "e", engineVersion: "1", profileId,
  pricingModelVersion: "p1", rateCardVersion: "r1", input: { options: {} }, geometry: {}, slicer: {}, cost: {}, pricing: {}, public: { marker },
  priceLowCents: 100, priceHighCents: 200, targetPriceCents: 150
});

for (const [name, setup] of adapters) {
  test(`C1 (${name}): latestSessionEstimate skips a pack child's slice row; sessionUsage does not count slice rows`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const { session, packs: [{ zip, kids }] } = await seed(context);
      await repo.insertEstimate(estimateRow({ sessionId: session.id, assetId: zip.id, purpose: "preview", profileId: "pack:pla", marker: "pack" }));
      await repo.insertEstimate(estimateRow({ sessionId: session.id, assetId: kids[0].id, purpose: "slice", marker: "child" }));
      await repo.insertEstimate(estimateRow({ sessionId: session.id, assetId: kids[1].id, purpose: "slice", marker: "child" }));
      const latest = await repo.latestSessionEstimate(session.id);
      assert.equal(latest.assetId, zip.id);
      assert.equal(latest.public.marker, "pack");
      assert.equal((await repo.sessionUsage(session.id)).estimates, 1, "slice rows do not consume the session estimate cap");
      assert.equal(await repo.latestSessionEstimate(`est_${"f".repeat(32)}`), null);
    } finally { await context.close(); }
  });

  test(`C1 (${name}): a single model's own slicer row is still the latest top-level snapshot`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: HASH, assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
      const stl = await repo.createAsset({ id: id("asset", 1), sessionId: session.id, blobPath: `print-estimates/${session.id}/x-cube.stl`, originalName: "cube.stl", format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt });
      await repo.insertEstimate(estimateRow({ sessionId: session.id, assetId: stl.id, purpose: "preview", marker: "geometry" }));
      await new Promise(resolve => setTimeout(resolve, 5));
      await repo.insertEstimate(estimateRow({ sessionId: session.id, assetId: stl.id, purpose: "slice", marker: "slicer" }));
      assert.equal((await repo.latestSessionEstimate(session.id)).public.marker, "slicer");
    } finally { await context.close(); }
  });

  test(`I1 (${name}): selectParts is a no-op once the session is no longer open`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const { session, packs: [{ zip, kids }] } = await seed(context);
      await repo.selectParts(zip.id, [{ partId: kids[0].id, quantity: 2 }]);
      await context.setSessionState(session.id, "attached");
      const late = await repo.selectParts(zip.id, [{ partId: kids[1].id, quantity: 5 }]);
      assert.deepEqual(late.map(row => [row.id, row.selected, row.quantity]), [[kids[0].id, true, 2], [kids[1].id, false, 1]], "returns the unchanged children");
      assert.deepEqual((await repo.listChildren(zip.id)).map(row => [row.selected, row.quantity]), [[true, 2], [false, 1]]);
    } finally { await context.close(); }
  });

  test(`I1 (${name}): orphanedParts never returns an attached or held child`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const { session, packs: [{ zip, kids }] } = await seed(context, { partsPerZip: 3 });
      await context.createRequest("3DP-PARITY-0001");
      await repo.selectParts(zip.id, [{ partId: kids[0].id, quantity: 1 }, { partId: kids[1].id, quantity: 1 }]);
      assert.equal((await repo.attachSession({ sessionId: session.id, ownershipHash: HASH, requestId: "3DP-PARITY-0001" })).attached, true);
      const orphans = async () => (await repo.orphanedParts({ limit: 10 })).map(row => row.id).sort();
      assert.deepEqual(await orphans(), [kids[2].id]);
      // A late write deselects an attached child: it must still never be swept.
      await context.setAsset(kids[0].id, { selected: false });
      assert.deepEqual(await orphans(), [kids[2].id]);
      // An unattached, unselected child under a held ZIP (or held itself) is kept as well.
      await context.setAsset(zip.id, { retentionHold: true });
      assert.deepEqual(await orphans(), []);
      await context.setAsset(zip.id, { retentionHold: false });
      await context.setAsset(kids[2].id, { retentionHold: true });
      assert.deepEqual(await orphans(), []);
    } finally { await context.close(); }
  });

  test(`I3 (${name}): clearOtherPackSelections unselects every other ZIP's parts in the open session only`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const { session, packs: [a, b] } = await seed(context, { zips: 2 });
      await repo.selectParts(a.zip.id, a.kids.map(kid => ({ partId: kid.id, quantity: 3 })));
      await repo.selectParts(b.zip.id, [{ partId: b.kids[0].id, quantity: 1 }]);
      assert.equal(await repo.clearOtherPackSelections(session.id, b.zip.id), 2);
      assert.deepEqual((await repo.listChildren(a.zip.id)).map(row => row.selected), [false, false]);
      assert.deepEqual((await repo.listChildren(b.zip.id)).map(row => row.selected), [true, false], "the current pack keeps its selection");
      await repo.selectParts(a.zip.id, [{ partId: a.kids[1].id, quantity: 1 }]);
      await context.setSessionState(session.id, "attached");
      assert.equal(await repo.clearOtherPackSelections(session.id, b.zip.id), 0, "no change once attached");
      assert.deepEqual((await repo.listChildren(a.zip.id)).map(row => row.selected), [false, true]);
    } finally { await context.close(); }
  });

  test(`M6 (${name}): forRequest returns more than 40 attached assets`, async () => {
    const context = await setup();
    try {
      const { repo } = context;
      const { session, packs } = await seed(context, { zips: 3, partsPerZip: 16 });
      await context.createRequest("3DP-PARITY-0002");
      for (const { zip, kids } of packs) await repo.selectParts(zip.id, kids.map(kid => ({ partId: kid.id, quantity: 1 })));
      await repo.attachSession({ sessionId: session.id, ownershipHash: HASH, requestId: "3DP-PARITY-0002" });
      assert.equal((await repo.forRequest("3DP-PARITY-0002")).assets.length, 51);
    } finally { await context.close(); }
  });
}
