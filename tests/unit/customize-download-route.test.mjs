import assert from "node:assert/strict";
import test from "node:test";
import handler from "../../api/inquiry.js";

test("the inquiry function also serves the customizer download event", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ url: "/api/inquiry?kind=customize-download", method: "POST", headers: { "content-type": "application/json" }, body: { website: "bot" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});
