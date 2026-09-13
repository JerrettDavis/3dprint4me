import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiError, HttpError, readJson, requireMethod, sendJson } from "../lib/http.js";
import { normalizeProjectRequest, normalizeUploadedFiles, validateRequestId } from "../lib/validation.js";
import { completeRequestRecord, createRequestRecord, hasSupabase } from "../lib/supabase.js";
import { hasEmailDelivery, hasWebhookDelivery, postRequestWebhook, sendRequestEmails } from "../lib/notifications.js";
import { issueCheckoutToken } from "../lib/checkout-token.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const newRequestId = () => `3DP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(10).toString("hex").toUpperCase()}`;

async function localLog(event) {
  if (process.env.LOCAL_DEV !== "1") return;
  const path = join(root, "data", "dev-requests.ndjson");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ ...event, loggedAt: new Date().toISOString() })}\n`, "utf8");
}
function integrationMode() {
  if (hasSupabase()) return "supabase";
  if (hasEmailDelivery() || hasWebhookDelivery()) return "delivery";
  return "local";
}

async function create(body) {
  const id = newRequestId();
  if (body.website) return { id, mode: "ignored", live: true };
  const request = normalizeProjectRequest(body.request);
  if (hasSupabase()) await createRequestRecord(id, request);
  await localLog({ event: "create", id, request });
  return { id, mode: integrationMode(), live: hasSupabase() };
}

async function complete(body) {
  const id = validateRequestId(body.id);
  const request = normalizeProjectRequest(body.request);
  const files = normalizeUploadedFiles(body.uploadedFiles, id);
  const results = { database: false, email: false, webhook: false };
  if (hasSupabase()) { await completeRequestRecord(id, request, files); results.database = true; }
  await localLog({ event: "complete", id, request, files });
  const [emailResult, webhookResult] = await Promise.allSettled([sendRequestEmails(id, request, files), postRequestWebhook(id, request, files)]);
  if (emailResult.status === "fulfilled") results.email = Boolean(emailResult.value.owner); else console.error("Request email notification failed.");
  if (webhookResult.status === "fulfilled") results.webhook = webhookResult.value.delivered; else console.error("Request webhook failed.");
  const live = Object.values(results).some(Boolean);
  return { id, mode: integrationMode(), live, integrations: results, checkoutToken: live ? issueCheckoutToken(id, request.contact.email, request.projectTitle) : null };
}

export default async function handler(req, res) {
  try {
    requireMethod(req, ["POST", "PATCH"]);
    const body = await readJson(req);
    const action = req.method === "PATCH" ? "complete" : "create";
    if (body.action && body.action !== action) throw new HttpError(400, `Use ${req.method} to ${action} a project request.`);
    const result = action === "complete" ? await complete(body) : await create(body);
    sendJson(res, action === "complete" ? 200 : 201, result);
  } catch (error) { handleApiError(res, error); }
}
