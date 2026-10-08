// Docked tool windows over the preview canvas. On wide screens "settings" and "info" float at
// the left and right edges; on narrow screens (<= 899 px) they become one bottom sheet with a
// tab strip. Every window has a real button in its title bar (aria-expanded) that collapses it;
// collapsed state and the active tab are remembered (ui-state.js, localStorage, try/catch).
// Escape inside a window moves focus to its title button; Escape on the title button collapses it.
import { setOpen } from "./motion.js";
import { loadUi, saveUi } from "./ui-state.js";

const NARROW = "(max-width: 899px)";

export function initWindows(root, { onLayout = () => {} } = {}) {
  const wins = new Map();
  for (const el of root.querySelectorAll("[data-win]")) {
    wins.set(el.dataset.win, { name: el.dataset.win, el, toggle: el.querySelector(".cz-win-toggle"), body: el.querySelector(".cz-win-body") });
  }
  const tabButtons = [...root.querySelectorAll("[data-sheet-tab]")];
  const sheetToggle = root.querySelector("#cz-sheet-toggle");
  const narrow = globalThis.matchMedia?.(NARROW);
  const isNarrow = () => Boolean(narrow?.matches);
  const saved = loadUi();
  const collapsed = { settings: saved.win?.settings === true, info: saved.win?.info === true };
  let tab = saved.tab === "info" ? "info" : "settings";

  function paint(name, { animate = true } = {}) {
    const win = wins.get(name);
    if (!win) return;
    const open = !collapsed[name];
    win.toggle?.setAttribute("aria-expanded", String(open));
    win.el.classList.toggle("is-collapsed", !open);
    if (animate) setOpen(win.body, open);
    else win.body.hidden = !open;
    if (sheetToggle && name === tab) sheetToggle.setAttribute("aria-expanded", String(open));
  }

  function setCollapsed(name, value, { animate = true, remember = true } = {}) {
    if (collapsed[name] === value && !remember) return;
    collapsed[name] = value;
    paint(name, { animate });
    if (remember) saveUi({ win: { [name]: value } });
    layoutSoon();
  }

  function showTab(next, { remember = true, open = true } = {}) {
    tab = next === "info" ? "info" : "settings";
    root.dataset.sheetTab = tab;
    for (const button of tabButtons) button.setAttribute("aria-pressed", String(button.dataset.sheetTab === tab));
    // Choosing a tab on the bottom sheet opens it: a peeking sheet that switches tab has a reason to show.
    if (open && isNarrow() && collapsed[tab]) setCollapsed(tab, false);
    sheetToggle?.setAttribute("aria-expanded", String(!collapsed[tab]));
    if (remember) saveUi({ tab });
    layoutSoon();
  }

  /** Makes the window (and, on the sheet, its tab) visible and expanded. */
  function reveal(name) {
    if (!wins.has(name)) return;
    if (isNarrow()) showTab(name, { remember: false, open: false });
    if (collapsed[name]) setCollapsed(name, false);
  }

  for (const [name, win] of wins) {
    win.toggle?.addEventListener("click", () => setCollapsed(name, !collapsed[name]));
    win.el.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target === win.toggle || (isNarrow() && event.target === sheetToggle)) {
        if (!collapsed[name]) { event.preventDefault(); setCollapsed(name, true); }
      } else if (win.body.contains(event.target)) {
        event.preventDefault();
        (isNarrow() ? sheetToggle : win.toggle)?.focus();
      }
    });
  }
  for (const button of tabButtons) button.addEventListener("click", () => showTab(button.dataset.sheetTab));
  sheetToggle?.addEventListener("click", () => setCollapsed(tab, !collapsed[tab]));
  sheetToggle?.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && !collapsed[tab]) { event.preventDefault(); setCollapsed(tab, true); }
  });

  // What the floating windows cover, so the viewer can centre the model in the free space.
  function insets() {
    const canvas = root.getBoundingClientRect();
    const out = { left: 0, right: 0, top: 0, bottom: 0 };
    if (!canvas.width) return out;
    if (isNarrow()) {
      const panels = root.querySelector(".cz-panels")?.getBoundingClientRect();
      if (panels?.height) out.bottom = Math.max(0, canvas.bottom - panels.top + 8);
      out.top = 54; // the status chip floats at the top of the canvas
      return out;
    }
    // Room for the hint line (top) and the status chip (bottom).
    out.top = 30;
    out.bottom = 66;
    for (const { el } of wins.values()) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || getComputedStyle(el).display === "none") continue;
      if (rect.left + rect.width / 2 < canvas.left + canvas.width / 2) out.left = Math.max(out.left, rect.right - canvas.left + 12);
      else out.right = Math.max(out.right, canvas.right - rect.left + 12);
    }
    return out;
  }
  let frame = 0;
  function layoutSoon() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const i = insets();
      root.style.setProperty("--cz-inset-l", `${Math.round(i.left)}px`);
      root.style.setProperty("--cz-inset-r", `${Math.round(i.right)}px`);
      root.style.setProperty("--cz-inset-b", `${Math.round(i.bottom)}px`);
      onLayout(i);
    });
  }
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(layoutSoon);
    observer.observe(root);
    for (const { el } of wins.values()) observer.observe(el);
    const panels = root.querySelector(".cz-panels");
    if (panels) observer.observe(panels);
  }
  narrow?.addEventListener?.("change", () => { showTab(tab, { remember: false, open: false }); layoutSoon(); });

  for (const name of wins.keys()) paint(name, { animate: false });
  showTab(tab, { remember: false, open: false });
  layoutSoon();

  return { reveal, showTab, layoutSoon, isCollapsed: name => collapsed[name] === true, isNarrow };
}
