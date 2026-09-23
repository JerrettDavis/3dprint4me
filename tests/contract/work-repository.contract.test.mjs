import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalWorkRepository } from "../../lib/work-management/adapters/local-work-repository.js";

const request = {
  projectTitle: "Alignment bracket", service: "design", description: "Design a replacement bracket.",
  contact: { name: "Taylor", email: "taylor@example.com" }, consent: true
};

test("Given the local repository, when a request becomes work, then list and detail expose the same aggregate contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-contract-"));
  try {
    const repository = createLocalWorkRepository({ path: join(directory, "work.json") });
    const completed = await repository.completeRequestWithWork("3DP-20260922-CONTRACT", request, []);
    const listed = await repository.listWork({ view: "active", service: null, priority: null, cursor: null, limit: 20 });
    const detail = await repository.getWork(completed.workItem.id);
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].id, completed.workItem.id);
    assert.equal(detail.item.revision, 1);
    assert.equal(detail.request.projectTitle, "Alignment bracket");
    assert.equal(detail.events[0].type, "work.created");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Given the local repository, when a stale command is applied, then newer work is never overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-contract-"));
  try {
    const repository = createLocalWorkRepository({ path: join(directory, "work.json") });
    const completed = await repository.completeRequestWithWork("3DP-20260922-REVISION", request, []);
    const operator = { id: "operator-1" };
    await repository.applyWorkCommand(completed.workItem.id, { type: "acknowledge", revision: 1 }, operator, "action-1");
    await assert.rejects(
      () => repository.applyWorkCommand(completed.workItem.id, { type: "set-priority", priority: "high", revision: 1 }, operator, "action-2"),
      error => error.status === 409 && error.details?.code === "revision_conflict"
    );
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Home Assistant snapshot reads leave persisted work and notification state unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-contract-"));
  try {
    const repository = createLocalWorkRepository({ path: join(directory, "work.json") });
    const completed = await repository.completeRequestWithWork("3DP-20260922-SNAPSHOT", request, []);
    const before = await repository.snapshot();
    const first = await repository.getHomeAssistantSnapshot();
    const second = await repository.getHomeAssistantSnapshot();
    const after = await repository.snapshot();
    assert.deepEqual(after, before);
    assert.deepEqual(second, first);
    assert.deepEqual(first.counts, { active: 1, unacknowledged: 1, urgent: 0, waitingCustomer: 0 });
    assert.equal(first.latestCreatedId, completed.workItem.id);
    assert.deepEqual(first.items, [{
      id: completed.workItem.id, status: "submitted", service: "design",
      projectTitle: "Alignment bracket", priority: "normal", acknowledged: false,
      submittedAt: before.requests[0].submittedAt, targetDate: null
    }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Home Assistant snapshot counts all active work, bounds cards, and tracks newest creation across terminal status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-contract-"));
  try {
    const path = join(directory, "work.json");
    const entries = [
      { id: "work_aaaaaaaa", status: "submitted", priority: "normal", createdAt: "2026-09-20T10:00:00.000Z" },
      { id: "work_bbbbbbbb", status: "triage", priority: "urgent", createdAt: "2026-09-19T10:00:00.000Z", acknowledgedAt: "2026-09-19T11:00:00.000Z" },
      { id: "work_cccccccc", status: "waiting_customer", priority: "high", createdAt: "2026-09-21T10:00:00.000Z" },
      ...Array.from({ length: 20 }, (_, index) => ({ id: `work_extra${String(index).padStart(3, "0")}`, status: "submitted", priority: "low", createdAt: "2026-09-18T10:00:00.000Z" })),
      { id: "work_dddddddd", status: "completed", priority: "urgent", createdAt: "2026-09-22T10:00:00.000Z" },
      { id: "work_eeeeeeee", status: "declined", priority: "urgent", createdAt: "2026-09-17T10:00:00.000Z" },
      { id: "work_ffffffff", status: "cancelled", priority: "urgent", createdAt: "2026-09-16T10:00:00.000Z" }
    ];
    const requests = entries.map((item, index) => ({
      id: `request-${index}`, request: { ...request, projectTitle: `Project ${index}`, contact: { email: "private@example.com" }, description: "Private details" },
      submittedAt: item.createdAt, files: [{ privatePath: "private/file.stl" }]
    }));
    const workItems = entries.map((item, index) => ({ ...item, requestId: `request-${index}`, targetDate: null }));
    await writeFile(path, JSON.stringify({ version: 1, requests, workItems }));
    const actual = await createLocalWorkRepository({ path }).getHomeAssistantSnapshot();
    assert.deepEqual(actual.counts, { active: 23, unacknowledged: 22, urgent: 1, waitingCustomer: 1 });
    assert.equal(actual.latestCreatedId, "work_dddddddd");
    assert.equal(actual.items.length, 20);
    assert.deepEqual(actual.items.slice(0, 3).map(item => item.id), ["work_bbbbbbbb", "work_cccccccc", "work_aaaaaaaa"]);
    assert.equal(actual.items.some(item => ["work_dddddddd", "work_eeeeeeee", "work_ffffffff"].includes(item.id)), false);
    assert.deepEqual(Object.keys(actual.items[0]).sort(), ["acknowledged", "id", "priority", "projectTitle", "service", "status", "submittedAt", "targetDate"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Home Assistant snapshot preserves a terminal newest marker when no active work remains", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-contract-"));
  try {
    const path = join(directory, "work.json");
    await writeFile(path, JSON.stringify({
      version: 1, requests: [], workItems: [
        { id: "work_aaaaaaaa", status: "completed", createdAt: "2026-09-22T10:00:00.000Z" },
        { id: "work_bbbbbbbb", status: "declined", createdAt: "2026-09-22T10:00:00.000Z" }
      ]
    }));
    const actual = await createLocalWorkRepository({ path }).getHomeAssistantSnapshot();
    assert.deepEqual(actual, { counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 }, latestCreatedId: "work_bbbbbbbb", items: [] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
