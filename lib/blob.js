import { head, issueSignedToken, presignUrl } from "@vercel/blob";
import { HttpError } from "./http.js";

export function hasBlob() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)); }

async function sign(pathname, operation, validFor, constraints = {}) {
  if (!hasBlob()) throw new HttpError(503, "Private file storage is not configured.");
  try {
    const validUntil = Date.now() + validFor * 1000;
    const token = await issueSignedToken({ pathname, operations: [operation], validUntil, ...constraints });
    const result = await presignUrl(token, { pathname, operation, access: "private", validUntil,
      ...(operation === "get" ? { useCache: false } : { addRandomSuffix: false, allowOverwrite: false }), ...constraints });
    const parsed = new URL(result.presignedUrl);
    const expectedHost = operation === "put"
      ? parsed.hostname === "vercel.com" && parsed.pathname === "/api/blob/"
      : parsed.hostname.endsWith(".private.blob.vercel-storage.com");
    if (parsed.protocol !== "https:" || !expectedHost || parsed.username || parsed.password) throw new Error("Unexpected signed URL destination");
    return result.presignedUrl;
  } catch (error) {
    console.error("Private Blob signing failed.", error?.name, error?.status ?? "unknown status");
    throw new HttpError(502, "Private file storage is temporarily unavailable.");
  }
}

export async function createSignedUpload(pathname, size, contentType) {
  return { uploadUrl: await sign(pathname, "put", 900, { maximumSizeInBytes: size, ...(contentType ? { allowedContentTypes: [contentType] } : {}) }) };
}
export async function createSignedDownload(pathname, expiresIn = 900) {
  return sign(pathname, "get", expiresIn);
}
export async function inspectPrivateObject(pathname) {
  return head(pathname);
}
