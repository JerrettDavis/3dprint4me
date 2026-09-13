import { randomBytes } from "node:crypto";
import { handleApiError, HttpError, readJson, requireMethod, sendJson } from "../lib/http.js";
import { sanitizeFilename, validateRequestId } from "../lib/validation.js";
import { createSignedUpload, hasSupabase, requestRecordExists } from "../lib/supabase.js";

export default async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    if (!hasSupabase()) throw new HttpError(503, "Private file storage is not configured.");
    const body = await readJson(req, 64 * 1024);
    const requestId = validateRequestId(body.requestId);
    const filename = sanitizeFilename(body.filename);
    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) throw new HttpError(400, "Each upload must be between 1 byte and 25 MB.");
    if (!(await requestRecordExists(requestId))) throw new HttpError(404, "The project request does not exist or no longer accepts uploads.");
    const path = `${requestId}/${randomBytes(5).toString("hex")}-${filename}`;
    const signed = await createSignedUpload(path);
    sendJson(res, 200, { mode: "signed", method: "PUT", path, uploadUrl: signed.uploadUrl, headers: { "x-upsert": "false" } });
  } catch (error) { handleApiError(res, error); }
}
