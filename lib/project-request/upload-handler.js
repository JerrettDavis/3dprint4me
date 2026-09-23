import { randomBytes } from "node:crypto";

import { handleApiError, readJson, requireMethod, sendJson } from "../http.js";
import { authorizeProjectUploadUseCase } from "./authorize-project-upload.js";
import { sanitizeFilename, validateRequestId } from "./domain.js";
import { createProjectRequestRuntime } from "./runtime.js";

export function createProjectUploadHandler({
  getRuntime = createProjectRequestRuntime,
  validateId = validateRequestId,
  sanitizeName = sanitizeFilename,
  randomHex = () => randomBytes(5).toString("hex")
} = {}) {
  const authorize = authorizeProjectUploadUseCase({ validateId, sanitizeName, randomHex, getRuntime });
  return async function projectUploadHandler(req, res) {
    try {
      requireMethod(req, "POST");
      const body = await readJson(req, 64 * 1024);
      sendJson(res, 200, await authorize(body));
    } catch (error) {
      handleApiError(res, error);
    }
  };
}

export default createProjectUploadHandler();
