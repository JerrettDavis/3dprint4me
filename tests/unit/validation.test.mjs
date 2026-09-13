import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { readJson } from "../../lib/http.js";
import { normalizeUploadedFiles } from "../../lib/validation.js";

const requestId = "3DP-20260901-ABC123";

test("signed upload metadata must remain inside its request namespace", () => {
  assert.deepEqual(
    normalizeUploadedFiles([{
      name: "bracket.stl",
      size: 120,
      type: "model/stl",
      path: `${requestId}/a1b2c3d4e5-bracket.stl`,
      mode: "signed"
    }], requestId),
    [{
      name: "bracket.stl",
      size: 120,
      type: "model/stl",
      path: `${requestId}/a1b2c3d4e5-bracket.stl`,
      mode: "signed"
    }]
  );

  assert.throws(
    () => normalizeUploadedFiles([{
      name: "other.stl",
      size: 120,
      path: "3DP-20260901-OTHER01/other.stl",
      mode: "signed"
    }], requestId),
    /outside this project request/
  );
});

test("signed upload metadata requires a storage path", () => {
  assert.throws(
    () => normalizeUploadedFiles([{ name: "part.stl", size: 10, mode: "signed" }], requestId),
    /must include its private storage path/
  );
});

test("JSON APIs reject simple cross-origin content types", async () => {
  const req = Readable.from([Buffer.from('{"ok":true}')]);
  req.headers = { "content-type": "text/plain" };
  await assert.rejects(() => readJson(req), error => error.status === 415);
});
