import assert from "node:assert/strict";
import test from "node:test";

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
