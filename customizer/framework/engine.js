import Module from "manifold-3d";

let pending;
// Browser: pass a locateFile that returns the hashed wasm URL. Node: no argument needed.
// The load is cached: a later call with a different locateFile is ignored while a load
// is cached. A failed load is NOT cached, so it can be retried.
// `moduleLoader` is an injection point for tests only.
export function loadEngine(locateFile, moduleLoader = Module) {
  if (!pending) {
    pending = moduleLoader(locateFile ? { locateFile } : {})
      .then(wasm => { wasm.setup(); return wasm; })
      .catch(e => { pending = undefined; throw e; });
  }
  return pending;
}
