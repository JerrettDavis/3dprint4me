// Generator page entry. Page state: { generator, params, result, status } with
// status idle | building | ready | error. A settings problem is an error without a retry.
// Geometry builds in a worker (latest wins); facts are computed locally from the built 3MF;
// nothing here touches the network.
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { browserInflateRaw } from "../../public/assets/js/print-estimation/controller.js";
import { renderForm, restoreParams, storableParams, esc, isFieldVisible } from "./form.js";
import { createImageLoader, createTracer, drawTracePreview } from "./image-input.js";
import { createWorkerClient } from "./worker-client.js";
import { buildFailureStatus } from "./build-status.js";
import { colorCountLabel, describeFacts, FACTS_NOTE } from "./facts.js";
import { continuePayload, continueState, continueToOrder } from "./continue.js";
import { writeHandoff } from "./handoff.js";

const STATUS_TEXT = {
  idle: "Preparing the model builder…",
  building: "Building your model…",
  ready: "Model ready. It matches the settings shown.",
  invalid: "Some settings need attention before the model can be built."
};
const EMPTY_FACTS = ["Size", "Volume", "Rough weight", "Rough print time"].map(label => `<div><dt>${label}</dt><dd>—</dd></div>`).join("");

// Request hand-off hook: onContinue({ file, filename, generatorId, generatorVersion, generatorTitle, params, warnings }).
// The default writes the IndexedDB hand-off and opens the print request (or, when the browser
// blocks IndexedDB, downloads the 3MF and opens the order page with a note). setContinueHandler
// is kept as a seam for tests and future pages.
let continueHandler = orderHandoff;
export function setContinueHandler(fn) {
  continueHandler = typeof fn === "function" ? fn : orderHandoff;
}
function orderHandoff(payload) {
  return continueToOrder(payload, { writeHandoff, download: downloadFile, navigate: url => location.assign(url) });
}
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later: the download must start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Applies one form edit to the current params. A committed edit (`final`) is clamped and may
 * derive other values (onParamChange). Returns { params, committed, changed }: `changed` is false
 * when the edit leaves every value as it was, and then the page must not rebuild (typing, then
 * leaving the field, e.g. by clicking Continue, would otherwise drop the click while the
 * identical model rebuilds).
 */
export function applyEdit(generator, current, key, value, { final = false } = {}) {
  let params = { ...current, [key]: value };
  if (final) params = clampParams(generator, params, key);
  return { params, committed: final, changed: JSON.stringify(params) !== JSON.stringify(current) };
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
    imageArea: $("#cz-image-area"),
    imageInput: $("#cz-image-file"),
    imageStatus: $("#cz-image-status"),
    imagePreview: $("#cz-image-preview"),
    reset: $("#cz-reset"),
    factsNote: $("#cz-facts-note")
  };
  noteEl = $("#cz-continue-note");
  if (els.factsNote) els.factsNote.textContent = FACTS_NOTE;

  const state = { generator, params: restoreParams(generator, loadDraft(generator)), result: null, status: "idle" };
  const font = { bytes: null, key: null };
  // Font choice: route shield's font_mode ("font" = the customer's file), or a generator's own
  // spec { key, custom, curated } where curated ids are fetched same-origin by the worker.
  const fontSpec = generator.font ?? (generator.schema.font_mode ? { key: "font_mode", custom: "font", curated: false } : null);
  const usesOwnFont = p => !!fontSpec && p?.[fontSpec.key] === fontSpec.custom;
  const NEED_FONT_FILE = fontSpec?.curated ? "Choose a font file below, or pick one of the listed fonts." : "Choose a font file below, or switch back to the built-in block font.";
  // A customer image lives only in this page's memory: decoded pixels, never params or drafts.
  const imageSpec = generator.image ?? null;
  const imageField = imageSpec ? Object.keys(imageSpec.when)[0] : null;
  const image = { data: null, error: "" };
  const trace = createTracer();
  const loadImage = createImageLoader();
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
    const next = continueState({ status: state.status, hasResult: !!state.result });
    if (els.continueButton) els.continueButton.disabled = next.disabled;
    if (next.note) setNote(next.note);
  }

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
    if (usesOwnFont(checked.value) && !font.bytes) {
      state.result = null;
      clearFacts();
      form.setErrors([], { [fontSpec.key]: NEED_FONT_FILE });
      setStatus("error", STATUS_TEXT.invalid, { retryable: false });
      return;
    }
    let imageContours;
    if (imageSpec && isFieldVisible({ visibleWhen: imageSpec.when }, checked.value)) {
      try {
        if (!image.data) throw new Error(image.error || "Choose an image below, or pick a built-in icon.");
        imageContours = trace(image.data, checked.value[imageSpec.threshold], checked.value[imageSpec.invert]);
        showTrace(imageContours);
      } catch (error) {
        state.result = null;
        clearFacts();
        renderWarnings([]);
        if (image.data) showTrace(null, error.message);
        form.setErrors([], { [imageField]: error.message });
        setStatus("error", STATUS_TEXT.invalid, { retryable: false });
        return;
      }
    }
    setStatus("building");
    try {
      // postMessage clones the bytes and contours only for the request that actually runs.
      // The customer's file only when it is the chosen font; a curated font by id.
      const options = {};
      if (usesOwnFont(checked.value)) Object.assign(options, { fontBytes: font.bytes, fontKey: font.key });
      else if (fontSpec?.curated && checked.value[fontSpec.key] !== "block") options.fontId = checked.value[fontSpec.key];
      if (imageContours) options.imageContours = imageContours;
      const result = await client.build(generator.id, checked.value, options);
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
      const failure = buildFailureStatus(error);
      if (!failure.settings) {
        // The builder didn't load (or timed out): the settings are fine, so the form shows no error.
        setStatus("error", failure.message, { retryable: failure.retryable });
        return;
      }
      // Geometry errors go next to the control they concern when the generator can tell
      // which one; otherwise into the Settings summary.
      const key = generator.errorField?.(message);
      if (key && Object.hasOwn(generator.schema, key)) form.setErrors([], { [key]: message });
      else form.setErrors([message], {});
      setStatus("error", failure.message, { retryable: !key });
    }
  }

  function syncFontArea() {
    if (els.fontArea) els.fontArea.hidden = !usesOwnFont(state.params);
    if (els.imageArea) els.imageArea.hidden = !(imageSpec && isFieldVisible({ visibleWhen: imageSpec.when }, state.params));
  }

  function setImageStatus(text, kind = "") {
    if (!els.imageStatus) return;
    els.imageStatus.textContent = text;
    els.imageStatus.dataset.state = kind;
  }
  function showTrace(contours, message) {
    if (!els.imagePreview) return;
    els.imagePreview.hidden = !contours;
    if (contours) {
      drawTracePreview(els.imagePreview, contours);
      const { sourceWidth, sourceHeight } = image.data;
      setImageStatus(`Traced from your ${sourceWidth} × ${sourceHeight} pixel image. Adjust the threshold or invert if the outline isn't what you want.`);
    } else if (message) setImageStatus(message, "error");
  }

  function onChange(key, value, { final }) {
    const { params: next, committed, changed } = applyEdit(generator, state.params, key, value, { final });
    if (committed) form.setValues(next);
    // A commit that changes nothing must not rebuild (see applyEdit).
    if (!changed) return;
    state.params = next;
    saveDraft(generator, state.params);
    syncFontArea();
    build();
  }

  form = renderForm(els.form, generator, state.params, { onChange });
  // The image picker sits in the form, right under the field that turns it on.
  if (imageSpec && els.imageArea) els.form.querySelector(`[data-field="${CSS.escape(imageField)}"]`)?.after(els.imageArea);
  // A generator with its own font spec gets the font-file picker right under its font control.
  if (generator.font && els.fontArea) els.form.querySelector(`[data-field="${CSS.escape(fontSpec.key)}"]`)?.after(els.fontArea);
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

  els.imageInput?.addEventListener("change", async () => {
    const file = els.imageInput.files?.[0];
    // Clear the input so picking the same file again (e.g. after an error) fires a new change.
    els.imageInput.value = "";
    if (!file) return;
    setImageStatus("Reading the image…");
    // Latest pick wins: a slower earlier decode that finishes later is ignored.
    const outcome = await loadImage(file);
    if (outcome.stale) return;
    image.data = outcome.data ?? null;
    image.error = outcome.error ?? "";
    if (!image.data) {
      showTrace(null, image.error);
      if (els.imagePreview) els.imagePreview.hidden = true;
    }
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

  let continuing = false;
  els.continueButton?.addEventListener("click", async () => {
    const result = state.result;
    if (!result || state.status !== "ready" || continuing) return;
    continuing = true;
    try {
      await continueHandler(continuePayload(generator, state.params, result));
    } catch (error) {
      setNote(String(error?.message ?? "Couldn't continue. Try again."));
    } finally {
      continuing = false;
    }
  });

  clearFacts();
  setStatus("idle");
  build();
}

if (typeof document !== "undefined") boot();
