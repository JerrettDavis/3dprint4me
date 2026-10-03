// Build-worker request handler, separated from worker.js (which only wires Vite's WASM URL
// and `self`) so it can be tested in Node with injected loaders.
//
// Failures are classified for the page:
// - loading the builder itself (Manifold WASM, the generator's builder module, a curated font
//   from this site) is environmental: { retryable: true, code: "load-failed" }. The customer's
//   settings are fine; the connection or the server hiccupped, and trying again can work.
// - anything else (geometry, validation, the customer's own font file) is a build error and
//   is reported as-is, without `retryable`.
export const LOAD_FAILED = "load-failed";

export const loadFailure = error => Object.assign(error instanceof Error ? error : new Error(String(error)), { retryable: true, code: LOAD_FAILED });

async function loading(step) {
  try {
    return await step();
  } catch (error) {
    throw loadFailure(error);
  }
}

/**
 * Handles one build request and returns the message to post back.
 * deps: { getGenerator, loadBuilder, loadEngine, loadFont, buildModel }.
 * loadFont tags its own environmental failures (curated font fetch/parse) as load failures;
 * a customer font that won't parse stays a build error.
 */
export async function handleBuildRequest(data, deps) {
  const { id, generatorId, params, fontId, fontBytes, fontKey, imageContours = null } = data ?? {};
  try {
    const def = deps.getGenerator(generatorId);
    if (!def || !Object.hasOwn(deps.loadBuilder, generatorId)) throw new Error("Unknown generator.");
    const wasm = await loading(() => deps.loadEngine());
    const { default: build } = await loading(() => deps.loadBuilder[generatorId]());
    const font = await deps.loadFont({ fontId, fontBytes, fontKey });
    const out = await deps.buildModel({ ...def, build }, params, { wasm, font, imageContours });
    return { message: { id, ok: true, result: out }, transfer: [out.data.buffer] };
  } catch (error) {
    const message = { id, ok: false, error: String(error?.message ?? error).slice(0, 300) };
    if (error?.retryable) Object.assign(message, { retryable: true, code: typeof error.code === "string" ? error.code : LOAD_FAILED });
    return { message, transfer: [] };
  }
}
