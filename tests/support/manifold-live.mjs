// Leak-guard helper for generator tests. Embind exposes no live-instance counter, so the
// Manifold / CrossSection classes are instrumented: every instance returned by a constructor,
// static or prototype method is recorded as live and removed again on delete(). After build()
// only the returned solids may remain live (and nothing after a failed build).
export function trackLiveObjects(wasm) {
  const live = new Set();
  const restore = [];
  const classes = [wasm.CrossSection, wasm.Manifold];
  const isInst = v => classes.some(C => v instanceof C);
  const wrap = (holder, name, fn) => {
    const wrapped = function (...args) {
      const r = fn.apply(this, args);
      if (isInst(r)) live.add(r);
      // decompose() and similar return arrays of new instances.
      else if (Array.isArray(r)) for (const x of r) if (isInst(x)) live.add(x);
      return r;
    };
    const had = Object.getOwnPropertyDescriptor(holder, name);
    Object.defineProperty(holder, name, { value: wrapped, writable: true, configurable: true });
    restore.push(() => had ? Object.defineProperty(holder, name, had) : delete holder[name]);
  };
  for (const C of classes) {
    for (const name of Object.getOwnPropertyNames(C)) {
      if (typeof C[name] === "function" && !["prototype", "length", "name"].includes(name)) wrap(C, name, C[name]);
    }
    for (let proto = C.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, name);
        if (name === "constructor" || typeof d.value !== "function") continue;
        if (name === "delete") {
          const orig = d.value;
          Object.defineProperty(proto, name, { value: function (...a) { live.delete(this); return orig.apply(this, a); }, writable: true, configurable: true });
          restore.push(() => Object.defineProperty(proto, name, d));
        } else wrap(proto, name, d.value);
      }
    }
  }
  const proxied = C => new Proxy(C, { construct(target, args) { const o = new target(...args); live.add(o); return o; } });
  const ctxWasm = new Proxy(wasm, { get: (t, k) => (k === "CrossSection" ? proxied(wasm.CrossSection) : t[k]) });
  return { live, ctxWasm, restore: () => restore.reverse().forEach(f => f()) };
}
