// Schema-driven parameter form. renderFormHtml is pure (testable in Node);
// renderForm wires it to the DOM. No Vite-only imports here.
import { sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

export const SENSITIVE_NOTE = "This is stored only inside the model file you send us — never on our servers or in your saved draft.";
const GROUP_LABELS = { text: "Text", size: "Size and depth", layout: "Text layout", back: "Back", colors: "Colors" };
const DEBOUNCE_MS = 150;

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
const errorSlot = (key, error) => `<p class="cz-field-error" id="${errorId(key)}">${esc(error ?? "")}</p>`;

function numberField(key, def, value, error) {
  const id = controlId(key);
  const step = def.step ?? (def.type === "int" ? 1 : "any");
  const unit = def.unit ? ` <span class="cz-unit">(${esc(def.unit)})</span>` : "";
  const bounds = `${attr("min", def.min)}${attr("max", def.max)}${attr("step", step)}${attr("value", value)}`;
  return `<div class="cz-field cz-field-number" data-field="${esc(key)}">
  <label class="cz-label" id="${id}-label" for="${id}">${esc(def.label ?? key)}${unit}</label>
  <div class="cz-number-row">
    <input class="cz-range" type="range" id="${id}-range" data-for="${esc(key)}" aria-label="${esc(def.label ?? key)} slider"${bounds}${describe([], key, error)}>
    <input class="input cz-number" type="number" id="${id}" name="${esc(key)}"${bounds} inputmode="decimal"${describe([], key, error)}>
  </div>
  ${errorSlot(key, error)}
</div>`;
}

// Sensitive text always renders as a single-line password box, even when the schema marks
// it multiline: a <textarea> cannot be masked, and secrets (Wi-Fi passwords) are one line.
function textField(key, def, value, error) {
  const id = controlId(key);
  const base = [`${id}-help`];
  const note = def.sensitive ? `<p class="cz-sensitive-note" id="${id}-note">${esc(SENSITIVE_NOTE)}</p>` : "";
  if (def.sensitive) base.push(`${id}-note`);
  const multiline = def.multiline && !def.sensitive;
  const common = `id="${id}" name="${esc(key)}"${attr("maxlength", def.max)}${describe(base, key, error)}`;
  const help = `<p class="help" id="${id}-help">${def.optional ? "Optional. " : ""}Up to ${esc(def.max)} characters${multiline ? ", one line per row" : ""}.</p>`;
  const control = multiline
    ? `<textarea class="textarea cz-textarea" ${common} rows="4" spellcheck="false">${esc(value)}</textarea>`
    : `<input class="input" type="${def.sensitive ? "password" : "text"}" ${common} autocomplete="off" spellcheck="false"${attr("value", value)}>`;
  return `<div class="cz-field cz-field-text" data-field="${esc(key)}">
  <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  ${control}
  ${errorSlot(key, error)}
  ${help}${note}
</div>`;
}

function enumField(key, def, value, error) {
  const id = controlId(key);
  const options = (def.options ?? []).map(o => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label ?? o.value)}</option>`).join("");
  return `<div class="cz-field cz-field-enum" data-field="${esc(key)}">
  <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  <select class="select" id="${id}" name="${esc(key)}"${describe([], key, error)}>${options}</select>
  ${errorSlot(key, error)}
</div>`;
}

function boolField(key, def, value, error) {
  const id = controlId(key);
  return `<div class="cz-field cz-field-bool" data-field="${esc(key)}">
  <div class="cz-inline">
    <input class="cz-checkbox" type="checkbox" id="${id}" name="${esc(key)}"${value ? " checked" : ""}${describe([], key, error)}>
    <label class="cz-label" for="${id}">${esc(def.label ?? key)}</label>
  </div>
  ${errorSlot(key, error)}
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

/** Summary text for the form-level live region: unkeyed messages in full, keyed ones as a pointer. */
export function summaryHtml(errors = [], fieldErrors = {}) {
  const keyed = new Set(Object.values(fieldErrors));
  const loose = errors.filter(e => !keyed.has(e));
  const parts = [];
  if (keyed.size) parts.push(`<p class="cz-errors-title">${keyed.size === 1 ? "One setting needs" : `${keyed.size} settings need`} attention; see the note next to ${keyed.size === 1 ? "it" : "each"}.</p>`);
  if (loose.length) parts.push(`<ul>${loose.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`);
  return parts.join("");
}

export function renderFormHtml(generator, params = {}, { errors = [], fieldErrors = {} } = {}) {
  const groups = new Map();
  for (const [key, def] of Object.entries(generator.schema)) {
    const render = RENDERERS[def.type];
    if (!render) continue;
    const value = Object.hasOwn(params, key) ? params[key] : def.default;
    const group = def.group ?? "";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(render(key, def, value, Object.hasOwn(fieldErrors, key) ? fieldErrors[key] : ""));
  }
  const fieldsets = [...groups].map(([group, fields]) => `<fieldset class="cz-group cz-group-${esc(slug(group || "options"))}">
<legend class="cz-legend">${esc(groupLabel(group))}</legend>
${fields.join("\n")}
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
  for (const key of Object.keys(generator.schema)) if (!sensitive.has(key) && Object.hasOwn(params, key)) out[key] = params[key];
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
  const result = validateParams(generator, merged);
  return result.ok ? result.value : defaults;
}

/**
 * Renders the form into `container` and reports edits as onChange(key, value, { final }).
 * `final` is true for committed edits (change events, sliders, selects, checkboxes, colors);
 * typing into a number or text box is reported debounced with final=false so the page can
 * validate without snapping a half-typed number.
 */
export function renderForm(container, generator, params, { onChange = () => {}, limits } = {}) {
  container.innerHTML = renderFormHtml(generator, params);
  const timers = new Map();
  const named = key => container.querySelector(`[name="${CSS.escape(key)}"]`);
  const range = key => container.querySelector(`[data-for="${CSS.escape(key)}"]`);
  const errorBox = container.querySelector("#cz-form-errors");

  const emit = (key, final) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
    const def = generator.schema[key];
    const element = named(key);
    if (def && element) onChange(key, readControlValue(def, element), { final });
  };
  const schedule = (key, final) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => emit(key, final), DEBOUNCE_MS));
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
    const key = target.name;
    if (!key || !generator.schema[key]) return;
    const def = generator.schema[key];
    if (isNumeric(def)) { const slider = range(key); if (slider && target.value !== "") slider.value = target.value; }
    const typing = def.type === "text" || isNumeric(def);
    schedule(key, !typing);
  }
  function onCommit(event) {
    const key = event.target.name;
    if (key && generator.schema[key]) emit(key, true);
  }
  container.addEventListener("input", onInput);
  container.addEventListener("change", onCommit);

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
      if (def.type === "bool") element.checked = Boolean(value);
      else if (isNumeric(def)) {
        if (Number.isFinite(value) && Number(element.value) !== value) element.value = String(value);
        const slider = range(key);
        if (slider && Number.isFinite(value)) slider.value = String(value);
      } else if (element.value !== String(value ?? "")) element.value = String(value ?? "");
    }
    if (generator.rules) setLimits(generator.rules(values).limits ?? {});
  }

  /** Shows each keyed message under its control (aria-invalid + aria-describedby) and the rest in the summary. */
  function setErrors(errors = [], fieldErrors = {}) {
    for (const key of Object.keys(generator.schema)) {
      const message = Object.hasOwn(fieldErrors, key) ? String(fieldErrors[key]) : "";
      const slot = container.querySelector(`#${CSS.escape(errorId(key))}`);
      if (slot && slot.textContent !== message) slot.textContent = message;
      for (const control of [named(key), range(key)]) {
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
      if (errorBox.innerHTML !== html) errorBox.innerHTML = html;
    }
  }

  setLimits(limits ?? generator.rules?.(params).limits ?? {});

  return {
    setValues,
    setLimits,
    setErrors,
    destroy() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      container.removeEventListener("input", onInput);
      container.removeEventListener("change", onCommit);
      container.innerHTML = "";
    }
  };
}
