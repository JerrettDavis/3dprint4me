// The two "explore" controls of a generator page: the ready-made design gallery and the
// per-setting locks that Randomize respects. DOM only; the choices themselves live in
// designs.js and randomize.js, and the page (app.js) applies the results.
import { designGroups, designSwatches, designsOf } from "./designs.js";
import { esc } from "./form.js";
import { isRandomizable } from "./randomize.js";

const LOCK_SVG = `<svg class="cz-lock-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path class="cz-lock-open" d="M5 7V5a3 3 0 0 1 5.6-1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="cz-lock-shut" d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor"/></svg>`;

/**
 * Adds a padlock to every setting Randomize may change. A locked setting keeps its value.
 * The field wrappers are re-parented (never re-rendered) when the settings are regrouped, so the
 * buttons survive. Returns { locked(): Set, clear(), count() }.
 */
export function mountLocks(container, generator, { onChange = () => {} } = {}) {
  const locked = new Set();
  for (const wrapper of container.querySelectorAll(".cz-field[data-field]")) {
    const key = wrapper.dataset.field;
    const def = generator.schema[key];
    if (!isRandomizable(def)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cz-lock";
    button.dataset.lock = key;
    button.setAttribute("aria-pressed", "false");
    const label = def.label ?? key;
    button.setAttribute("aria-label", `Lock ${label}`);
    button.title = "Lock this setting so Randomize leaves it alone";
    button.innerHTML = LOCK_SVG;
    wrapper.prepend(button);
    wrapper.classList.add("has-lock");
  }
  container.addEventListener("click", event => {
    const button = event.target.closest?.("button.cz-lock");
    if (!button || !container.contains(button)) return;
    const key = button.dataset.lock;
    const on = !locked.has(key);
    if (on) locked.add(key); else locked.delete(key);
    button.setAttribute("aria-pressed", String(on));
    button.title = on ? "Locked: Randomize keeps this setting" : "Lock this setting so Randomize leaves it alone";
    button.closest(".cz-field")?.classList.toggle("is-locked", on);
    onChange(locked);
  });
  return {
    locked: () => new Set(locked),
    count: () => locked.size,
    clear() {
      locked.clear();
      for (const button of container.querySelectorAll("button.cz-lock")) {
        button.setAttribute("aria-pressed", "false");
        button.closest(".cz-field")?.classList.remove("is-locked");
      }
      onChange(locked);
    }
  };
}

/**
 * The gallery: a disclosure button and a list of design cards (a color swatch, the name and a
 * one-line description). Pressing a card calls onPick(design). Returns { element, setCurrent }.
 */
export function createDesignPanel(generator, { open = false, onPick = () => {} } = {}) {
  const designs = designsOf(generator);
  const section = document.createElement("section");
  section.className = "cz-designs";
  section.setAttribute("aria-labelledby", "cz-designs-title");
  const groups = designGroups(generator).map(({ label, designs: list }) => `
    <div class="cz-design-group" role="group" aria-label="${esc(label)}">
      <h3 class="cz-design-group-title">${esc(label)}</h3>
      <div class="cz-design-grid">${list.map(d => `
        <button class="cz-design" type="button" data-design="${esc(d.id)}" aria-pressed="false">
          <span class="cz-swatches" aria-hidden="true">${designSwatches(generator, d).map(c => `<span style="background:${esc(c)}"></span>`).join("")}</span>
          <span class="cz-design-name">${esc(d.label)}${d.id === generator.defaultDesign ? ` <span class="cz-design-default">default</span>` : ""}</span>
          <span class="cz-design-blurb">${esc(d.blurb)}</span>
        </button>`).join("")}
      </div>
    </div>`).join("");
  section.innerHTML = `
    <div class="cz-designs-head">
      <h2 class="cz-designs-title" id="cz-designs-title">Start from a design</h2>
      <button class="button ghost small-button" type="button" id="cz-designs-toggle" aria-expanded="${open}" aria-controls="cz-designs-list">${open ? "Hide" : `Browse ${designs.length}`}</button>
    </div>
    <p class="cz-designs-current" id="cz-designs-current" aria-live="polite"></p>
    <div class="cz-designs-list" id="cz-designs-list"${open ? "" : " hidden"}>
      <p class="help">Pick one to replace the settings below, then change anything. Choosing a design replaces the text and colors; use Undo to go back.</p>
      ${groups}
    </div>`;
  const toggle = section.querySelector("#cz-designs-toggle");
  const list = section.querySelector("#cz-designs-list");
  const current = section.querySelector("#cz-designs-current");
  const paintToggle = () => { toggle.textContent = toggle.getAttribute("aria-expanded") === "true" ? "Hide" : `Browse ${designs.length}`; };
  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(next));
    list.hidden = !next;
    paintToggle();
  });
  list.addEventListener("click", event => {
    const card = event.target.closest?.("button.cz-design");
    const design = card && designs.find(d => d.id === card.dataset.design);
    if (design) onPick(design);
  });
  return {
    element: section,
    /** Marks the chosen design; `modified` notes later edits. A null id shows "Custom". */
    setCurrent(id, { modified = false } = {}) {
      for (const card of list.querySelectorAll("button.cz-design")) card.setAttribute("aria-pressed", String(card.dataset.design === id && !modified));
      const design = designs.find(d => d.id === id);
      current.textContent = design ? `Based on ${design.label}${modified ? ", with your changes" : ""}.` : "Your own settings.";
    },
    collapse() {
      toggle.setAttribute("aria-expanded", "false");
      list.hidden = true;
      paintToggle();
    }
  };
}
