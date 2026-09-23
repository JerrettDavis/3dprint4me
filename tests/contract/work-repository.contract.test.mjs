import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
