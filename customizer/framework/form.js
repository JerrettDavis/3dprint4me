// Schema-driven parameter form. renderFormHtml is pure (testable in Node);
// renderForm wires it to the DOM. No Vite-only imports here.
import { sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";
import { fontNeedsLicense } from "../../public/assets/js/customize/fonts.js";
import { GENERAL, fieldSection, hasSections, sectionLabel, sectionList } from "./sections.js";
import { DUR, EASE, play, reducedMotion, setOpen } from "./motion.js";

export { hasSections };

export const SENSITIVE_NOTE = "This is encoded in your model file. The file is stored privately like any upload and seen by us when we print it. It is not copied into our request records, emails or your saved draft.";
const GROUP_LABELS = { text: "Text", size: "Size and depth", layout: "Text layout", back: "Back", colors: "Colors" };
const DEBOUNCE_MS = 150;
// Arrow keys in a picker move the choice one step at a time; the choice commits (and the model
// rebuilds) once they settle, or at once on Enter or a click.
const PICKER_SETTLE_MS = 450;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
export const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ESCAPES[ch]);

const slug = key => String(key).replace(/[^A-Za-z0-9_-]/g, "-");
const controlId = key => `cz-${slug(key)}`;
const groupLabel = group => GROUP_LABELS[group] ?? (group ? group.charAt(0).toUpperCase() + group.slice(1) : "Options");
const isNumeric = def => def.type === "number" || def.type === "int";
const attr = (name, value) => (value === undefined || value === null ? "" : ` ${name}="${esc(value)}"`);

// Error wiring shared by every field: the message element always exists (empty when the
// field is fine) so ids stay stable; an invalid control gets aria-invalid and the message
// id merged into aria-describedby. data-describedby keeps the base list for later updates.
const errorId = key => `${controlId(key)}-error`;
function describe(base, key, error) {
  const ids = error ? [...base, errorId(key)] : base;
  return `${ids.length ? ` aria-describedby="${ids.join(" ")}"` : ""} data-describedby="${base.join(" ")}"${error ? ` aria-invalid="true"` : ""}`;
}
// The slot sits in a wrapper that opens and closes with a transition (see styles.css .cz-err).
const errorSlot = (key, error) => `<div class="cz-err${error ? " is-open" : ""}"><p class="cz-field-error" id="${errorId(key)}">${esc(error ?? "")}</p></div>`;

function numberField(key, def, value, error) {
  const id = controlId(key);
  const step = def.step ?? (def.type === "int" ? 1 : "any");
  const unit = def.unit ? ` <span class="cz-unit">(${esc(def.unit)})</span>` : "";
  const bounds = `${attr("min", def.min)}${attr("max", def.max)}${attr("step", step)}${attr("value", value)}`;
  // def.help: e.g. "0 = automatic / centered". Both controls point at it.
  const base = def.help ? [`${id}-help`] : [];
  return `<div class="cz-field cz-field-number" data-field="${esc(key)}">
  <label class="cz-label" id="${id}-label" for="${id}">${esc(def.label ?? key)}${unit}</label>
  <div class="cz-number-row">
    <input class="cz-range" type="range" id="${id}-range" data-for="${esc(key)}" aria-label="${esc(def.label ?? key)} slider"${bounds}${describe(base, key, error)}>
    <input class="input cz-number" type="number" id="${id}" name="${esc(key)}"${bounds} inputmode="decimal"${describe(base, key, error)}>
  </div>
  ${errorSlot(key, error)}${def.help ? `
  <p class="help" id="${id}-help">${esc(def.help)}</p>` : ""}
</div>`;
}

// Sensitive text (a Wi-Fi password) is a secret for the customer's network, not a login for
// this site. A type="password" box (or a field named like a credential) makes browsers offer to
// save it as the 3dprint4.me password and autofill a saved site login into the form, so the
// control is a plain single-line text box masked by CSS (-webkit-text-security, class
// cz-secret), with no form name and every password-manager opt-out. Browsers without CSS
// masking get a password box with autocomplete="new-password" at runtime (secretInputAttributes),
// which is never autofilled. A <textarea> cannot be masked, so multiline is ignored for secrets.
const SECRET_ATTRS = ' autocomplete="off" data-lpignore="true" data-1p-ignore data-form-type="other" spellcheck="false" autocapitalize="off" autocorrect="off"';

/** The masked control's type/autocomplete for a browser with (true) or without CSS text masking. */
export const secretInputAttributes = cssMasking => (cssMasking ? { type: "text", autocomplete: "off" } : { type: "password", autocomplete: "new-password" });

function textField(key, def, value, error) {
  const id = controlId(key);
  const base = [`${id}-help`];
  const note = def.sensitive ? `<p class="cz-sensitive-note" id="${id}-note">${esc(SENSITIVE_NOTE)}</p>` : "";
  if (def.sensitive) base.push(`${id}-note`);
  const multiline = def.multiline && !def.sensitive;
  const common = `id="${id}" name="${esc(key)}"${attr("maxlength", def.max)}${describe(base, key, error)}`;
  // def.help: the field's own wording (e.g. a secret that is required only in some cases).
  const helpText = def.help ? esc(def.help) : `${def.optional ? "Optional. " : ""}Up to ${esc(def.max)} characters${multiline ? ", one line per row" : ""}.`;
  const help = `<p class="help" id="${id}-help">${helpText}</p>`;
  const control = def.sensitive
    // A secret is never written into markup; setValues() sets the live .value property instead.
    ? `<input type="text" class="input cz-secret" id="${id}" data-key="${esc(key)}"${attr("maxlength", def.max)}${describe(base, key, error)}${SECRET_ATTRS}>`
    : multiline
      ? `<textarea class="textarea cz-textarea" ${common} rows="4" spellcheck="false">${esc(value)}</textarea>`
      : `<input class="input" type="text" ${common} autocomplete="off" spellcheck="false"${attr("value", value)}>`;
  return `<div class="cz-field cz-field-text" data-field="${esc(key)}">
  <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  ${control}
  ${errorSlot(key, error)}
  ${help}${note}
</div>`;
}

function enumField(key, def, value, error) {
  if (def.picker === "font") return fontPickerField(key, def, value, error);
  const id = controlId(key);
  const base = def.help ? [`${id}-help`] : [];
  const options = (def.options ?? []).map(o => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label ?? o.value)}</option>`).join("");
  return `<div class="cz-field cz-field-enum" data-field="${esc(key)}">
  <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  <select class="select" id="${id}" name="${esc(key)}"${describe(base, key, error)}>${options}</select>
  ${errorSlot(key, error)}${def.help ? `\n  <p class="help" id="${id}-help">${esc(def.help)}</p>` : ""}
</div>`;
}

// Font picker: a toggle button showing the current font (drawn in that font) that opens a
// radio group whose labels are each drawn in their own font (classes cz-ff-<face>, declared
// by the page's same-origin @font-face sheet). Radios give native keyboard behavior: Tab
// enters the group, arrows move the choice. The list stays out of the DOM's rendering (and
// its fonts are not downloaded) until it is opened.
const faceClass = o => `cz-ff-${slug(o.face ?? o.value)}`;
function fontPickerField(key, def, value, error) {
  const id = controlId(key);
  const options = def.options ?? [];
  const current = options.find(o => o.value === value) ?? options[0];
  // Options may carry `group` (a category label): a heading is drawn whenever it changes, in
  // option order (never sorted, so arrow-key order stays the option order). An ungrouped option
  // after grouped ones gets a plain divider.
  const grouped = options.some(o => o.group);
  let lastGroup = null;
  const radios = options.map(o => {
    const rid = `${id}-${slug(o.value)}`;
    let heading = "";
    if (grouped && (o.group ?? null) !== lastGroup) {
      lastGroup = o.group ?? null;
      heading = lastGroup ? `<div class="cz-picker-group" role="presentation">${esc(lastGroup)}</div>
    ` : `<div class="cz-picker-group cz-picker-group-plain" role="presentation"></div>
    `;
    }
    return `${heading}<div class="cz-picker-item"><input class="cz-picker-radio" type="radio" name="${esc(key)}" id="${rid}" value="${esc(o.value)}"${o.value === value ? " checked" : ""}${describe([], key, error)}>
    <label for="${rid}" class="cz-picker-option ${faceClass(o)}">${esc(o.label ?? o.value)}</label></div>`;
  }).join("\n    ");
  return `<div class="cz-field cz-field-picker" data-field="${esc(key)}" data-picker="${esc(def.picker)}">
  <span class="cz-label" id="${id}-label">${esc(def.label ?? key)}</span>
  <button class="cz-picker-toggle" type="button" id="${id}-toggle" aria-expanded="false" aria-controls="${id}-list" aria-labelledby="${id}-label ${id}-toggle"><span class="cz-picker-current ${faceClass(current)}">${esc(current?.label ?? "")}</span></button>
  <fieldset class="cz-picker-list" id="${id}-list" hidden>
    <legend class="visually-hidden">${esc(def.label ?? key)}</legend>
    <div class="cz-picker-scroll">
    ${radios}
    </div>
  </fieldset>
  ${errorSlot(key, error)}
</div>`;
}

function boolField(key, def, value, error) {
  const id = controlId(key);
  const base = def.help ? [`${id}-help`] : [];
  return `<div class="cz-field cz-field-bool" data-field="${esc(key)}">
  <div class="cz-inline">
    <input class="cz-checkbox" type="checkbox" id="${id}" name="${esc(key)}"${value ? " checked" : ""}${describe(base, key, error)}>
    <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  </div>
  ${errorSlot(key, error)}${def.help ? `
  <p class="help" id="${id}-help">${esc(def.help)}</p>` : ""}
</div>`;
}

function colorField(key, def, value, error) {
  const id = controlId(key);
  return `<div class="cz-field cz-field-color" data-field="${esc(key)}">
  <div class="cz-inline">
    <input class="cz-color" type="color" id="${id}" name="${esc(key)}"${attr("value", value)}${describe([], key, error)}>
    <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  </div>
  ${errorSlot(key, error)}
</div>`;
}

const RENDERERS = { number: numberField, int: numberField, text: textField, enum: enumField, bool: boolField, color: colorField };

/**
 * visibleWhen shows a field only while it holds (display only; validation ignores it):
 * { key: value | [values], ... } needs every listed parameter to have that value (or one of
 * those values); a function (params) => boolean decides on its own.
 */
export const isFieldVisible = (def, params) => {
  const when = def.visibleWhen;
  if (!when) return true;
  if (typeof when === "function") return Boolean(when(params ?? {}));
  return Object.entries(when).every(([k, v]) => (Array.isArray(v) ? v.includes(params?.[k]) : params?.[k] === v));
};

/** Summary text for the form-level live region: unkeyed messages in full, keyed ones as a pointer. */
export function summaryHtml(errors = [], fieldErrors = {}) {
  const keyed = new Set(Object.values(fieldErrors));
  const loose = errors.filter(e => !keyed.has(e));
  const parts = [];
  if (keyed.size) parts.push(`<p class="cz-errors-title">${keyed.size === 1 ? "One setting needs" : `${keyed.size} settings need`} attention; see the note next to ${keyed.size === 1 ? "it" : "each"}.</p>`);
  if (loose.length) parts.push(`<ul>${loose.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`);
  return parts.join("");
}

/**
 * The fields of a generator grouped for display, as [{ key, label, keys: [fieldKey...] }].
 * mode "category" (default): by `group`, in schema order (the original fieldsets).
 * mode "section": by `section` in the definition's `sections` order, "General" for fields
 * with none (see sections.js).
 */
export function groupFields(generator, mode = "category") {
  const entries = Object.entries(generator.schema).filter(([, def]) => RENDERERS[def.type]);
  if (mode === "section") {
    const buckets = new Map(sectionList(generator).map(s => [s.key, { key: s.key, label: s.label, keys: [] }]));
    for (const [key, def] of entries) {
      const section = fieldSection(def);
      if (!buckets.has(section)) buckets.set(section, { key: section, label: sectionLabel(generator, section), keys: [] });
      buckets.get(section).keys.push(key);
    }
    return [...buckets.values()].filter(g => g.keys.length);
  }
  const groups = new Map();
  for (const [key, def] of entries) {
    const group = def.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(key);
  }
  return [...groups].map(([group, keys]) => ({ key: group || "options", label: groupLabel(group), keys }));
}

export function renderFormHtml(generator, params = {}, { errors = [], fieldErrors = {}, mode = "category" } = {}) {
  const current = Object.fromEntries(Object.entries(generator.schema).map(([k, d]) => [k, Object.hasOwn(params, k) ? params[k] : d.default]));
  const renderField = key => {
    const def = generator.schema[key];
    const value = Object.hasOwn(params, key) ? params[key] : def.default;
    let field = RENDERERS[def.type](key, def, value, Object.hasOwn(fieldErrors, key) ? fieldErrors[key] : "");
    if (!isFieldVisible(def, current)) field = field.replace(`data-field="${esc(key)}">`, `data-field="${esc(key)}" hidden>`);
    return field;
  };
  const fieldsets = groupFields(generator, mode).map(g => `<fieldset class="cz-group cz-group-${esc(slug(g.key))}">
<legend class="cz-legend">${esc(g.label)}</legend>
${g.keys.map(renderField).join("\n")}
</fieldset>`);
  // The summary region is always in the DOM (a persistent polite live region); only its text changes.
  return `<div class="cz-form-errors" id="cz-form-errors" aria-live="polite">${summaryHtml(errors, fieldErrors)}</div>
${fieldsets.join("\n")}`;
}

/** Converts a control's current state to the schema value type. Empty numbers become NaN (validation reports them). */
export function readControlValue(def, element) {
  if (isNumeric(def)) return element.value === "" ? Number.NaN : Number(element.value);
  if (def.type === "bool") return Boolean(element.checked);
  return String(element.value ?? "");
}

/** Parameters safe to persist in a local draft: known keys only, sensitive fields removed. */
export function storableParams(generator, params) {
  const sensitive = new Set(sensitiveKeys(generator));
  const out = {};
  for (const [key, def] of Object.entries(generator.schema)) if (!sensitive.has(key) && !def.transient && Object.hasOwn(params, key)) out[key] = params[key];
  // A font from this computer is picked again and its license confirmed again in the next
  // visit (neither is kept), so a draft returns to the generator's own default font.
  const fontKey = generator.font?.key;
  if (fontKey && fontNeedsLicense(out[fontKey])) out[fontKey] = generator.schema[fontKey].default;
  return out;
}

/** Parses a stored draft; unknown/sensitive keys are dropped and an invalid draft falls back to defaults. */
export function restoreParams(generator, raw) {
  const defaults = validateParams(generator, {}).value;
  if (!raw) return defaults;
  let saved;
  try { saved = JSON.parse(raw); } catch { return defaults; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
  const merged = { ...defaults, ...storableParams(generator, saved) };
  // Sensitive fields are never in a draft, so judge the draft as the server would (secrets
  // withheld). The secret itself restores to its default (empty) and the form asks for it.
  if (!validateParams(generator, merged, { skipSensitive: true }).ok) return defaults;
  return validateParams(generator, merged).value;
}

/** True when the browser masks text boxes via CSS (Chromium, Safari, Firefox 114+). */
export function cssTextMasking() {
  try { return Boolean(globalThis.CSS?.supports?.("-webkit-text-security", "disc")); } catch { return false; }
}

/**
 * Renders the form into `container` and reports edits as onChange(key, value, { final }).
 * `final` is true for committed edits (change events, sliders, selects, checkboxes, colors);
 * typing into a number or text box is reported debounced with final=false so the page can
 * validate without snapping a half-typed number.
 */
export function renderForm(container, generator, params, { onChange = () => {}, limits, cssMasking = cssTextMasking(), mode: initialMode = "category", collapsed = {}, onCollapse = () => {}, onLink = () => {} } = {}) {
  container.innerHTML = renderFormHtml(generator, params);
  const secret = secretInputAttributes(cssMasking);
  for (const input of container.querySelectorAll("input.cz-secret")) {
    input.type = secret.type;
    input.setAttribute("autocomplete", secret.autocomplete);
  }
  const timers = new Map();
  // Controls are found by form name, or by data-key for a secret (which has no name).
  const byKey = key => `[name="${CSS.escape(key)}"], [data-key="${CSS.escape(key)}"]`;
  const keyOf = element => element?.name || element?.dataset?.key || "";
  const named = key => container.querySelector(byKey(key));
  // A radio group (the font picker) shares one name: its value is the checked radio's.
  const allNamed = key => [...container.querySelectorAll(byKey(key))];
  const current = key => container.querySelector(`[name="${CSS.escape(key)}"]:checked`) ?? named(key);
  const toggleOf = key => container.querySelector(`#${CSS.escape(controlId(key))}-toggle`);
  const range = key => container.querySelector(`[data-for="${CSS.escape(key)}"]`);
  const errorBox = container.querySelector("#cz-form-errors");

  // ---- Grouping: the same field nodes are re-parented between "Section" and "Category" groups,
  // never re-rendered, so values, listeners, a secret's live value and attached areas survive.
  const fieldEls = new Map();
  for (const wrapper of container.querySelectorAll(".cz-field[data-field]")) {
    const def = generator.schema[wrapper.dataset.field];
    if (!def) continue;
    wrapper.dataset.group = def.group ?? "";
    wrapper.dataset.section = fieldSection(def);
    fieldEls.set(wrapper.dataset.field, wrapper);
  }
  for (const fieldset of container.querySelectorAll("fieldset.cz-group")) fieldset.remove();
  const host = document.createElement("div");
  host.className = "cz-groups";
  container.append(host);
  const attachments = new Map(); // field key -> [elements placed right under that field]
  const groupEls = new Map(); // group key -> { el, toggle, body, key, mode }
  let mode = hasSections(generator) && initialMode === "section" ? "section" : "category";
  let linked = null;

  const collapseKey = (m, key) => `${m}:${key}`;
  function setGroupOpen(entry, open, { animate = true, remember = true } = {}) {
    entry.toggle.setAttribute("aria-expanded", String(open));
    entry.el.classList.toggle("is-collapsed", !open);
    if (animate) setOpen(entry.body, open);
    else entry.body.hidden = !open;
    if (remember) onCollapse(collapseKey(entry.mode, entry.key), !open);
  }
  function buildGroup(g) {
    const bodyId = `cz-grp-${mode}-${slug(g.key)}-body`;
    const el = document.createElement("section");
    el.className = `cz-group cz-group-${slug(g.key)}`;
    el.dataset.groupKey = g.key;
    if (mode === "section") el.dataset.section = g.key;
    const head = document.createElement("h2");
    head.className = "cz-legend";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cz-group-toggle";
    toggle.setAttribute("aria-controls", bodyId);
    const label = document.createElement("span");
    label.textContent = g.label;
    const chevron = document.createElement("span");
    chevron.className = "cz-chev";
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(label, chevron);
    head.append(toggle);
    const body = document.createElement("div");
    body.className = "cz-group-body";
    body.id = bodyId;
    el.append(head, body);
    const entry = { el, toggle, body, key: g.key, mode };
    toggle.addEventListener("click", () => setGroupOpen(entry, toggle.getAttribute("aria-expanded") !== "true"));
    for (const key of g.keys) {
      const wrapper = fieldEls.get(key);
      if (!wrapper) continue;
      body.append(wrapper, ...(attachments.get(key) ?? []));
    }
    setGroupOpen(entry, collapsed[collapseKey(mode, g.key)] !== true, { animate: false, remember: false });
    return entry;
  }
  function refreshGroupVisibility() {
    for (const { el, body } of groupEls.values()) el.hidden = ![...body.querySelectorAll(".cz-field[data-field]")].some(f => !f.hidden);
  }
  function layout(nextMode) {
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    mode = nextMode;
    host.replaceChildren();
    host.dataset.mode = mode;
    groupEls.clear();
    for (const g of groupFields(generator, mode)) {
      const entry = buildGroup(g);
      groupEls.set(g.key, entry);
      host.append(entry.el);
    }
    refreshGroupVisibility();
    applyLinked();
    if (active?.isConnected) active.focus({ preventScroll: true });
  }
  let modeToken = 0;
  async function setMode(next, { animate = true } = {}) {
    const target = next === "section" && hasSections(generator) ? "section" : "category";
    if (target === mode) return;
    const token = ++modeToken;
    if (!animate || reducedMotion() || typeof host.animate !== "function") { layout(target); return; }
    const out = host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: EASE, fill: "forwards" });
    await out.finished.catch(() => {});
    if (token !== modeToken) { out.cancel(); return; }
    layout(target);
    out.cancel();
    await play(host, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: DUR.base });
  }

  // Which section a pointer / focus target belongs to (null for General and non-section areas).
  const sectionAt = target => {
    const el = target?.closest?.(mode === "section" ? ".cz-group[data-section]" : ".cz-field[data-section]");
    const key = el?.dataset.section;
    return key && key !== GENERAL ? key : null;
  };
  function applyLinked() {
    for (const el of container.querySelectorAll(".is-linked")) el.classList.remove("is-linked");
    if (!linked) return;
    const css = CSS.escape(linked);
    const targets = mode === "section" ? container.querySelectorAll(`.cz-group[data-section="${css}"]`) : container.querySelectorAll(`.cz-field[data-section="${css}"]:not([hidden])`);
    for (const el of targets) el.classList.add("is-linked");
  }
  /** Softly marks the settings of one section (the preview is hovering its part). */
  function setLinked(key) {
    if (linked === (key ?? null)) return;
    linked = key ?? null;
    applyLinked();
  }
  let hoverKey = null;
  container.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    const key = sectionAt(event.target);
    if (key !== hoverKey) { hoverKey = key; onLink(key, "hover"); }
  });
  container.addEventListener("pointerleave", () => { if (hoverKey) { hoverKey = null; onLink(null, "hover"); } });
  container.addEventListener("focusin", event => onLink(sectionAt(event.target), "focus"));
  container.addEventListener("focusout", event => { if (!container.contains(event.relatedTarget)) onLink(null, "focus"); });

  /**
   * Brings a section's settings into view: expands the group(s), scrolls to them, pulses them
   * and moves keyboard focus to the first control. Returns { count, control } or null.
   */
  function revealSection(key, { focus = true } = {}) {
    let targets;
    if (mode === "section") {
      const entry = groupEls.get(key);
      if (!entry || entry.el.hidden) return null;
      if (entry.body.hidden) setGroupOpen(entry, true);
      targets = [entry.el];
    } else {
      targets = [...fieldEls.values()].filter(w => w.dataset.section === key && !w.hidden);
      if (!targets.length) return null;
      for (const w of targets) {
        const entry = groupEls.get(w.dataset.group || "options");
        if (entry?.body.hidden) setGroupOpen(entry, true);
      }
    }
    const control = targets.map(t => t.querySelector(".cz-field:not([hidden]) :is(input:not(.cz-picker-radio):not(.cz-range), select, textarea, button.cz-picker-toggle)") ?? (t.matches(".cz-field") ? t.querySelector(":is(input:not(.cz-picker-radio):not(.cz-range), select, textarea, button.cz-picker-toggle)") : null)).find(Boolean) ?? null;
    const scroller = container.closest(".cz-win-body") ?? container;
    // Leave room for the sticky tool row at the top of the window.
    const sticky = scroller.querySelector(".cz-win-tools")?.offsetHeight ?? 0;
    const delta = targets[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top - sticky - 8;
    if (Math.abs(delta) > 2) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: reducedMotion() ? "auto" : "smooth" });
    for (const t of targets) {
      t.classList.remove("cz-pulse");
      void t.offsetWidth;
      t.classList.add("cz-pulse");
      setTimeout(() => t.classList.remove("cz-pulse"), 1300);
    }
    if (focus && control) {
      control.focus({ preventScroll: true });
      control.dataset.czRing = "1";
      control.addEventListener("blur", () => { delete control.dataset.czRing; }, { once: true });
    }
    return { count: targets.reduce((n, t) => n + (t.matches(".cz-field") ? 1 : t.querySelectorAll(".cz-field:not([hidden])").length), 0), control };
  }
  /** Places `element` right under the field `key` (the image picker, the own-font panel). */
  function attach(key, element) {
    const list = attachments.get(key) ?? [];
    list.push(element);
    attachments.set(key, list);
    fieldEls.get(key)?.after(element);
  }
  // Fields go back into the document right away: the listeners below look them up in `container`.
  layout(mode);

  // data-settling marks the form while an edit waits on its debounce/settle timer (tests and
  // anything else that must know every edit has been reported).
  const syncSettling = () => container.toggleAttribute?.("data-settling", timers.size > 0);
  const emit = (key, final) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    const def = generator.schema[key];
    const element = def?.picker ? current(key) : named(key);
    try {
      if (def && element) onChange(key, readControlValue(def, element), { final });
    } finally {
      syncSettling();
    }
  };
  const schedule = (key, final, delay = DEBOUNCE_MS) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => emit(key, final), delay));
    syncSettling();
  };

  function onInput(event) {
    const target = event.target;
    const forKey = target.dataset?.for;
    if (forKey) {
      const box = named(forKey);
      if (box) box.value = target.value;
      schedule(forKey, true);
      return;
    }
    const key = keyOf(target);
    if (!key || !generator.schema[key]) return;
    const def = generator.schema[key];
    if (def.picker) { schedule(key, true, PICKER_SETTLE_MS); return; }
    if (isNumeric(def)) { const slider = range(key); if (slider && target.value !== "") slider.value = target.value; }
    const typing = def.type === "text" || isNumeric(def);
    schedule(key, !typing);
  }
  function onCommit(event) {
    const key = keyOf(event.target);
    if (!key || !generator.schema[key]) return;
    if (generator.schema[key].picker) {
      // A pointer pick commits at once (and closes the list); arrow keys wait to settle.
      const field = event.target.closest?.("[data-picker]");
      if (field?.dataset.pointerPick) {
        delete field.dataset.pointerPick;
        emit(key, true);
        openPicker(field, false, { focus: true });
      } else schedule(key, true, PICKER_SETTLE_MS);
    } else emit(key, true);
  }
  // The settings are never submitted anywhere: Enter in a field must not submit or navigate.
  const onSubmit = event => event.preventDefault();
  container.addEventListener("input", onInput);
  container.addEventListener("change", onCommit);
  container.addEventListener("submit", onSubmit);

  function setLimits(next = {}) {
    for (const [key, [lo, hi]] of Object.entries(next)) {
      for (const element of [named(key), range(key)]) {
        if (!element) continue;
        element.min = String(lo);
        element.max = String(hi);
      }
    }
  }

  function setValues(values) {
    for (const [key, def] of Object.entries(generator.schema)) {
      if (!Object.hasOwn(values, key)) continue;
      const element = named(key);
      if (!element) continue;
      const value = values[key];
      if (def.picker) { setPicker(key, def, value); continue; }
      if (def.type === "bool") element.checked = Boolean(value);
      else if (isNumeric(def)) {
        if (Number.isFinite(value) && Number(element.value) !== value) element.value = String(value);
        const slider = range(key);
        if (slider && Number.isFinite(value)) slider.value = String(value);
      } else if (element.value !== String(value ?? "")) element.value = String(value ?? "");
    }
    for (const [key, def] of Object.entries(generator.schema)) {
      if (!def.visibleWhen) continue;
      const wrapper = container.querySelector(`[data-field="${CSS.escape(key)}"]`);
      if (wrapper) wrapper.hidden = !isFieldVisible(def, values);
    }
    refreshGroupVisibility();
    applyLinked();
    if (generator.rules) setLimits(generator.rules(values).limits ?? {});
  }

  /** Shows each keyed message under its control (aria-invalid + aria-describedby) and the rest in the summary. */
  function setErrors(errors = [], fieldErrors = {}) {
    for (const key of Object.keys(generator.schema)) {
      const message = Object.hasOwn(fieldErrors, key) ? String(fieldErrors[key]) : "";
      const slot = container.querySelector(`#${CSS.escape(errorId(key))}`);
      if (slot && slot.textContent !== message) {
        const previous = slot.textContent;
        slot.textContent = message;
        // The wrapper opens/closes with a CSS transition; a cleared message stays drawn (as a
        // ghost) until the close has run, so it fades out instead of vanishing.
        const wrap = slot.parentElement;
        if (message) { delete slot.dataset.ghost; wrap?.classList.add("is-open"); }
        else if (previous) {
          slot.dataset.ghost = previous;
          wrap?.classList.remove("is-open");
          setTimeout(() => { if (!slot.textContent) delete slot.dataset.ghost; }, DUR.base + 60);
        }
      }
      for (const control of [...allNamed(key), range(key), toggleOf(key)]) {
        if (!control) continue;
        const base = (control.dataset.describedby ?? "").split(" ").filter(Boolean);
        const ids = message ? [...base, errorId(key)] : base;
        if (ids.length) control.setAttribute("aria-describedby", ids.join(" "));
        else control.removeAttribute("aria-describedby");
        if (message) control.setAttribute("aria-invalid", "true");
        else control.removeAttribute("aria-invalid");
      }
    }
    if (errorBox) {
      const html = summaryHtml(errors, fieldErrors);
      if (errorBox.innerHTML !== html) {
        const appearing = !errorBox.innerHTML && html;
        errorBox.innerHTML = html;
        if (appearing) play(errorBox, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: DUR.base });
      }
    }
  }

  // ---- Picker fields (font): open/close, keyboard and pointer behavior ----
  function setPicker(key, def, value) {
    for (const radio of allNamed(key)) radio.checked = radio.value === String(value);
    const option = (def.options ?? []).find(o => o.value === value);
    const label = toggleOf(key)?.querySelector(".cz-picker-current");
    if (option && label) {
      label.textContent = option.label ?? option.value;
      label.className = `cz-picker-current ${faceClass(option)}`;
    }
  }
  // A long list (35 fonts) must not download every face when it opens: only the first few
  // options are drawn in their own face at once; the rest get theirs as they scroll into view
  // (all at once without IntersectionObserver). Faces are same-origin and font-display: swap.
  const EAGER_FACES = 10;
  const faceOf = label => [...label.classList].find(c => c.startsWith("cz-ff-"));
  const drawFace = label => {
    if (label?.dataset.face) { label.classList.add(label.dataset.face); delete label.dataset.face; }
  };
  for (const list of container.querySelectorAll(".cz-picker-list")) {
    list.querySelectorAll(".cz-picker-option").forEach((label, index) => {
      const face = faceOf(label);
      if (index < EAGER_FACES || !face) return;
      label.dataset.face = face;
      label.classList.remove(face);
    });
  }
  const faceObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { drawFace(entry.target); faceObserver.unobserve(entry.target); }
    }, { rootMargin: "120px" })
    : null;
  function loadFaces(list) {
    // Options already on screen get their face at once (no frame of waiting); the rest on scroll.
    const view = (list.querySelector(".cz-picker-scroll") ?? list).getBoundingClientRect();
    for (const label of list.querySelectorAll(".cz-picker-option[data-face]")) {
      const box = label.getBoundingClientRect();
      const showing = view.height > 0 && box.bottom >= view.top && box.top <= view.bottom;
      if (showing || !faceObserver || label.control?.checked) drawFace(label);
      else faceObserver.observe(label);
    }
  }
  function openPicker(field, open, { focus = false } = {}) {
    const toggle = field.querySelector(".cz-picker-toggle");
    const list = field.querySelector(".cz-picker-list");
    if (!toggle || !list) return;
    toggle.setAttribute("aria-expanded", String(open));
    list.hidden = !open;
    if (open) loadFaces(list);
    if (open && focus) {
      const target = list.querySelector("input:checked") ?? list.querySelector("input");
      target?.focus();
      // Keep the current choice in view in a long list.
      target?.closest(".cz-picker-item")?.scrollIntoView?.({ block: "nearest" });
    }
    if (!open && focus) toggle.focus();
  }
  for (const field of container.querySelectorAll("[data-picker]")) {
    const toggle = field.querySelector(".cz-picker-toggle");
    const key = field.dataset.field;
    let typed = "";
    let typedTimer = 0;
    toggle?.addEventListener("click", () => openPicker(field, toggle.getAttribute("aria-expanded") !== "true", { focus: true }));
    field.addEventListener("keydown", event => {
      delete field.dataset.pointerPick;
      if (event.key === "Escape" && toggle?.getAttribute("aria-expanded") === "true") { event.preventDefault(); openPicker(field, false, { focus: true }); }
      // Enter on a choice confirms it, like a select.
      if (event.key === "Enter" && event.target.matches?.(".cz-picker-radio")) { event.preventDefault(); emit(key, true); openPicker(field, false, { focus: true }); }
      // Type-ahead: typing a font's name jumps to it (a repeated letter cycles through the
      // names that start with it). The choice settles like an arrow key would.
      if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && event.target.matches?.(".cz-picker-radio")) {
        typed += event.key.toLowerCase();
        clearTimeout(typedTimer);
        typedTimer = setTimeout(() => { typed = ""; }, 700);
        const radios = [...field.querySelectorAll(".cz-picker-radio")];
        const from = radios.indexOf(event.target) + (typed.length > 1 ? 0 : 1);
        const name = radio => (field.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent ?? "").trim().toLowerCase();
        const hit = [...radios.slice(from), ...radios.slice(0, from)].find(radio => name(radio).startsWith(typed));
        if (hit) {
          event.preventDefault();
          drawFace(field.querySelector(`label[for="${CSS.escape(hit.id)}"]`));
          hit.checked = true;
          hit.focus();
          hit.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    // Pressing a choice must not blur the group first (that would close it before the click),
    // and marks the coming change as a pointer pick (committed at once in onCommit).
    field.addEventListener("mousedown", event => {
      if (!event.target.closest?.(".cz-picker-option")) return;
      event.preventDefault();
      field.dataset.pointerPick = "1";
    });
    // Clicking the choice that is already checked changes nothing: just close the list.
    field.addEventListener("click", event => {
      const option = event.detail > 0 ? event.target.closest?.(".cz-picker-option") : null;
      if (option && container.querySelector(`#${CSS.escape(option.htmlFor)}`)?.checked) {
        delete field.dataset.pointerPick;
        openPicker(field, false, { focus: true });
      }
    });
    // Leaving the picker commits a choice still settling, before another control can commit.
    field.addEventListener("focusout", event => {
      if (field.contains(event.relatedTarget)) return;
      if (timers.has(key)) emit(key, true);
      openPicker(field, false);
    });
  }

  setLimits(limits ?? generator.rules?.(params).limits ?? {});

  return {
    setValues,
    setLimits,
    setErrors,
    setMode,
    getMode: () => mode,
    setLinked,
    revealSection,
    attach,
    destroy() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      syncSettling();
      container.removeEventListener("input", onInput);
      container.removeEventListener("change", onCommit);
      container.removeEventListener("submit", onSubmit);
      container.innerHTML = "";
    }
  };
}
