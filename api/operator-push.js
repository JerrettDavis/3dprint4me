import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { parsePushSubscription } from "../lib/work-management/domain.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";
import { HttpError, readJson } from "../lib/http.js";

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "A Push action object is required.");
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
}
function endpoint(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) throw new Error();
    return url.href;
  } catch { throw new HttpError(400, "A valid HTTPS Push endpoint is required."); }
}

export function createPushHandler({ store, runtime, identityProvider, authorize, allowedOrigins = configuredOperatorOrigins(), vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "", pushConfigured = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) } = {}) {
  const work = resolveWorkManagementRuntime({ runtime, repository: store });
  let provider = identityProvider;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, work.repository, provider ??= createNeonIdentityProvider()));
  return createOperatorApiHandler({ methods: ["GET", "POST"], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    if (req.method === "GET") return { supported: pushConfigured, vapidPublicKey: pushConfigured ? vapidPublicKey : null, subscribed: pushConfigured ? await work.service.hasPushSubscription(operator) : false };
    if (!pushConfigured) throw new HttpError(503, "Push notifications are not configured.");
    const body = await readJson(req, 16 * 1024);
    if (body.action === "subscribe") {
      exact(body, ["action", "subscription"]);
      let subscription;
      try { subscription = parsePushSubscription(body.subscription); } catch (error) { throw new HttpError(400, error.message); }
      await work.service.savePushSubscription(operator, subscription, String(req.headers?.["user-agent"] ?? "").slice(0, 300));
      return { subscribed: true };
    }
    if (body.action === "unsubscribe") {
      exact(body, ["action", "endpoint"]);
      await work.service.disablePushSubscription(operator, endpoint(body.endpoint));
      return { subscribed: false };
    }
    if (body.action === "test") {
      exact(body, ["action"]);
      await work.service.queueTestNotification(operator);
      return { queued: true };
    }
    throw new HttpError(400, "A valid Push action is required.");
  } });
}

export default async function handler(req, res) { return createPushHandler()(req, res); }
