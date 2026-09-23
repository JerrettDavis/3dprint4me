import { createHmac, randomBytes } from "node:crypto";

import { handleApiError, HttpError, readJson, requireMethod, sendJson } from "../http.js";
import { completeInquiryUseCase } from "./complete-inquiry.js";
import { createInquiryUseCase } from "./create-inquiry.js";
import { normalizeInquiry, validateSubmissionKey } from "./domain.js";
import { createQuickInquiryRuntime } from "./runtime.js";

export function createInquiryHandler(deps = {}) {
  return async function inquiryHandler(req, res) {
    try {
      requireMethod(req, ["POST", "PATCH"]);
      const body = await readJson(req, 32768);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid inquiry.");
      if (Buffer.byteLength(JSON.stringify(body)) > 32768) throw new HttpError(413, "Request body is too large.");
      if (body.website) return sendJson(res, 200, { live: false, mode: "ignored", uploads: [] });

      const runtime = createQuickInquiryRuntime(deps);
      if (!runtime.configured) return sendJson(res, 200, { live: false, mode: "local", uploads: [] });
      const address = process.env.VERCEL ? String(req.headers?.["x-vercel-forwarded-for"] || "unknown").split(",")[0].trim() : "local";
      const rateKey = createHmac("sha256", process.env.DATABASE_URL || "test").update(address).digest("hex");
      await runtime.repository.rate(rateKey);

      if (req.method === "POST") {
        const create = createInquiryUseCase({
          normalize: normalizeInquiry,
          repository: runtime.repository,
          privateFiles: runtime.privateFiles,
          newId: () => `INQ-${randomBytes(16).toString("hex")}`,
          randomHex: () => randomBytes(12).toString("hex")
        });
        const { row, uploads } = await create(body);
        if (row.status !== "submitted") return sendJson(res, 201, { id: row.id, live: false, mode: "neon", uploads });
        try { await runtime.notify(row); } catch { /* Durable acceptance remains true. */ }
        return sendJson(res, 200, { id: row.id, live: true, mode: "neon", uploads: [] });
      }

      const complete = completeInquiryUseCase({
        validateKey: validateSubmissionKey,
        repository: runtime.repository,
        privateFiles: runtime.privateFiles ?? { matches: async () => false },
        notify: runtime.notify
      });
      const row = await complete(body);
      sendJson(res, 200, { id: row.id, live: true, mode: "neon", uploads: [] });
    } catch (error) {
      handleApiError(res, error instanceof HttpError ? error : new HttpError(502, "Inquiry temporarily unavailable."));
    }
  };
}

export default createInquiryHandler();
