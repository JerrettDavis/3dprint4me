import { randomBytes } from "node:crypto";

import { issueCheckoutToken } from "../checkout/proof.js";
import { handleApiError, HttpError, readJson, requireMethod, sendJson } from "../http.js";
import { completeProjectRequestUseCase } from "./complete-project-request.js";
import { createProjectRequestUseCase } from "./create-project-request.js";
import { normalizeProjectRequest, normalizeUploadedFiles, validateRequestId } from "./domain.js";
import { createProjectRequestRuntime } from "./runtime.js";

function requestId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `3DP-${date}-${randomBytes(10).toString("hex").toUpperCase()}`;
}

export function createProjectRequestHandler({
  getRuntime = createProjectRequestRuntime,
  newRequestId = requestId,
  normalizeRequest = normalizeProjectRequest,
  normalizeFiles = normalizeUploadedFiles,
  validateId = validateRequestId,
  issueCheckoutProof = issueCheckoutToken
} = {}) {
  const create = createProjectRequestUseCase({ normalizeRequest, newRequestId, getRuntime });
  const complete = completeProjectRequestUseCase({ normalizeRequest, normalizeFiles, validateId, issueCheckoutProof, getRuntime });
  return async function projectRequestHandler(req, res) {
    try {
      requireMethod(req, ["POST", "PATCH"]);
      const body = await readJson(req);
      const action = req.method === "PATCH" ? "complete" : "create";
      if (body.action && body.action !== action) throw new HttpError(400, `Use ${req.method} to ${action} a project request.`);
      const result = action === "complete" ? await complete(body) : await create(body);
      sendJson(res, action === "complete" ? 200 : 201, result);
    } catch (error) {
      handleApiError(res, error);
    }
  };
}

export default createProjectRequestHandler();
