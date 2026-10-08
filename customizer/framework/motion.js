// Motion helpers for the generator page. Every animation is a Web Animations call on
// transform / opacity (and one-off height for collapsing a block), never a gate on state:
// callers set hidden / aria-* immediately or in the promise's finally, and under
// prefers-reduced-motion: reduce nothing animates at all (the promise resolves at once).
export const EASE = "cubic-bezier(.2, .7, .2, 1)";
export const DUR = Object.freeze({ fast: 140, base: 220, slow: 320 });

export function reducedMotion() {
  try { return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches); } catch { return false; }
}

/** Plays keyframes on `el`; resolves when done (or at once when motion is off or unsupported). */
export function play(el, keyframes, { duration = DUR.base, easing = EASE, delay = 0 } = {}) {
  if (!el || typeof el.animate !== "function" || reducedMotion()) return Promise.resolve();
  try {
    const animation = el.animate(keyframes, { duration, easing, delay });
    return animation.finished.then(() => undefined, () => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Shows or hides a block with a height + opacity transition. The `hidden` attribute is the
 * source of truth: it is set to its final value no later than the end of the animation, and an
 * interrupted animation (a second toggle) is cancelled first, so the end state is always right.
 */
export async function setOpen(el, open) {
  if (!el) return;
  el.__czAnim?.cancel?.();
  el.__czAnim = null;
  if (reducedMotion() || typeof el.animate !== "function") {
    el.hidden = !open;
    return;
  }
  if (open) {
    el.hidden = false;
    const full = el.scrollHeight;
    if (!full) return;
    el.style.overflow = "hidden";
    const animation = el.animate([{ height: "0px", opacity: 0 }, { height: `${full}px`, opacity: 1 }], { duration: DUR.base, easing: EASE });
    el.__czAnim = animation;
    try { await animation.finished; } catch { return; } finally { if (el.__czAnim === animation) { el.__czAnim = null; el.style.overflow = ""; } }
  } else {
    const full = el.offsetHeight;
    if (!full) { el.hidden = true; return; }
    el.style.overflow = "hidden";
    const animation = el.animate([{ height: `${full}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: DUR.fast, easing: EASE });
    el.__czAnim = animation;
    try {
      await animation.finished;
      el.hidden = true;
    } catch { return; } finally { if (el.__czAnim === animation) { el.__czAnim = null; el.style.overflow = ""; } }
  }
}

/** Starts a transition-style entrance for an element that was just inserted or revealed. */
export const enter = (el, { y = 6, duration = DUR.base } = {}) => play(el, [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "none" }], { duration });
