// Build worker: keeps Manifold WASM geometry off the main thread.
import { loadEngine } from "./engine.js";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { buildModel } from "./model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { loadBuilder } from "../generators/index.js";
import { loadFont } from "./fonts.js";

self.onmessage = async ({ data: { id, generatorId, params, fontId, fontBytes, fontKey } }) => {
  try {
    const def = getGenerator(generatorId);
    if (!def || !Object.hasOwn(loadBuilder, generatorId)) throw new Error("Unknown generator.");
    const wasm = await loadEngine(() => wasmUrl);
    const { default: build } = await loadBuilder[generatorId]();
    const font = await loadFont({ fontId, fontBytes, fontKey });
    const out = await buildModel({ ...def, build }, params, { wasm, font });
    self.postMessage({ id, ok: true, result: out }, [out.data.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error).slice(0, 300) });
  }
};
