import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  completeRequestRecord,
  createSignedDownload,
  createSignedUpload,
  requestRecordExists
} from "../../lib/supabase.js";

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET
};

function configure() {
  process.env.SUPABASE_URL = "https://project.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "service-files";
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("signed upload URLs are rooted at Supabase Storage and preserve encoded paths", async () => {
  configure();
  let requestedUrl;
  let requestedOptions;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return jsonResponse({
      url: "/object/upload/sign/service-files/3DP-20260901-ABC123/bracket%20v2.stl?token=upload-token"
    });
  };

  const result = await createSignedUpload("3DP-20260901-ABC123/bracket v2.stl");

  assert.equal(
    requestedUrl,
    "https://project.supabase.co/storage/v1/object/upload/sign/service-files/3DP-20260901-ABC123/bracket%20v2.stl"
  );
  assert.equal(requestedOptions.method, "POST");
  assert.equal(requestedOptions.headers.apikey, "service-role-secret");
  assert.deepEqual(JSON.parse(requestedOptions.body), { upsert: false });
  assert.equal(
    result.uploadUrl,
    "https://project.supabase.co/storage/v1/object/upload/sign/service-files/3DP-20260901-ABC123/bracket%20v2.stl?token=upload-token"
  );
  assert.equal(result.token, "upload-token");
});

test("signed download URLs are rooted at Supabase Storage", async () => {
  configure();
  globalThis.fetch = async () => jsonResponse({
    signedURL: "/object/sign/service-files/3DP-20260901-ABC123/photo.jpg?token=download-token"
  });

  const result = await createSignedDownload("3DP-20260901-ABC123/photo.jpg", 900);

  assert.equal(
    result,
    "https://project.supabase.co/storage/v1/object/sign/service-files/3DP-20260901-ABC123/photo.jpg?token=download-token"
  );
});

test("signed upload URLs reject a different host, object path, or missing token", async () => {
  configure();
  for (const url of [
    "https://files.example/object/upload/sign/service-files/3DP-20260901-ABC123/bracket.stl?token=secret",
    "/object/upload/sign/service-files/another-request/bracket.stl?token=secret",
    "/object/upload/sign/service-files/3DP-20260901-ABC123/bracket.stl"
  ]) {
    globalThis.fetch = async () => jsonResponse({ url });
    await assert.rejects(
      () => createSignedUpload("3DP-20260901-ABC123/bracket.stl"),
      error => error.status === 502 && !/secret|files\.example/.test(error.message)
    );
  }
});

test("signed upload URLs accept a token-only Storage response", async () => {
  configure();
  globalThis.fetch = async () => jsonResponse({ token: "upload-token" });

  const result = await createSignedUpload("3DP-20260901-ABC123/bracket.stl");
  assert.equal(result.uploadUrl, "https://project.supabase.co/storage/v1/object/upload/sign/service-files/3DP-20260901-ABC123/bracket.stl?token=upload-token");
  assert.equal(result.token, "upload-token");
});

test("signed download URLs reject a different host or object path", async () => {
  configure();
  for (const signedURL of [
    "https://files.example/object/sign/service-files/3DP-20260901-ABC123/photo.jpg?token=secret",
    "/object/sign/service-files/another-request/photo.jpg?token=secret"
  ]) {
    globalThis.fetch = async () => jsonResponse({ signedURL });
    await assert.rejects(
      () => createSignedDownload("3DP-20260901-ABC123/photo.jpg", 900),
      error => error.status === 502 && !/secret|files\.example/.test(error.message)
    );
  }
});

test("request existence checks use PostgREST and return a boolean", async () => {
  configure();
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return jsonResponse([{ id: "3DP-20260901-ABC123", status: "draft" }]);
  };

  assert.equal(await requestRecordExists("3DP-20260901-ABC123"), true);
  assert.match(urls[0], /\/rest\/v1\/service_requests\?select=id,status&id=eq\.3DP-20260901-ABC123&limit=1$/);
});


test("completed or missing requests cannot be completed a second time", async () => {
  configure();
  globalThis.fetch = async () => jsonResponse([]);

  await assert.rejects(
    () => completeRequestRecord(
      "3DP-20260901-ABC123",
      { projectTitle: "Example" },
      []
    ),
    error => error.status === 409 && /already been completed/.test(error.message)
  );
});


test("non-JSON Supabase failures are normalized as provider errors", async () => {
  configure();
  const logged = [];
  console.error = (...values) => logged.push(JSON.stringify(values));
  globalThis.fetch = async () => new Response("secret-token customer@example.com", { status: 502 });

  await assert.rejects(
    () => requestRecordExists("3DP-20260901-ABC123"),
    error => error.status === 502 && /temporarily unavailable/.test(error.message)
  );
  assert.doesNotMatch(logged.join(" "), /secret-token|customer@example.com/);
});
