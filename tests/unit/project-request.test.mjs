import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRequestUseCase } from "../../lib/project-request/create-project-request.js";
import { authorizeProjectUploadUseCase } from "../../lib/project-request/authorize-project-upload.js";
import { completeProjectRequestUseCase } from "../../lib/project-request/complete-project-request.js";
import { createProjectRequestHandler } from "../../lib/project-request/handler.js";
import { postRequestWebhook, sendRequestEmails } from "../../lib/notifications.js";

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

// ---- End to end through the HTTP handler: a Wi-Fi tag's real password never persists ------------

const SECRET = "hunter2";
const DELIVERY_ENV = {
  RESEND_API_KEY: "re_test_key", REQUEST_TO_EMAIL: "hello@3dprint4.me", REQUEST_FROM_EMAIL: "3dprint4.me <requests@3dprint4.me>",
  REQUEST_WEBHOOK_URL: "https://automation.example/hooks/3dprint4me", REQUEST_WEBHOOK_SECRET: "hook-secret"
};
const UNSET_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BLOB_READ_WRITE_TOKEN"];

function wifiRequest(service = "print") {
  return {
    projectTitle: "Custom Wi-Fi tag",
    service,
    serviceLabel: "Print my model",
    description: "Custom Wi-Fi tag — see attached model.",
    files: [{ name: "wifi-tag-card.3mf", size: 4096, type: "model/3mf" }],
    contact: { name: "Taylor", email: "taylor@example.com" },
    consent: true,
    customization: { generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe Guest", password: SECRET, security: "WPA", format: "card" } }
  };
}

function fakeExchange(method, body) {
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  return [{ method, headers: { "content-type": "application/json" }, body }, res];
}

async function runRequestFlow(request) {
  const saved = Object.fromEntries([...Object.keys(DELIVERY_ENV), ...UNSET_ENV].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, DELIVERY_ENV);
  for (const k of UNSET_ENV) delete process.env[k];
  const seen = { repository: [], recorder: [], published: [], outbound: [], responses: [] };
  globalThis.fetch = async (url, options) => {
    seen.outbound.push({ url: String(url), body: options?.body, headers: options?.headers });
    return new Response(JSON.stringify({ id: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const handler = createProjectRequestHandler({
      newRequestId: () => "3DP-20261003-AAAAAAAAAAAAAAAAAAAA",
      issueCheckoutProof: () => "proof",
      getRuntime: () => ({
        mode: "neon",
        requestRepository: { async createDraft(id, value) { seen.repository.push(structuredClone({ id, value })); } },
        workPublisher: { async completeRequest(id, value, files) { seen.published.push(structuredClone({ id, value, files })); return { outboxId: "1" }; } },
        recorder: { async record(event) { seen.recorder.push(structuredClone(event)); } },
        emailNotifier: { notify: sendRequestEmails },
        webhookNotifier: { notify: postRequestWebhook },
        pushTrigger: { async trigger() {} }
      })
    });
    const [postReq, postRes] = fakeExchange("POST", { request });
    await handler(postReq, postRes);
    seen.responses.push(postRes);
    const id = JSON.parse(postRes.body).id;
    const uploadedFiles = [{ name: "wifi-tag-card.3mf", size: 4096, type: "model/3mf", path: `${id}/a1b2-wifi-tag-card.3mf`, mode: "signed" }];
    const [patchReq, patchRes] = fakeExchange("PATCH", { id, request, uploadedFiles });
    await handler(patchReq, patchRes);
    seen.responses.push(patchRes);
    return seen;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("Given a Wi-Fi tag print request with a real password, when it is created and completed, then only the redaction marker is recorded, stored, emailed or webhooked", async () => {
  const seen = await runRequestFlow(wifiRequest("print"));
  assert.deepEqual(seen.responses.map(r => r.statusCode), [201, 200], seen.responses.map(r => r.body).join(" | "));
  assert.equal(seen.repository.length, 1);
  assert.equal(seen.published.length, 1);
  assert.deepEqual(seen.recorder.map(e => e.event), ["create", "complete"]);
  for (const stored of [seen.repository[0].value, seen.published[0].value, ...seen.recorder.map(e => e.request)]) {
    assert.equal(stored.customization.generatorId, "wifi-tag");
    assert.equal(stored.customization.params.ssid, "Cafe Guest");
    assert.equal(stored.customization.params.password, "[redacted]");
    assert.deepEqual(stored.customization.redacted, ["password"]);
  }
  // Owner + customer email and the webhook all went out, and none carries the secret.
  assert.equal(seen.outbound.filter(o => o.url.includes("api.resend.com")).length, 2);
  const hook = seen.outbound.find(o => o.url.includes("automation.example"));
  assert.equal(JSON.parse(hook.body).request.customization.params.password, "[redacted]");
  const owner = seen.outbound.map(o => JSON.parse(o.body)).find(b => b.to?.[0] === "hello@3dprint4.me");
  assert.match(owner.html, /Password: withheld/);
  assert.equal(JSON.stringify(seen).includes(SECRET), false, "the secret appears nowhere in anything recorded, stored, sent or returned");
});

test("Given a customization on a non-print service, when the request is created and completed, then the customization is dropped end to end", async () => {
  const seen = await runRequestFlow(wifiRequest("design"));
  assert.deepEqual(seen.responses.map(r => r.statusCode), [201, 200], seen.responses.map(r => r.body).join(" | "));
  for (const stored of [seen.repository[0].value, seen.published[0].value, ...seen.recorder.map(e => e.request)]) assert.equal(stored.customization, null);
  for (const o of seen.outbound) assert.doesNotMatch(String(o.body), /Customizer|wifi-tag"|ssid/i, o.url);
  const hook = seen.outbound.find(o => o.url.includes("automation.example"));
  assert.equal(JSON.parse(hook.body).request.customization, null);
  assert.equal(JSON.stringify(seen).includes(SECRET), false);
});
