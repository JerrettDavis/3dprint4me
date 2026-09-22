import assert from "node:assert/strict";
import test from "node:test";

import { createWorkHandler } from "../../api/operator-work.js";
import { createWorkUpdateHandler } from "../../api/operator-work-update.js";
import { HttpError } from "../../lib/http.js";

function response() {
  const headers = new Map();
  return { statusCode: 0, body: "", setHeader(name, value) { headers.set(name.toLowerCase(), value); }, end(value = "") { this.body += value; }, headers };
}

const origin = "http://127.0.0.1:4180";
const operator = { id: "op_12345678", authUserId: "auth-user-123", displayName: "Jerrett", role: "owner" };
const authorize = async () => operator;

test("work endpoint returns minimized filtered summaries and passes a bounded query", async () => {
  const calls = [];
  const store = { listWork: async (query, actor) => {
    calls.push({ query, actor });
    return { items: [{ id: "work_12345678", requestId: "3DP-20260921-ABCDEF0123456789ABCD", status: "submitted", service: "print", projectTitle: "Bracket", priority: "high", acknowledged: false, submittedAt: "2026-09-21T12:00:00.000Z", targetDate: null, revision: 1 }], nextCursor: null };
  } };
  const handler = createWorkHandler({ store, authorize, allowedOrigins: [origin] });
  const res = response();
  await handler({ method: "GET", url: "/api/operator-work?view=unacknowledged&service=print&priority=high&limit=25", headers: { origin } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{ query: { view: "unacknowledged", service: "print", priority: "high", limit: 25, cursor: null }, actor: operator }]);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 1);
  for (const privateField of ["description", "email", "phone", "address", "specifications", "notes", "files"]) assert.equal(privateField in body.items[0], false);
});

test("work endpoint returns authorized detail and incremental events by explicit mode", async () => {
  const calls = [];
  const store = {
    getWork: async (id, actor) => { calls.push(["detail", id, actor.id]); return { item: { id }, request: { description: "Private" }, files: [], notes: [], events: [] }; },
    listEvents: async (after, limit, actor) => { calls.push(["events", after, limit, actor.id]); return { events: [{ id: "42", type: "work.created" }], nextCursor: "42" }; }
  };
  const handler = createWorkHandler({ store, authorize, allowedOrigins: [origin] });
  const detail = response();
  await handler({ method: "GET", url: "/api/operator-work?id=work_12345678", headers: { origin } }, detail);
  assert.equal(detail.statusCode, 200);
  assert.equal(JSON.parse(detail.body).request.description, "Private");
  const events = response();
  await handler({ method: "GET", url: "/api/operator-work?eventsAfter=41&limit=10", headers: { origin } }, events);
  assert.deepEqual(JSON.parse(events.body), { events: [{ id: "42", type: "work.created" }], nextCursor: "42" });
  assert.deepEqual(calls, [["detail", "work_12345678", "op_12345678"], ["events", "41", 10, "op_12345678"]]);
});

test("mutation endpoint validates the envelope and forwards normalized revision-bound commands", async () => {
  const calls = [];
  const store = { applyWorkCommand: async (...args) => { calls.push(args); return { item: { id: args[0], revision: 3, priority: "high" }, event: { id: "44", type: "work.priority_changed" } }; } };
  const handler = createWorkUpdateHandler({ store, authorize, allowedOrigins: [origin] });
  const res = response();
  await handler({ method: "PATCH", url: "/api/operator-work-update", headers: { origin, "content-type": "application/json" }, body: { id: "work_12345678", command: { type: "set-priority", priority: " HIGH ", revision: 2 }, idempotencyKey: "action_12345678" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [["work_12345678", { type: "set-priority", priority: "high", revision: 2 }, operator, "action_12345678"]]);

  const invalid = response();
  await handler({ method: "PATCH", headers: { origin, "content-type": "application/json" }, body: { id: "work_12345678", command: { type: "set-status", status: "completed", revision: 1 }, idempotencyKey: "x", admin: true } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).code, "operator_request_invalid");
});

test("revision conflicts expose only the current revision and a stable recovery code", async () => {
  const store = { applyWorkCommand: async () => { throw new HttpError(409, "Work changed before this update could be saved.", { code: "revision_conflict", currentRevision: 4 }); } };
  const handler = createWorkUpdateHandler({ store, authorize, allowedOrigins: [origin] });
  const res = response();
  await handler({ method: "PATCH", headers: { origin, "content-type": "application/json" }, body: { id: "work_12345678", command: { type: "acknowledge", revision: 3 }, idempotencyKey: "action_12345678" } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(JSON.parse(res.body), { error: "Work changed before this update could be saved.", code: "revision_conflict", currentRevision: 4 });
});
