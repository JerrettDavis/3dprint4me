import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRequestUseCase } from "../../lib/project-request/create-project-request.js";
import { authorizeProjectUploadUseCase } from "../../lib/project-request/authorize-project-upload.js";
import { completeProjectRequestUseCase } from "../../lib/project-request/complete-project-request.js";

const request = {
  projectTitle: "Controller bracket",
  service: "design",
  description: "Design a printable bracket for a small controller.",
  contact: { name: "Taylor", email: "taylor@example.com" },
  consent: true
};
const normalized = { ...request, contact: { ...request.contact }, source: "3dprint4.me" };

test("Given a honeypot submission, when a project request is created, then no customer data is persisted", async () => {
  let normalizedCalls = 0;
  let persisted = 0;
  const execute = createProjectRequestUseCase({
    normalizeRequest() { normalizedCalls++; return normalized; },
    newRequestId: () => "3DP-20260922-AAAAAAAAAAAAAAAAAAAA",
    getRuntime: () => ({ mode: "neon", requestRepository: { async createDraft() { persisted++; } } })
  });

  const result = await execute({ website: "bot.example", request });

  assert.deepEqual(result, { id: "3DP-20260922-AAAAAAAAAAAAAAAAAAAA", mode: "ignored", live: true });
  assert.equal(normalizedCalls, 0);
  assert.equal(persisted, 0);
});

test("Given a configured repository, when a valid request is created, then the normalized draft is persisted", async () => {
  const calls = [];
  const execute = createProjectRequestUseCase({
    normalizeRequest(value) { assert.equal(value, request); return normalized; },
    newRequestId: () => "3DP-20260922-BBBBBBBBBBBBBBBBBBBB",
    getRuntime: () => ({
      mode: "neon",
      requestRepository: { async createDraft(id, value) { calls.push([id, value]); } },
      recorder: { async record(event) { calls.push([event.event, event.id]); } }
    })
  });

  const result = await execute({ request });

  assert.deepEqual(calls, [
    ["3DP-20260922-BBBBBBBBBBBBBBBBBBBB", normalized],
    ["create", "3DP-20260922-BBBBBBBBBBBBBBBBBBBB"]
  ]);
  assert.deepEqual(result, { id: "3DP-20260922-BBBBBBBBBBBBBBBBBBBB", mode: "neon", live: true });
});

test("Given delivery-only mode, when a request is created, then it remains honest about not being durably received", async () => {
  const execute = createProjectRequestUseCase({
    normalizeRequest: () => normalized,
    newRequestId: () => "3DP-20260922-CCCCCCCCCCCCCCCCCCCC",
    getRuntime: () => ({ mode: "delivery", requestRepository: null })
  });

  assert.deepEqual(await execute({ request }), {
    id: "3DP-20260922-CCCCCCCCCCCCCCCCCCCC",
    mode: "delivery",
    live: false
  });
});

test("Given a private draft, when an upload is authorized, then its path is randomized inside the request namespace", async () => {
  const signed = [];
  const execute = authorizeProjectUploadUseCase({
    validateId: value => value,
    sanitizeName: value => value,
    randomHex: () => "a1b2c3d4e5",
    getRuntime: () => ({
      requestRepository: { async acceptsUploads() { return true; } },
      privateFileStore: { bodyType: "file", headers: {}, async authorizeUpload(path, size, type) { signed.push([path, size, type]); return { uploadUrl: "https://upload.example" }; } }
    })
  });

  const result = await execute({ requestId: "3DP-20260922-DDDDDDDD", filename: "part.stl", size: 120, contentType: "model/stl" });

  assert.deepEqual(signed, [["3DP-20260922-DDDDDDDD/a1b2c3d4e5-part.stl", 120, "model/stl"]]);
  assert.deepEqual(result, { mode: "signed", method: "PUT", path: "3DP-20260922-DDDDDDDD/a1b2c3d4e5-part.stl", uploadUrl: "https://upload.example", bodyType: "file", headers: {} });
});

test("Given an unavailable private-file capability, when upload is requested, then it fails closed", async () => {
  const execute = authorizeProjectUploadUseCase({
    validateId: value => value,
    sanitizeName: value => value,
    randomHex: () => "unused",
    getRuntime: () => ({ requestRepository: null, privateFileStore: null })
  });
  await assert.rejects(
    () => execute({ requestId: "3DP-20260922-DDDDDDDD", filename: "part.stl", size: 120 }),
    error => error.status === 503
  );
});

test("Given durable completion, when optional notifications settle independently, then receipt and checkout proof remain honest", async () => {
  const calls = [];
  const execute = completeProjectRequestUseCase({
    normalizeRequest: () => normalized,
    normalizeFiles: () => [],
    validateId: value => value,
    issueCheckoutProof: () => "proof",
    getRuntime: () => ({
      mode: "neon",
      workPublisher: { async completeRequest(id) { calls.push(["complete", id]); return { outboxId: "17" }; } },
      emailNotifier: { async notify() { throw new Error("provider detail"); } },
      webhookNotifier: { async notify() { return { delivered: true }; } },
      pushTrigger: { async trigger(id) { calls.push(["push", id]); } },
      recorder: { async record(event) { calls.push(["record", event.event]); } }
    }),
    logFailure(operation) { calls.push(["failed", operation]); }
  });

  const result = await execute({ id: "3DP-20260922-EEEEEEEE", request, uploadedFiles: [] });

  assert.equal(result.live, true);
  assert.equal(result.integrations.database, true);
  assert.equal(result.integrations.email, false);
  assert.equal(result.integrations.webhook, true);
  assert.equal(result.checkoutToken, "proof");
  assert.deepEqual(calls, [["complete", "3DP-20260922-EEEEEEEE"], ["record", "complete"], ["push", "17"], ["failed", "email"]]);
});

test("Given no persistence or delivery, when completion runs, then checkout remains unavailable", async () => {
  let proofCalls = 0;
  const execute = completeProjectRequestUseCase({
    normalizeRequest: () => normalized,
    normalizeFiles: () => [],
    validateId: value => value,
    issueCheckoutProof: () => { proofCalls++; return "proof"; },
    getRuntime: () => ({
      mode: "local",
      emailNotifier: { async notify() { return { owner: false }; } },
      webhookNotifier: { async notify() { return { delivered: false }; } },
      pushTrigger: { async trigger() {} }
    })
  });

  const result = await execute({ id: "3DP-20260922-FFFFFFFF", request, uploadedFiles: [] });

  assert.equal(result.live, false);
  assert.equal(result.checkoutToken, null);
  assert.equal(proofCalls, 0);
});
