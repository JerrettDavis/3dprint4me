// Build worker: keeps Manifold WASM geometry off the main thread. The request handling (and
// the load-failure vs build-error classification) lives in worker-core.js.
import { loadEngine } from "./engine.js";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { buildModel } from "./model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { loadBuilder } from "../generators/index.js";
import { loadFont } from "./fonts.js";
import { handleBuildRequest } from "./worker-core.js";

const deps = { getGenerator, loadBuilder, loadEngine: () => loadEngine(() => wasmUrl), loadFont, buildModel };

self.onmessage = async ({ data }) => {
  const { message, transfer } = await handleBuildRequest(data, deps);
  self.postMessage(message, transfer);
};
