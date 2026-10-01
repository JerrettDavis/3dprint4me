import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { clientAddress, clientSubject, createRateLimiter, DEFAULT_RATE_POLICY, ratePolicyFromEnv } from "../../lib/print-estimation/application/rate-limit.js";
import { createRetentionUseCases } from "../../lib/print-estimation/application/retention.js";
import { createPrintEstimateHandler } from "../../lib/print-estimation/handler.js";
import { createPrintEstimateClient, createPrivateEstimateFlow } from "../../public/assets/js/print-estimation/client.js";
import { splitStatements } from "../../scripts/migrate-neon.mjs";
import { createMigratedDatabase } from "../support/pglite-neon.mjs";

const T0 = new Date("2026-09-30T12:10:00.000Z");
const policy = { windowSeconds: 3600, "session-create": { perClient: 2, global: 3 }, "upload-token": { perClient: 2, global: 3 } };

function memoryRepository() {
  const buckets = new Map();
  return {
    buckets,
    async consumeRateLimit({ scope, subject, windowStart }) {
      const key = `${scope}|${subject}|${windowStart}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      return buckets.get(key);
    }
  };
}

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  return assert.fail("expected rejection");
}

test("per-client and global limits both apply, with a clear 429 and Retry-After", async () => {
  const limiter = createRateLimiter({ repository: memoryRepository(), policy, now: () => T0 });
  await limiter.consume("session-create", "c_a");
  await limiter.consume("session-create", "c_a");
  const perClient = await rejection(limiter.consume("session-create", "c_a"));
  assert.equal(perClient.status, 429);
  assert.equal(perClient.headers["Retry-After"], String(50 * 60));
  assert.match(perClient.message, /sent with your request/);
  await limiter.consume("session-create", "c_b"); // global 3rd: client a's refused attempt did not drain global
  assert.equal((await rejection(limiter.consume("session-create", "c_c"))).status, 429);
  await limiter.consume("upload-token", "c_a"); // scopes are independent
});

test("windows roll over and a counter fault fails closed", async () => {
  let now = T0;
  const limiter = createRateLimiter({ repository: memoryRepository(), policy, now: () => now });
  for (let i = 0; i < 2; i++) await limiter.consume("session-create", "c_a");
  assert.equal((await rejection(limiter.consume("session-create", "c_a"))).status, 429);
  now = new Date("2026-09-30T13:00:01.000Z");
  await limiter.consume("session-create", "c_a");
  const broken = createRateLimiter({ repository: { consumeRateLimit: async () => { throw new Error("db down"); } }, policy });
  await assert.rejects(broken.consume("session-create", "c_a"), /db down/);
  const garbage = createRateLimiter({ repository: { consumeRateLimit: async () => undefined }, policy });
  assert.equal((await rejection(garbage.consume("session-create", "c_a"))).status, 503);
  await assert.rejects(limiter.consume("other", "c_a"), TypeError);
});

test("policy comes from bounded environment values and client subjects are opaque", () => {
  assert.deepEqual(ratePolicyFromEnv({}), DEFAULT_RATE_POLICY);
  assert.equal(ratePolicyFromEnv({ PRINT_ESTIMATE_SESSIONS_PER_CLIENT: "5" })["session-create"].perClient, 5);
  assert.equal(ratePolicyFromEnv({ PRINT_ESTIMATE_SESSIONS_GLOBAL: "-1" })["session-create"].global, 300);
  assert.equal(clientAddress({ headers: { "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1" } }), "203.0.113.9");
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
  assert.equal(clientAddress({ headers: {} }), "unknown");
  const subject = clientSubject("203.0.113.9", "salt");
  assert.match(subject, /^c_[0-9a-f]{32}$/);
  assert.ok(!subject.includes("203"));
  assert.notEqual(subject, clientSubject("203.0.113.9", "other"));
});

test("the handler limits session creation per client and globally and never stores raw addresses", async () => {
  const repository = { ...memoryRepository(), async createSession(row) { return { id: row.id }; } };
  const useCases = createEstimateSessionUseCases({ repository, fileStore: {}, materialCosts: {}, rateLimiter: createRateLimiter({ repository, policy, now: () => T0 }) });
  const handler = createPrintEstimateHandler({ useCases });
  const call = async ip => {
    const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value; } };
    await handler({ method: "POST", url: "/api/print-estimate", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: { action: "create", options: {} } }, res);
    return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
  };
  assert.equal((await call("198.51.100.1")).status, 201);
  assert.equal((await call("198.51.100.1")).status, 201);
  const limited = await call("198.51.100.1");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "3000");
  assert.equal(limited.headers["cache-control"], "no-store");
  assert.match(limited.body.error, /Too many print estimate requests/);
  assert.equal((await call("198.51.100.2")).status, 201);
  assert.equal((await call("198.51.100.3")).status, 429, "global budget exhausted");
  assert.equal([...repository.buckets.keys()].some(key => key.includes("198.51")), false);
});

test("upload-token issuance is limited before any asset row or signed URL exists", async () => {
  const repository = {
    ...memoryRepository(),
    async findSession() { return { id: `est_${"0".repeat(32)}`, ownershipHash: "x", state: "open", expiresAt: "2999-01-01T00:00:00Z" }; },
    async sessionUsage() { return { assets: 0, estimates: 0 }; },
    async createAsset() { throw new Error("must not be reached"); }
  };
  const rateLimiter = { consume: async (scope, client) => { assert.equal(scope, "upload-token"); assert.equal(client, "c_x"); throw Object.assign(new Error("limited"), { status: 429 }); } };
  const useCases = createEstimateSessionUseCases({ repository, fileStore: {}, materialCosts: {}, rateLimiter });
  const token = "a".repeat(43);
  const { hashCapability } = await import("../../lib/print-estimation/capability.js");
  repository.findSession = async () => ({ id: `est_${"0".repeat(32)}`, ownershipHash: hashCapability(token), state: "open", expiresAt: "2999-01-01T00:00:00Z" });
  const error = await rejection(useCases.authorizeUpload({ sessionId: `est_${"0".repeat(32)}`, token, filename: "a.stl", size: 100 }, { client: "c_x" }));
  assert.equal(error.status, 429);
});

test("the storefront flow falls back to uploading with the request when estimate limits trip", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: "Too many print estimate requests right now." }) });
  const flow = createPrivateEstimateFlow({ client: createPrintEstimateClient({ fetchImpl }), getOptions: () => ({}) });
  const states = [];
  const file = { name: "a.stl", size: 10 };
  await flow.start(file, { isCurrent: () => true, update: change => states.push(change.privateState) });
  assert.deepEqual(states, ["uploading", "failed"]);
  assert.equal(flow.isPreUploaded(file), false, "the file is uploaded with the request instead");
  assert.equal(flow.attachment(), null);
});

test("Neon SQL (PGlite) counts atomically per window, local adapter matches, retention prunes, migration 005 is idempotent", async () => {
  const database = await createMigratedDatabase();
  const directory = await mkdtemp(join(tmpdir(), "3dp-rate-"));
  try {
    for (const repository of [createNeonPrintRepository({ query: database.query }), createLocalPrintRepository({ path: join(directory, "print.json") })]) {
      const args = { scope: "session-create", subject: "c_a", windowStart: "2026-09-30T12:00:00.000Z" };
      const hits = [];
      for (let i = 0; i < 3; i++) hits.push(await repository.consumeRateLimit(args));
      assert.deepEqual(hits, [1, 2, 3]);
      assert.equal(await repository.consumeRateLimit({ ...args, windowStart: "2026-09-30T13:00:00.000Z" }), 1);
      assert.equal(await repository.consumeRateLimit({ ...args, subject: "global" }), 1);
      assert.equal(await repository.pruneRateBuckets("2026-09-30T12:30:00.000Z"), 2);
    }
    const repository = createNeonPrintRepository({ query: database.query });
    const report = await createRetentionUseCases({
      repository: { ...repository, expiredSessions: async () => [], staleUnattachedUploads: async () => [], retentionCandidates: async () => [] },
      fileStore: {}, now: () => new Date("2026-10-05T00:00:00.000Z")
    }).sweep();
    assert.equal(report.rateBucketsPruned, 1);
    await assert.rejects(database.db.query("INSERT INTO print_estimate_rate_buckets (scope, subject, window_start) VALUES ('bogus','x',now())"));
    for (const statement of splitStatements(await readFile(new URL("../../neon/migrations/005_print_estimate_rate_limits.sql", import.meta.url), "utf8"))) await database.db.query(statement);
  } finally { await database.close(); }
});
