// "Download my model" event from the customizer thank-you dialog. The customer may leave an email
// (optional); nothing else about the model is sent: no settings, no text, no file. Without an
// email the event is a privacy-safe log line; with one, the owner gets a follow-up email.
import { HttpError, handleApiError, isValidEmail, readJson, requireMethod, sendJson } from "../http.js";
import { hasEmailDelivery } from "../notifications.js";

const ACTIONS = new Set(["download", "print"]);
const GENERATOR_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function normalizeDownloadEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");
  const action = String(body.action ?? "");
  const generatorId = String(body.generatorId ?? "");
  if (!ACTIONS.has(action) || !GENERATOR_ID.test(generatorId)) throw new HttpError(400, "Invalid request.");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (email && !isValidEmail(email)) throw new HttpError(400, "That email address doesn't look right.");
  return { action, generatorId, email };
}

const escapeHtml = value => String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);

async function sendOwnerEmail({ generatorId, action, email }, transport = fetch) {
  const response = await transport("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.REQUEST_FROM_EMAIL,
      to: [process.env.REQUEST_TO_EMAIL],
      reply_to: email,
      subject: `Customizer ${action}: ${generatorId}`,
      html: `<p>Someone ${action === "print" ? "asked about a print of" : "downloaded"} their <strong>${escapeHtml(generatorId)}</strong> design and left <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>.</p><p>No settings or file were sent. Reply to follow up.</p>`
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error("Notification unavailable.");
}

export function createDownloadEventHandler({ send = sendOwnerEmail, log = console.info } = {}) {
  return async function downloadEventHandler(req, res) {
    try {
      requireMethod(req, "POST");
      const body = await readJson(req, 2048);
      if (body?.website) return sendJson(res, 200, { ok: true });
      const event = normalizeDownloadEvent(body);
      // The email is never logged.
      log(JSON.stringify({ event: "customizer_download", action: event.action, generatorId: event.generatorId, withEmail: !!event.email }));
      if (event.email && hasEmailDelivery()) {
        try { await send(event); } catch { /* Tracking must never block the customer's file. */ }
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      handleApiError(res, error instanceof HttpError ? error : new HttpError(502, "Unavailable."));
    }
  };
}

export default createDownloadEventHandler();
