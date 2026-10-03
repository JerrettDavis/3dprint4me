import Module from "manifold-3d";

let pending;
// Browser: pass a locateFile that returns the hashed wasm URL. Node: no argument needed.
export function loadEngine(locateFile) {
  if (!pending) {
    pending = Module(locateFile ? { locateFile } : {}).then(wasm => { wasm.setup(); return wasm; });
  }
  return pending;
}
