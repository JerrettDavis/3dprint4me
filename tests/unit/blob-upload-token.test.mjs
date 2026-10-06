import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Vercel Blob normalizes application/x-zip-compressed (Windows .zip) to application/zip before
// comparing with the token, so pinning a client-reported type rejected real ZIP uploads with 403.
test("signed private uploads never pin a client-reported content type", () => {
  assert.doesNotMatch(readFileSync(new URL("../../lib/blob.js", import.meta.url), "utf8"), /allowedContentTypes/);
});
