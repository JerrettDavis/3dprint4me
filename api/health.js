import { withPlatformProxy } from "../lib/platform/proxy.js";
import { handleApiError, requireMethod, sendJson } from "../lib/http.js";
import { hasSupabase } from "../lib/supabase.js";
import { hasNeon } from "../lib/neon.js";
import { hasBlob } from "../lib/blob.js";
import { hasEmailDelivery, hasWebhookDelivery } from "../lib/notifications.js";
import { printEstimationAvailable } from "../lib/print-estimation/runtime.js";
import { databaseProvider } from '../lib/database.js';

async function handler(req, res) {
  try {
    requireMethod(req, "GET");
    sendJson(res, 200, { ok: true, service: "3dprint4.me", version: "1.0.0", databaseProvider: databaseProvider(), integrations: { database: hasNeon(), supabase: hasSupabase(), neon: hasNeon() && databaseProvider() === 'neon', postgres: hasNeon() && databaseProvider() === 'postgres', privateFiles: hasBlob() || hasSupabase(), email: hasEmailDelivery(), webhook: hasWebhookDelivery(), stripe: Boolean(process.env.STRIPE_SECRET_KEY), printEstimation: printEstimationAvailable() }, time: new Date().toISOString() });
  } catch (error) { handleApiError(res, error); }
}

export default withPlatformProxy(handler);
