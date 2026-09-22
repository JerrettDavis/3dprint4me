export async function triggerPushWorker(outboxId, {
  url = process.env.PUSH_WORKER_URL,
  secret = process.env.PUSH_WORKER_SECRET,
  fetchImpl = fetch
} = {}) {
  if (!url || !secret || !outboxId) return false;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ outboxId: String(outboxId) }),
      signal: AbortSignal.timeout(3_000)
    });
    return response.ok;
  } catch { return false; }
}
