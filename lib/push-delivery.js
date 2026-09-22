import webpush from "web-push";

export function buildNewWorkNotification({ eventId, workId }) {
  const safeEventId = String(eventId);
  const safeWorkId = String(workId);
  return {
    version: 1,
    title: "New 3dprint4.me work request",
    body: "Open the work inbox to review it.",
    tag: `work-${safeEventId}`,
    data: { route: `/work/${safeWorkId}`, eventId: safeEventId, workId: safeWorkId }
  };
}

function classify(error) {
  const status = Number(error?.statusCode ?? error?.status);
  if (status === 404 || status === 410) return { state: "disabled", category: "endpoint_expired" };
  if (status === 408 || status === 425 || status === 429 || status >= 500 || !status) return { state: "retrying", category: "provider_temporary" };
  return { state: "failed", category: "subscription_invalid" };
}

export async function drainPushOutbox({ store, transport, workerId, batchSize = 20 }) {
  const summary = { claimed: 0, delivered: 0, disabled: 0, retrying: 0, failed: 0 };
  const entries = await store.claimPushOutbox({ workerId, batchSize });
  summary.claimed = entries.length;
  for (const entry of entries) {
    const entrySummary = { delivered: 0, disabled: 0, retrying: 0, failed: 0 };
    const subscriptions = await store.listPushSubscriptions(entry);
    for (const subscription of subscriptions) {
      let outcome;
      try {
        await transport.send(subscription, JSON.stringify(buildNewWorkNotification({ eventId: entry.eventId, workId: entry.payload.workId })));
        outcome = { state: "delivered", category: null };
      } catch (error) { outcome = classify(error); }
      summary[outcome.state] += 1;
      entrySummary[outcome.state] += 1;
      await store.recordPushOutcome({ outboxId: entry.id, subscriptionId: subscription.id, ...outcome });
    }
    await store.finishPushOutbox(entry.id, entrySummary);
  }
  return summary;
}

export function createWebPushTransport({ subject = process.env.VAPID_SUBJECT, publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY } = {}) {
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID configuration is incomplete.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { send(subscription, payload) { return webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, { TTL: 300, timeout: 10_000 }); } };
}
