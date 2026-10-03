import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { OperatorApiError } from "../../operator/assets/api-client.js";
import { createOperatorController } from "../../operator/assets/operator.js";

const makeView = () => { const calls = []; return { calls, state: (name, data) => calls.push(["state", name, data]), list: items => calls.push(["list", items]), detail: value => calls.push(["detail", value]), announce: value => calls.push(["announce", value]), noteDraft: () => "unsent note" }; };

test("controller exposes signed-out and forbidden states without retaining private work", async () => {
  for (const [kind, expected] of [["signed-out", "signed-out"], ["forbidden", "forbidden"]]) {
    const view = makeView();
    const controller = createOperatorController({ api: { session: async () => { throw new OperatorApiError(kind, kind === "signed-out" ? 401 : 403); } }, view });
    await controller.start();
    assert.equal(controller.snapshot().items.length, 0);
    assert.equal(view.calls.at(-1)[1], expected);
  }
});

test("controller loads minimized work, selects detail and applies a revision-bound command", async () => {
  const view = makeView(); let updated;
  const summary = { id: "work_12345678", projectTitle: "Bracket", service: "print", priority: "normal", status: "submitted", revision: 1 };
  const api = {
    session: async () => ({ operator: { displayName: "Jerrett" } }), listWork: async () => ({ items: [summary] }),
    getWork: async () => ({ item: summary, request: { projectTitle: "Bracket" }, files: [], notes: [], events: [] }),
    updateWork: async (id, command) => { updated = { id, command }; return { item: { ...summary, revision: 2, acknowledged: true } }; }
  };
  const controller = createOperatorController({ api, view });
  await controller.start(); await controller.select(summary.id); await controller.command({ type: "acknowledge", revision: 1 });
  assert.deepEqual(updated, { id: summary.id, command: { type: "acknowledge", revision: 1 } });
  assert.equal(controller.snapshot().detail.item.revision, 2);
});

test("revision conflict refetches current detail while preserving the private note draft", async () => {
  const view = makeView(); let reads = 0;
  const current = revision => ({ item: { id: "work_12345678", status: "triage", revision }, request: {}, files: [], notes: [], events: [] });
  const api = { session: async () => ({ operator: {} }), listWork: async () => ({ items: [{ id: "work_12345678" }] }), getWork: async () => current(++reads), updateWork: async () => { throw new OperatorApiError("conflict", 409, { currentRevision: 2 }); } };
  const controller = createOperatorController({ api, view });
  await controller.start(); await controller.select("work_12345678"); await controller.command({ type: "add-note", revision: 1, body: "unsent note" });
  assert.equal(reads, 2);
  assert.equal(controller.snapshot().noteDraft, "unsent note");
  assert.match(view.calls.find(call => call[0] === "announce")?.[1], /changed/i);
});

const states = view => view.calls.filter(call => call[0] === "state").map(call => call[1]);
const signedOut = () => new OperatorApiError("signed-out", 401);
const fastRetry = { attempts: 3, delayMs: 0 };

test("start shows a neutral checking state first and never reports signed-out for a signed-in operator", async () => {
  const view = makeView();
  const api = { session: async () => ({ operator: { displayName: "J" } }), listWork: async () => ({ items: [] }) };
  await createOperatorController({ api, view }).start();
  assert.deepEqual(states(view), ["checking-session", "loading", "empty"]);
});

test("returning from sign-in waits out a transient 401 instead of flashing signed-out", async () => {
  const view = makeView(); let attempts = 0, waits = 0;
  const api = { session: async () => { if (++attempts < 3) throw signedOut(); return { operator: {} }; }, listWork: async () => ({ items: [{ id: "work_12345678" }] }) };
  await createOperatorController({ api, view, expectSession: () => true, retry: fastRetry, wait: async () => { waits++; } }).start();
  assert.equal(attempts, 3); assert.equal(waits, 2);
  assert.deepEqual(states(view), ["checking-session", "loading", "ready"]);
});

test("returning from sign-in gives up after the retry budget and settles once on signed-out", async () => {
  const view = makeView(); let attempts = 0;
  const controller = createOperatorController({ api: { session: async () => { attempts++; throw signedOut(); } }, view, expectSession: () => true, retry: fastRetry, wait: async () => {} });
  await controller.start();
  assert.equal(attempts, fastRetry.attempts + 1);
  assert.deepEqual(states(view), ["checking-session", "signed-out"]);
});

test("a plain visit does not retry a 401, and forbidden is never retried", async () => {
  for (const [expect, error, attempts] of [[() => false, signedOut(), 1], [() => true, new OperatorApiError("forbidden", 403), 1]]) {
    let calls = 0; const view = makeView();
    await createOperatorController({ api: { session: async () => { calls++; throw error; } }, view, expectSession: expect, retry: fastRetry, wait: async () => {} }).start();
    assert.equal(calls, attempts);
  }
});

test("overlapping start calls share one progression", async () => {
  const view = makeView(); let sessions = 0;
  const api = { session: async () => { sessions++; return { operator: {} }; }, listWork: async () => ({ items: [] }) };
  const controller = createOperatorController({ api, view });
  await Promise.all([controller.start(), controller.start(), controller.start()]);
  assert.equal(sessions, 1);
  assert.equal(states(view).filter(name => name === "checking-session").length, 1);
});

test("operator static host serves deep links, and the service worker takes over without waiting", async () => {
  const config = JSON.parse(await readFile(new URL("../../operator/vercel.json", import.meta.url), "utf8"));
  const deepLink = config.rewrites.find(rule => rule.source === "/work/:id");
  assert.ok(deepLink, "a /work/:id rewrite exists so refreshing a job sheet does not 404");
  assert.equal(config.cleanUrls, true);
  assert.ok(["/", "/index"].includes(deepLink.destination), "with cleanUrls the destination must be the clean URL, not /index.html");
  const worker = await readFile(new URL("../../operator/sw.js", import.meta.url), "utf8");
  assert.match(worker, /skipWaiting\(\)/);
});

test("operator stylesheet gives controls pointer, hover, press and disabled states", async () => {
  const css = await readFile(new URL("../../operator/assets/operator.css", import.meta.url), "utf8");
  for (const needle of ["cursor:pointer", "button:not(:disabled):hover", "button:not(:disabled):active", "button:disabled{cursor:not-allowed", ".work-list li:hover", "prefers-reduced-motion:no-preference"]) assert.ok(css.includes(needle), needle);
});
