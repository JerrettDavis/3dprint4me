// HTTP slicer provider contract for a separately hosted worker (container, long-running
// function, or sandbox). The worker receives a short-lived signed download URL for the
// exact private model, never the model bytes through this service, plus the options.
import { SliceError } from "../slicer-contract.js";

export function createHttpSlicer({ url, token, signDownload, fetchImpl = fetch, timeoutMs = 120_000 }) {
  if (!url || !/^https:\/\//.test(url)) throw new TypeError("SLICER_HTTP_URL must be an https URL.");
  if (!token || token.length < 32) throw new TypeError("SLICER_HTTP_TOKEN must be at least 32 characters.");
  return {
    engine: "http",
    needsBytes: false,
    async estimateSlice({ blobPath, filename, options, timeoutMs: limit = timeoutMs }) {
      if (!blobPath) throw new SliceError("asset_missing", "No private model path was provided.");
      const modelUrl = await signDownload(blobPath, 600);
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1, modelUrl, filename, options }),
          signal: AbortSignal.timeout(limit)
        });
      } catch (error) {
        throw new SliceError(error?.name === "TimeoutError" ? "timeout" : "unavailable", "The slicer worker could not be reached.");
      }
      if (response.status === 422) throw new SliceError("unsupported", "The slicer worker rejected the model.");
      if (!response.ok) throw new SliceError(response.status >= 500 ? "unavailable" : "slicer_failed", `The slicer worker returned ${response.status}.`);
      const body = await response.json().catch(() => null);
      if (!body || typeof body !== "object") throw new SliceError("invalid_output", "The slicer worker returned invalid JSON.");
      return body;
    }
  };
}
