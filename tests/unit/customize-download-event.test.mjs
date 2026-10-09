import assert from "node:assert/strict";
import test from "node:test";
import { createDownloadEventHandler, normalizeDownloadEvent } from "../../lib/customization/download-event.js";

const call = async (handler, body, method = "POST") => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method, headers: { "content-type": "application/json" }, body }, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
};
const env = { RESEND_API_KEY: "k", REQUEST_TO_EMAIL: "o@example.com", REQUEST_FROM_EMAIL: "f@example.com" };

test("normalizes a download event; email is optional", () => {
  assert.deepEqual(normalizeDownloadEvent({ action: "download", generatorId: "wifi-tag" }), { action: "download", generatorId: "wifi-tag", email: "" });
  assert.equal(normalizeDownloadEvent({ action: "print", generatorId: "qr", email: " A@B.co " }).email, "a@b.co");
});

test("rejects unknown actions, odd ids and bad emails", () => {
  for (const body of [null, [], { action: "x", generatorId: "a" }, { action: "download", generatorId: "../a" }, { action: "download", generatorId: "a", email: "nope" }]) {
    assert.throws(() => normalizeDownloadEvent(body));
  }
});

test("anonymous event is logged without sending mail; the email never reaches the log", async () => {
  const logs = []; let sent = 0;
  const handler = createDownloadEventHandler({ log: l => logs.push(l), send: async () => { sent++; } });
  Object.assign(process.env, env);
  const anon = await call(handler, { action: "download", generatorId: "wifi-tag" });
  const withEmail = await call(handler, { action: "download", generatorId: "wifi-tag", email: "me@example.com" });
  assert.equal(anon.status, 200); assert.equal(withEmail.status, 200);
  assert.equal(sent, 1);
  assert.ok(logs.every(l => !l.includes("me@example.com")));
});

test("a failing mail provider still answers ok", async () => {
  Object.assign(process.env, env);
  const handler = createDownloadEventHandler({ log() {}, send: async () => { throw new Error("secret key leak"); } });
  const res = await call(handler, { action: "print", generatorId: "wifi-tag", email: "me@example.com" });
  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(res.json).includes("secret"), false);
});

test("honeypot and wrong method", async () => {
  const handler = createDownloadEventHandler({ log() {} });
  assert.equal((await call(handler, { website: "x" })).status, 200);
  assert.equal((await call(handler, {}, "GET")).status, 405);
  assert.equal((await call(handler, { action: "bad" })).status, 400);
});
