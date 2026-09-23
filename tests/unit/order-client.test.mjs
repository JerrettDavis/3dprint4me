import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRequestClient, ProjectRequestClientError } from "../../public/assets/js/order/client.js";

test("Given a correctable server rejection, when create fails, then the client classifies it as editable", async () => {
  const client = createProjectRequestClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: "Choose a service." }), { status: 400, headers: { "content-type": "application/json" } })
  });
  await assert.rejects(
    () => client.create({ request: {} }),
    error => error instanceof ProjectRequestClientError && error.kind === "correctable" && error.status === 400
  );
});

test("Given a lost completion response, when completion fails, then the client classifies receipt as uncertain", async () => {
  const client = createProjectRequestClient({ fetchImpl: async () => { throw new TypeError("network failed"); } });
  await assert.rejects(
    () => client.complete({ id: "3DP-20260922-ABCDEFGH", request: {}, uploadedFiles: [] }),
    error => error instanceof ProjectRequestClientError && error.kind === "uncertain-completion"
  );
});

test("Given Blob and Supabase upload instructions, when files upload, then each required body shape is preserved", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    if (url === "/api/upload-url") {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(body.filename === "blob.stl"
        ? { uploadUrl: "https://blob.example", method: "PUT", bodyType: "file", headers: {}, path: "id/blob.stl" }
        : { uploadUrl: "https://supa.example", method: "PUT", bodyType: "form", headers: { "x-upsert": "false" }, path: "id/supa.stl" }), { status: 200 });
    }
    return new Response(null, { status: 200 });
  };
  const client = createProjectRequestClient({ fetchImpl });
  const blobFile = new File(["blob"], "blob.stl", { type: "model/stl" });
  const supaFile = new File(["supa"], "supa.stl", { type: "model/stl" });

  const uploaded = await client.upload("3DP-20260922-ABCDEFGH", [blobFile, supaFile]);

  assert.equal(requests[1][1].body, blobFile);
  assert.ok(requests[3][1].body instanceof FormData);
  assert.equal(requests[3][1].headers["x-upsert"], "false");
  assert.deepEqual(uploaded.map(file => [file.name, file.mode, file.path]), [["blob.stl", "signed", "id/blob.stl"], ["supa.stl", "signed", "id/supa.stl"]]);
});

test("Given a mode without private uploads, when files are prepared, then metadata remains customer recoverable", async () => {
  const client = createProjectRequestClient({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  const file = new File(["model"], "part.stl", { type: "model/stl" });
  assert.deepEqual(await client.prepareFiles("LOCAL-12345678", "local", [file]), [{ name: "part.stl", size: 5, type: "model/stl", path: null, mode: "metadata" }]);
});

test("Given the browser transport is replaced after startup, when a request is made, then the current transport is used", async () => {
  const original = globalThis.fetch;
  const client = createProjectRequestClient();
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "3DP-20260922-LATETRANSPORT", mode: "local", live: false }), { status: 201 });
    const result = await client.create({ request: {} });
    assert.equal(result.id, "3DP-20260922-LATETRANSPORT");
  } finally {
    globalThis.fetch = original;
  }
});
