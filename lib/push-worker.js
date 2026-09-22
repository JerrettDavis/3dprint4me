import { randomBytes, timingSafeEqual } from "node:crypto";

function authorized(header, secret) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export function createPushWorkerHandler({ secret = process.env.PUSH_WORKER_SECRET, drain }) {
  return async request => {
    if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "Use POST." } }, 405);
    if (!authorized(request.headers.get("authorization"), secret)) return json({ error: { code: "unauthorized", message: "Worker authorization failed." } }, 401);
    try {
      return json(await drain({ workerId: `push_${randomBytes(12).toString("hex")}`, batchSize: 20 }));
    } catch {
      console.error("Push worker failed.");
      return json({ error: { code: "worker_failed", message: "Push delivery could not be completed." } }, 500);
    }
  };
}
