import assert from "node:assert/strict";
import test from "node:test";

import { createInquiryUseCase } from "../../lib/quick-inquiry/create-inquiry.js";
import { completeInquiryUseCase } from "../../lib/quick-inquiry/complete-inquiry.js";
import { notifyInquiryUseCase } from "../../lib/quick-inquiry/notify-inquiry.js";
import { notificationClaimAllowed } from "../../lib/quick-inquiry/domain.js";

const normalized = {
  key_hash: "owner-key",
  payload_hash: "payload-hash",
  inquiry: { replyEmail: "taylor@example.com", message: "Can this be made?" },
  files: [{ name: "photo.jpg", size: 12, type: "image/jpeg" }]
};

test("Given an owned draft replay, when the same inquiry is created, then missing uploads are reissued without a duplicate row", async () => {
  let creates = 0;
  const row = { ...normalized, id: "INQ-ONE", status: "draft", files: [{ ...normalized.files[0], path: "inquiries/INQ-ONE/0-photo.jpg" }] };
  const execute = createInquiryUseCase({
    normalize: () => normalized,
    repository: { async findOwnedDraft() { return row; }, async createDraft() { creates++; } },
    privateFiles: { async matches() { return false; }, async authorizeUpload(path) { return { uploadUrl: `https://upload.example/${path}` }; } },
    newId: () => "unused",
    randomHex: () => "unused"
  });

  const result = await execute({});

  assert.equal(creates, 0);
  assert.equal(result.row.id, "INQ-ONE");
  assert.equal(result.uploads.length, 1);
  assert.equal(result.uploads[0].method, "PUT");
});

test("Given a reused ownership key with different details, when inquiry creation runs, then it rejects the mismatch", async () => {
  const execute = createInquiryUseCase({
    normalize: () => normalized,
    repository: { async findOwnedDraft() { return { ...normalized, payload_hash: "different" }; } },
    privateFiles: {}, newId: () => "unused", randomHex: () => "unused"
  });
  await assert.rejects(() => execute({}), error => error.status === 409);
});

test("Given verified attachments, when an inquiry completes, then durable acceptance precedes notification", async () => {
  const calls = [];
  const row = { ...normalized, id: "INQ-TWO", status: "draft", files: [{ ...normalized.files[0], path: "inquiries/INQ-TWO/0-photo.jpg" }] };
  const execute = completeInquiryUseCase({
    validateKey: () => normalized.key_hash,
    repository: {
      async findOwnedDraft() { return row; },
      async completeDraft() { calls.push("complete"); return { ...row, status: "submitted" }; }
    },
    privateFiles: { async matches() { calls.push("verify"); return true; } },
    notify: async () => { calls.push("notify"); throw new Error("provider unavailable"); }
  });

  const result = await execute({ id: "INQ-TWO", submissionKey: "secret" });

  assert.equal(result.status, "submitted");
  assert.deepEqual(calls, ["verify", "complete", "notify"]);
});

test("Given a missing attachment, when completion runs, then neither acceptance nor notification occurs", async () => {
  let completed = false;
  let notified = false;
  const row = { ...normalized, id: "INQ-THREE", status: "draft", files: [{ ...normalized.files[0], path: "inquiries/INQ-THREE/0-photo.jpg" }] };
  const execute = completeInquiryUseCase({
    validateKey: () => normalized.key_hash,
    repository: { async findOwnedDraft() { return row; }, async completeDraft() { completed = true; } },
    privateFiles: { async matches() { return false; } },
    notify: async () => { notified = true; }
  });
  await assert.rejects(() => execute({ id: "INQ-THREE", submissionKey: "secret" }), error => error.status === 409);
  assert.equal(completed, false);
  assert.equal(notified, false);
});

test("Given a claimed immutable payload, when notification delivery fails, then only a safe failed state is persisted", async () => {
  const calls = [];
  const execute = notifyInquiryUseCase({
    hasDelivery: () => true,
    buildPayload: () => ({ subject: "stable", text: "same bytes" }),
    repository: {
      async claimNotification(_row, payload) { calls.push(["claim", payload]); return payload; },
      async finishNotification(_row, state) { calls.push(["finish", state]); }
    },
    send: async () => { calls.push(["send"]); throw new Error("secret provider response"); }
  });

  await execute({ id: "INQ-FOUR" });

  assert.deepEqual(calls, [["claim", { subject: "stable", text: "same bytes" }], ["send"], ["finish", "failed"]]);
});

test("Given notification history, when claim policy is evaluated, then attempts, spacing, and window are bounded", () => {
  const now = new Date("2026-09-22T20:00:00Z");
  assert.equal(notificationClaimAllowed({ status: "failed", attempts: 2, startedAt: "2026-09-22T19:00:00Z", lastAt: "2026-09-22T19:58:00Z", now }), true);
  assert.equal(notificationClaimAllowed({ status: "failed", attempts: 3, startedAt: "2026-09-22T19:00:00Z", lastAt: "2026-09-22T19:58:00Z", now }), false);
  assert.equal(notificationClaimAllowed({ status: "failed", attempts: 2, startedAt: "2026-09-22T19:00:00Z", lastAt: "2026-09-22T19:59:30Z", now }), false);
  assert.equal(notificationClaimAllowed({ status: "failed", attempts: 2, startedAt: "2026-09-21T20:59:59Z", lastAt: "2026-09-22T19:00:00Z", now }), false);
  assert.equal(notificationClaimAllowed({ status: "sent", attempts: 1, startedAt: "2026-09-22T19:00:00Z", lastAt: "2026-09-22T19:58:00Z", now }), false);
});
