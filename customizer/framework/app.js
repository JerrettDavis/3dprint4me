// Generator page entry. Page state: { generator, params, result, status } with
// status idle | building | ready | error. A settings problem is an error without a retry.
// Geometry builds in a worker (latest wins); facts are computed locally from the built 3MF;
// nothing here touches the network.
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { browserInflateRaw } from "../../public/assets/js/print-estimation/controller.js";
import { renderForm, restoreParams, storableParams, esc } from "./form.js";
import { createWorkerClient } from "./worker-client.js";
import { colorCountLabel, describeFacts, FACTS_NOTE } from "./facts.js";
import { continuePayload, continueState } from "./continue.js";

const STATUS_TEXT = {
  idle: "Preparing the model builder…",
  building: "Building your model…",
  ready: "Model ready. It matches the settings shown.",
  invalid: "Some settings need attention before the model can be built."
};
const EMPTY_FACTS = ["Size", "Volume", "Rough weight", "Rough print time"].map(label => `<div><dt>${label}</dt><dd>—</dd></div>`).join("");

// Request hand-off hook: onContinue({ file, filename, generatorId, generatorVersion, params, warnings }).
// The order integration replaces the default with the IndexedDB hand-off writer.
// Until a handler is registered, a production build keeps the button disabled with an honest note.
let continueHandler = defaultContinueHandler;
let handlerSet = false;
let refreshContinue = () => {};
export function setContinueHandler(fn) {
  handlerSet = typeof fn === "function";
  continueHandler = handlerSet ? fn : defaultContinueHandler;
  refreshContinue();
}
function defaultContinueHandler() {
  if (import.meta.env?.DEV) setNote("Development build: the request hand-off is not wired yet.");
}

const $ = selector => document.querySelector(selector);
let noteEl = null;
function setNote(text) { if (noteEl) { noteEl.textContent = text; noteEl.hidden = !text; } }

const storageKey = g => `3dp-customize:${g.id}:v${g.version ?? 1}`;
function loadDraft(g) {
  try { return sessionStorage.getItem(storageKey(g)); } catch { return null; }
}
function saveDraft(g, params) {
  try { sessionStorage.setItem(storageKey(g), JSON.stringify(storableParams(g, params))); } catch { /* Drafts are a convenience only. */ }
}
function clearDraft(g) {
  try { sessionStorage.removeItem(storageKey(g)); } catch { /* Nothing stored. */ }
}

function boot() {
  const id = document.querySelector('meta[name="generator-id"]')?.content;
  const generator = id ? getGenerator(id) : undefined;
  const statusEl = $("#cz-status");
  if (!generator) {
    if (statusEl) statusEl.textContent = "This model isn't available. Choose another from the Customize page.";
    return;
  }

  const els = {
    status: statusEl,
    form: $("#cz-form"),
    facts: $("#cz-facts-list"),
    badge: $("#cz-color-badge"),
    warnings: $("#cz-warnings"),
    continueButton: $("#cz-continue"),
    retry: $("#cz-retry"),
    fallback: $("#cz-fallback"),
    stage: $("#cz-stage"),
    stageMessage: $("#cz-stage-message"),
    tabs: [...document.querySelectorAll("[data-view]")],
    bedToggle: $("#cz-bed-toggle"),
    fontArea: $("#cz-font-area"),
    fontInput: $("#cz-font-file"),
    fontStatus: $("#cz-font-status"),
    reset: $("#cz-reset"),
    factsNote: $("#cz-facts-note")
  };
  noteEl = $("#cz-continue-note");
  if (els.factsNote) els.factsNote.textContent = FACTS_NOTE;

  const state = { generator, params: restoreParams(generator, loadDraft(generator)), result: null, status: "idle" };
  const font = { bytes: null, key: null };
  const client = createWorkerClient();
  let viewer = null;
  let viewerLoading = null;
  let view = "front";
  let form = null;

  function setStatus(status, message, { retryable = true } = {}) {
    state.status = status;
    if (els.status) {
      els.status.textContent = message ?? STATUS_TEXT[status] ?? "";
      els.status.dataset.state = status;
    }
    updateContinue();
    if (els.retry) els.retry.hidden = !(status === "error" && retryable);
    if (els.fallback) els.fallback.hidden = !(status === "error" && retryable);
    document.body.dataset.buildState = status;
  }

  function updateContinue() {
    const next = continueState({ status: state.status, hasResult: !!state.result, handlerSet, production: !!import.meta.env?.PROD });
    if (els.continueButton) els.continueButton.disabled = next.disabled;
    if (next.note) setNote(next.note);
  }
  refreshContinue = () => { setNote(""); updateContinue(); };

  function renderWarnings(list) {
    if (!els.warnings) return;
    els.warnings.hidden = !list.length;
    els.warnings.innerHTML = list.map(w => `<li>${esc(w)}</li>`).join("");
  }

  function clearFacts() {
    if (els.facts) els.facts.innerHTML = EMPTY_FACTS;
    if (els.badge) { els.badge.textContent = ""; els.badge.hidden = true; }
  }

  async function renderFacts(result) {
    const colors = result.metrics?.unique_colors ?? 1;
    if (els.badge) { els.badge.textContent = colorCountLabel(colors); els.badge.hidden = false; }
    try {
      const metrics = await analyzeModelBytes({ name: result.filename, bytes: result.data, inflateRaw: browserInflateRaw });
      if (state.result !== result) return;
      const facts = describeFacts(metrics, { colors });
      els.facts.innerHTML = facts.rows.map(r => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join("");
      if (!facts.fitsBed) renderWarnings([...(result.warnings ?? []), "This model is larger than a typical build plate; we'll check how to split or scale it."]);
    } catch {
      if (state.result === result) els.facts.innerHTML = `<div class="cz-facts-wide"><dt>Facts</dt><dd>Couldn't measure this model in the browser. We'll measure it when you send the request.</dd></div>`;
    }
  }

  function ensureViewer() {
    if (viewer || !els.stage) return Promise.resolve(viewer);
    viewerLoading ??= import("./viewer3d.js")
      .then(({ createViewer }) => {
        viewer = createViewer(els.stage, { label: `${generator.title} preview` });
        viewer.setView(view);
        if (els.stageMessage) els.stageMessage.hidden = true;
        return viewer;
      })
      .catch(() => {
        if (els.stageMessage) {
          els.stageMessage.textContent = "This browser can't show the preview (WebGL is off or unavailable). The model still builds, and the facts come from it.";
          els.stageMessage.hidden = false;
        }
        return null;
      });
    return viewerLoading;
  }

  async function showResult(result) {
    const v = await ensureViewer();
    if (v && state.result === result) v.setParts(result.parts);
  }

  let buildSeq = 0;
  async function build() {
    const seq = ++buildSeq;
    const checked = validateParams(generator, state.params);
    form.setErrors(checked.errors, checked.fieldErrors);
    if (!checked.ok) {
      state.result = null;
      renderWarnings([]);
      clearFacts();
      setStatus("error", STATUS_TEXT.invalid, { retryable: false });
      return;
    }
    if (generator.schema.font_mode && checked.value.font_mode === "font" && !font.bytes) {
      state.result = null;
      clearFacts();
      form.setErrors([], { font_mode: "Choose a font file below, or switch back to the built-in block font." });
      setStatus("error", STATUS_TEXT.invalid, { retryable: false });
      return;
    }
    setStatus("building");
    try {
      // postMessage clones the bytes only for the request that actually runs.
      const fontOptions = font.bytes ? { fontBytes: font.bytes, fontKey: font.key } : {};
      const result = await client.build(generator.id, checked.value, fontOptions);
      if (seq !== buildSeq) return;
      state.result = result;
      setNote("");
      renderWarnings(result.warnings ?? []);
      setStatus("ready");
      renderFacts(result);
      showResult(result);
    } catch (error) {
      if (error?.superseded || seq !== buildSeq) return;
      state.result = null;
      renderWarnings([]);
      clearFacts();
      const message = error?.message || "The model could not be built.";
      if (error?.retryable) {
        setStatus("error", message);
        return;
      }
      // Geometry errors go next to the control they concern when the generator can tell
      // which one; otherwise into the Settings summary.
      const key = generator.errorField?.(message);
      if (key && Object.hasOwn(generator.schema, key)) form.setErrors([], { [key]: message });
      else form.setErrors([message], {});
      setStatus("error", "The model couldn't be built with these settings. See the note in Settings.", { retryable: !key });
    }
  }

  function syncFontArea() {
    if (els.fontArea) els.fontArea.hidden = !(generator.schema.font_mode && state.params.font_mode === "font");
  }

  function onChange(key, value, { final }) {
    let next = { ...state.params, [key]: value };
    if (final) {
      next = clampParams(generator, next, key);
      form.setValues(next);
    }
    state.params = next;
    saveDraft(generator, state.params);
    syncFontArea();
    build();
  }

  form = renderForm(els.form, generator, state.params, { onChange });
  form.setValues(state.params);
  syncFontArea();

  els.fontInput?.addEventListener("change", async () => {
    const file = els.fontInput.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      els.fontStatus.textContent = "That font file is too large (over 15 MB).";
      return;
    }
    font.bytes = new Uint8Array(await file.arrayBuffer());
    font.key = `${file.name}:${file.size}:${file.lastModified}`;
    els.fontStatus.textContent = `Using ${file.name}. It stays on this device and only shapes the text.`;
    build();
  });

  els.reset?.addEventListener("click", () => {
    clearDraft(generator);
    state.params = validateParams(generator, {}).value;
    form.setValues(state.params);
    syncFontArea();
    build();
  });

  els.retry?.addEventListener("click", () => build());

  // Preview tabs: one shared panel, roving tabindex, arrow/Home/End keys.
  function selectView(next, focus = false) {
    view = next;
    for (const tab of els.tabs) {
      const active = tab.dataset.view === next;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) {
        els.stage?.setAttribute("aria-labelledby", tab.id);
        if (focus) tab.focus();
      }
    }
    if (els.bedToggle) els.bedToggle.hidden = next !== "3d";
    viewer?.setView(next);
  }
  els.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectView(tab.dataset.view));
    tab.addEventListener("keydown", event => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      let target = null;
      if (event.key in moves) target = els.tabs[(index + moves[event.key] + els.tabs.length) % els.tabs.length];
      else if (event.key === "Home") target = els.tabs[0];
      else if (event.key === "End") target = els.tabs[els.tabs.length - 1];
      if (!target) return;
      event.preventDefault();
      selectView(target.dataset.view, true);
    });
  });
  selectView(view);

  els.bedToggle?.addEventListener("click", () => {
    const on = els.bedToggle.getAttribute("aria-pressed") !== "true";
    els.bedToggle.setAttribute("aria-pressed", String(on));
    viewer?.setBedMode(on);
  });

  els.continueButton?.addEventListener("click", async () => {
    const result = state.result;
    if (!result || state.status !== "ready") return;
    try {
      await continueHandler(continuePayload(generator, state.params, result));
    } catch (error) {
      setNote(String(error?.message ?? "Couldn't continue. Try again."));
    }
  });

  clearFacts();
  setStatus("idle");
  build();
}

if (typeof document !== "undefined") boot();
