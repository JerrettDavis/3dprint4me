import assert from "node:assert/strict";
import test from "node:test";

import { ProjectRequestClientError } from "../../public/assets/js/order/client.js";
import { createOrderController } from "../../public/assets/js/order/controller.js";

function harness(overrides = {}) {
  const shown = [];
  const saved = [];
  const request = { projectTitle: "Bracket", contact: { email: "taylor@example.com" } };
  const controller = createOrderController({
    getData: () => ({ website: "" }),
    buildRequest: () => request,
    validateFinalStep: () => true,
    client: {
      async create() { return { id: "3DP-20260922-ABCDEFGH", mode: "neon", live: true }; },
      async complete() { return { id: "3DP-20260922-ABCDEFGH", mode: "neon", live: true }; },
      async checkout() { return {}; },
      async health() { return { integrations: {} }; }
    },
    files: { list: () => [], async prepare() { return []; } },
    draftStore: { saveSubmitted(value) { saved.push(value); return true; }, clearDraft() {} },
    view: { submitting() {}, showSubmission(value, stored) { shown.push([value, stored]); }, submissionError() {}, uploadProgress() {} },
    newLocalId: () => "LOCAL-12345678",
    warn() {},
    ...overrides
  });
  return { controller, shown, saved, request };
}

test("Given an uncertain completion response, when submission finishes locally, then it never claims the remote request was lost", async () => {
  const client = {
    async create() { return { id: "3DP-20260922-ABCDEFGH", mode: "neon", live: true }; },
    async complete() { throw new ProjectRequestClientError("response lost", { kind: "uncertain-completion" }); }
  };
  const { controller, shown, saved } = harness({ client });

  await controller.submit();

  assert.equal(saved.length, 1);
  assert.equal(shown[0][0].id, "3DP-20260922-ABCDEFGH");
  assert.equal(shown[0][0].backend.live, false);
  assert.equal(shown[0][0].backend.warning, "response lost");
});

test("Given initial service unavailability, when submission starts, then a recoverable local request is created without remote completion", async () => {
  let completeCalls = 0;
  const client = {
    async create() { throw new ProjectRequestClientError("offline", { kind: "unavailable" }); },
    async complete() { completeCalls++; }
  };
  const { controller, shown } = harness({ client });

  await controller.submit();

  assert.equal(completeCalls, 0);
  assert.equal(shown[0][0].id, "LOCAL-12345678");
  assert.equal(shown[0][0].backend.live, false);
});
