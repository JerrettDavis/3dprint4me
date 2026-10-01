import { handleApiError, HttpError, readJson, requireMethod, sendJson } from "../http.js";
import { createEstimateSessionUseCases } from "./application/estimate-session.js";
import { clientAddress, clientSubject } from "./application/rate-limit.js";
import { createPrintEstimationRuntime } from "./runtime.js";

const ACTIONS = Object.freeze({
  create: ["action", "options", "website"],
  "authorize-upload": ["action", "sessionId", "token", "filename", "size", "contentType"],
  analyze: ["action", "sessionId", "token", "assetId", "options"],
  finalize: ["action", "sessionId", "token", "assetId", "options"]
});

function exact(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.hasOwn(ACTIONS, body.action)) throw new HttpError(400, "A supported print estimate action is required.");
  const extra = Object.keys(body).find(key => !ACTIONS[body.action].includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
  return body;
}

/** Thin transport for anonymous print estimates. Model bytes never pass through it. */
export function createPrintEstimateHandler({ getRuntime = createPrintEstimationRuntime, useCases } = {}) {
  const resolveUseCases = () => {
    if (useCases) return useCases;
    const runtime = getRuntime();
    return createEstimateSessionUseCases({
      repository: runtime.repository, fileStore: runtime.fileStore, materialCosts: runtime.materialCosts,
      slicerEnabled: runtime.slicerEnabled, policy: runtime.policy, limits: runtime.limits,
      logFailure: code => console.error("Print model analysis failed.", code)
    });
  };
  return async function printEstimateHandler(req, res) {
    try {
      requireMethod(req, ["GET", "POST"]);
      const estimates = resolveUseCases();
      if (req.method === "GET") {
        const url = new URL(req.url ?? "/api/print-estimate", "https://estimate.invalid");
        sendJson(res, 200, await estimates.status({ sessionId: url.searchParams.get("id"), token: req.headers?.["x-print-estimate-token"] }));
        return;
      }
      const body = exact(await readJson(req, 16 * 1024));
      const client = clientSubject(clientAddress(req), process.env.PRINT_ESTIMATE_RATE_SALT || "");
      if (body.action === "create") {
        if (body.website) { sendJson(res, 201, { ignored: true }); return; }
        sendJson(res, 201, await estimates.create(body, { client }));
      } else if (body.action === "authorize-upload") sendJson(res, 200, await estimates.authorizeUpload(body, { client }));
      else sendJson(res, 200, await estimates.analyze(body, { purpose: body.action === "finalize" ? "submission" : "preview" }));
    } catch (error) {
      handleApiError(res, error);
    }
  };
}

export default createPrintEstimateHandler();
