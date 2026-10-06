import { HttpError } from "./http.js";
import * as blobStore from "./blob.js";
import { createSignedDownload as createSupabaseDownload, hasSupabase } from "./supabase.js";

export const REQUEST_FILE_TTL_SECONDS = 60;

async function defaultSign(path, ttl) {
  if (blobStore.hasBlob()) return blobStore.createSignedDownload(path, ttl);
  if (hasSupabase()) return createSupabaseDownload(path, ttl);
  throw new HttpError(503, "Private file storage is not configured.");
}

/** Short-lived download link for one file the customer attached to the request itself (not an estimate model). */
export async function signRequestFile({ work, index, sign = defaultSign, now = () => new Date() }) {
  const requestId = work?.item?.requestId;
  const position = Number(index);
  const file = Number.isInteger(position) ? work?.files?.[position] : undefined;
  if (!requestId || !file) throw new HttpError(404, "That file is not attached to this work item.");
  const path = typeof file.path === "string" ? file.path : "";
  if (!path || file.mode === "estimate") throw new HttpError(404, "That file was not stored for download.");
  if (!path.startsWith(`${requestId}/`) || path.includes("\\") || path.includes("//") || path.split("/").some(segment => segment === ".." || segment === ".")) {
    throw new HttpError(404, "That file is not attached to this work item.");
  }
  const url = await sign(path, REQUEST_FILE_TTL_SECONDS);
  return { url, filename: file.name ?? "attachment", expiresAt: new Date(now().getTime() + REQUEST_FILE_TTL_SECONDS * 1000).toISOString() };
}
