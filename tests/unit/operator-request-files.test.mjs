import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorPrintHandler } from "../../api/operator-print.js";
import { signRequestFile } from "../../lib/operator-files.js";

const requestId = "3DP-20260921-ABCDEF0123456789ABCD";
const work = { item: { id: "work_12345678", requestId }, files: [
  { name: "bracket.stl", mode: "signed", path: `${requestId}/bracket.stl` },
  { name: "notes.txt", mode: "metadata", path: null },
  { name: "model.3mf", mode: "estimate", path: null },
  { name: "evil.stl", mode: "signed", path: "OTHER-REQUEST/evil.stl" }
] };

test("signs only stored files that belong to this request, with a 60 second link", async () => {
  const calls = [];
  const sign = async (path, ttl) => { calls.push({ path, ttl }); return "https://store.private.blob.vercel-storage.com/signed"; };
  const result = await signRequestFile({ work, index: "0", sign, now: () => new Date("2026-10-06T00:00:00Z") });
  assert.deepEqual(calls, [{ path: `${requestId}/bracket.stl`, ttl: 60 }]);
  assert.equal(result.filename, "bracket.stl");
  assert.equal(result.expiresAt, "2026-10-06T00:01:00.000Z");
  for (const index of ["1", "2", "3", "9", "-1", "x"]) await assert.rejects(signRequestFile({ work, index, sign }), error => error.status === 404, `index ${index}`);
  assert.equal(calls.length, 1);
});

test("operator-print request-file resource authorizes, loads the work and returns a signed link", async () => {
  const origin = "http://127.0.0.1:4180";
  const store = { getWork: async id => { assert.equal(id, "work_12345678"); return work; } };
  const handler = createOperatorPrintHandler({ store, authorize: async () => ({ id: "op_1" }), allowedOrigins: [origin], signFile: async () => "https://store.private.blob.vercel-storage.com/signed" });
  const res = { statusCode: 0, body: "", setHeader() {}, end(value = "") { this.body += value; } };
  await handler({ method: "GET", url: "/api/operator-print?resource=request-file&workId=work_12345678&index=0", headers: { origin } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, "https://store.private.blob.vercel-storage.com/signed");
});
