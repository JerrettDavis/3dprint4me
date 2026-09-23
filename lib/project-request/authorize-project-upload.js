import { HttpError } from "../http.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function authorizeProjectUploadUseCase({ validateId, sanitizeName, randomHex, getRuntime }) {
  return async function authorizeProjectUpload(body) {
    const runtime = getRuntime();
    if (!runtime.requestRepository || !runtime.privateFileStore) throw new HttpError(503, "Private file storage is not configured.");
    const requestId = validateId(body?.requestId);
    const filename = sanitizeName(body?.filename);
    const size = Number(body?.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new HttpError(400, "Each upload must be between 1 byte and 25 MB.");
    if (!(await runtime.requestRepository.acceptsUploads(requestId))) throw new HttpError(404, "The project request does not exist or no longer accepts uploads.");
    const path = `${requestId}/${randomHex()}-${filename}`;
    const signed = await runtime.privateFileStore.authorizeUpload(path, size, body?.contentType);
    return {
      mode: "signed",
      method: "PUT",
      path,
      uploadUrl: signed.uploadUrl,
      bodyType: runtime.privateFileStore.bodyType,
      headers: runtime.privateFileStore.headers
    };
  };
}
