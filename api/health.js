import { handleApiError, requireMethod, sendJson } from "../lib/http.js";
import { hasSupabase } from "../lib/supabase.js";
import { hasNeon } from "../lib/neon.js";
import { hasBlob } from "../lib/blob.js";
import { hasEmailDelivery, hasWebhookDelivery } from "../lib/notifications.js";

export default async function handler(req, res) {
  try {
    requireMethod(req, "GET");
    sendJson(res, 200, { ok: true, service: "3dprint4.me", version: "1.0.0", integrations: { supabase: hasSupabase(), neon: hasNeon(), privateFiles: hasBlob() || hasSupabase(), email: hasEmailDelivery(), webhook: hasWebhookDelivery(), stripe: Boolean(process.env.STRIPE_SECRET_KEY) }, time: new Date().toISOString() });
  } catch (error) { handleApiError(res, error); }
}
