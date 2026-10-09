// Generator page entry. Page state: { generator, params, result, status } with
// status idle | building | ready | error. A settings problem is an error without a retry.
// Geometry builds in a worker (latest wins); facts are computed locally from the built 3MF;
// nothing here touches the network.
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { browserInflateRaw } from "../../public/assets/js/print-estimation/controller.js";
import { renderForm, restoreParams, storableParams, esc, isFieldVisible, hasAdvanced } from "./form.js";
import { hasSections, partSection, sectionLabel } from "./sections.js";
import { DUR, enter, play, reducedMotion, setOpen } from "./motion.js";
import { loadUi, saveUi } from "./ui-state.js";
import { initWindows } from "./windows.js";
import { createImageLoader, createTracer, drawTracePreview } from "./image-input.js";
import { createWorkerClient } from "./worker-client.js";
import { buildFailureStatus } from "./build-status.js";
import { colorCountLabel, describeFacts, FACTS_NOTE } from "./facts.js";
import { continuePayload, continueState, continueToOrder } from "./continue.js";
import { writeHandoff } from "./handoff.js";
import { createDownloadDialog, safeFilename } from "./download-dialog.js";
import { partsToStl, stlFilename } from "./stl.js";
import { createFontArea } from "./font-area.js";
import { applyDesign, designsOf } from "./designs.js";
import { createDesignPanel, mountLocks } from "./explore-ui.js";
import { randomizeUntilBuilds } from "./randomize.js";
import { locationFontIds, fontNeededMessage, fontNeedsLicense } from "../../public/assets/js/customize/fonts.js";

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
    downloadButton: null,
    retry: $("#cz-retry"),
    fallback: $("#cz-fallback"),
    stage: $("#cz-stage"),
    stageMessage: $("#cz-stage-message"),
    tabs: [...document.querySelectorAll("[data-view]")],
    bedToggle: $("#cz-bed-toggle"),
    imageArea: $("#cz-image-area"),
    imageInput: $("#cz-image-file"),
    imageStatus: $("#cz-image-status"),
    imagePreview: $("#cz-image-preview"),
    reset: $("#cz-reset"),
    factsNote: $("#cz-facts-note"),
    canvas: $("#cz-canvas"),
    tip: $("#cz-tip"),
    announce: $("#cz-announce"),
    mode: $("#cz-mode"),
    hint: $("#cz-hint")
  };
  noteEl = $("#cz-continue-note");
  if (els.factsNote) els.factsNote.textContent = FACTS_NOTE;

  const state = { generator, params: restoreParams(generator, loadDraft(generator)), result: null, status: "idle" };
  // Font choice: every generator carries the shared font spec { key, custom, system, ack }.
  // Curated ids are fetched same-origin by the worker; the customer's own font (a file, or one
  // installed on their computer) lives only in the font area below, in this page's memory.
  const fontSpec = generator.font ?? null;
  const fontMode = p => (fontSpec && fontNeedsLicense(p?.[fontSpec.key]) ? p[fontSpec.key] : null);
  const fontUsable = p => !!fontSpec && isFieldVisible(generator.schema[fontSpec.key], p);
  const fontArea = fontSpec ? createFontArea({ spec: fontSpec, onPick: () => build() }) : null;
  // A customer image lives only in this page's memory: decoded pixels, never params or drafts.
  const imageSpec = generator.image ?? null;
  const imageField = imageSpec ? Object.keys(imageSpec.when)[0] : null;
  const image = { data: null, error: "" };
  const trace = createTracer();
  const loadImage = createImageLoader();
  const client = createWorkerClient();
  let viewer = null;
  let viewerLoading = null;
  // A definition may start in another view and rename the flat views (a round 3D object reads
  // as "Top" / "Bottom", not "Front" / "Back").
  let view = generator.initialView ?? "front";
  let form = null;

  function setStatus(status, message, { retryable = true } = {}) {
    const changed = state.status !== status;
    state.status = status;
    if (els.status) {
      els.status.textContent = message ?? STATUS_TEXT[status] ?? "";
      els.status.dataset.state = status;
      // A state change gets a small pop; repeating "building" while typing must not flicker.
      if (changed) play(els.status, [{ opacity: 0.35, transform: "translateY(6px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: DUR.base });
    }
    updateContinue();
    const showFallback = status === "error" && retryable;
    if (els.retry) els.retry.hidden = !showFallback;
    if (els.fallback) {
      if (showFallback && els.fallback.hidden) { els.fallback.hidden = false; enter(els.fallback, { y: -6 }); } else els.fallback.hidden = !showFallback;
    }
    document.body.dataset.buildState = status;
  }

  function updateContinue() {
    const next = continueState({ status: state.status, hasResult: !!state.result });
    if (els.continueButton) els.continueButton.disabled = next.disabled;
    if (els.downloadButton) els.downloadButton.disabled = next.disabled;
    if (next.note) setNote(next.note);
  }

  // Warnings: only lines that were not shown a moment ago animate in; the list opens/closes with the
  // shared height transition. While it closes, the old lines stay drawn.
  let shownWarnings = [];
  function renderWarnings(list) {
    if (!els.warnings) return;
    const fresh = new Set(list.filter(w => !shownWarnings.includes(w)));
    shownWarnings = [...list];
    if (list.length) {
      els.warnings.innerHTML = list.map(w => `<li${fresh.has(w) ? ` class="is-new"` : ""}>${esc(w)}</li>`).join("");
      if (els.warnings.hidden || els.warnings.__czAnim) setOpen(els.warnings, true);
    } else if (!els.warnings.hidden) {
      setOpen(els.warnings, false).then(() => { if (!shownWarnings.length) els.warnings.innerHTML = ""; });
    }
  }

  function clearFacts() {
    if (els.facts) els.facts.innerHTML = EMPTY_FACTS;
    if (els.badge) { els.badge.textContent = ""; els.badge.hidden = true; }
  }
  const showFacts = html => {
    els.facts.innerHTML = html;
    play(els.facts, [{ opacity: 0.4 }, { opacity: 1 }], { duration: DUR.base });
  };

  async function renderFacts(result) {
    const colors = result.metrics?.unique_colors ?? 1;
    if (els.badge) { els.badge.textContent = colorCountLabel(colors); els.badge.hidden = false; }
    try {
      const metrics = await analyzeModelBytes({ name: result.filename, bytes: result.data, inflateRaw: browserInflateRaw });
      if (state.result !== result) return;
      const facts = describeFacts(metrics, { colors });
      showFacts(facts.rows.map(r => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join(""));
      if (!facts.fitsBed) renderWarnings([...(result.warnings ?? []), "This model is larger than a typical build plate; we'll check how to split or scale it."]);
    } catch {
      if (state.result === result) showFacts(`<div class="cz-facts-wide"><dt>Facts</dt><dd>Couldn't measure this model in the browser. We'll measure it when you send the request.</dd></div>`);
    }
  }

  // ---- Sections: the preview and the settings point at each other ----------------------------
  // link.preview: the part under the pointer; link.hover / link.focus: the settings under the
  // pointer / holding keyboard focus; selected: the section the customer clicked or tapped.
  const link = { preview: null, hover: null, focus: null };
  let selected = null;
  let inset = { left: 0, right: 0, top: 0, bottom: 0 };
  let windows = null;
  let announceTimer = 0;
  let tipTimer = 0;

  function announce(text) {
    if (!els.announce) return;
    els.announce.textContent = "";
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { els.announce.textContent = text; }, 30);
  }
  function applyHighlight() {
    viewer?.setHighlight({ hover: link.preview ?? link.hover ?? link.focus, selected });
    form?.setLinked(link.preview ?? selected);
  }
  function hideTip() { els.tip?.classList.remove("is-visible"); }
  function showTip(text, point) {
    const tip = els.tip;
    if (!tip || !els.stage) return;
    clearTimeout(tipTimer);
    if (tip.textContent !== text) tip.textContent = text;
    const box = els.stage.getBoundingClientRect();
    const x = Math.min(Math.max(8, point.x + 14), Math.max(8, box.width - tip.offsetWidth - 8));
    const y = point.y + 18 > box.height - 44 ? Math.max(8, point.y - 38) : point.y + 18;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.classList.add("is-visible");
  }
  function onPreviewHover(key, _name, point) {
    if (key && point) showTip(sectionLabel(generator, key), point);
    else hideTip();
    if (key === link.preview) return;
    link.preview = key;
    applyHighlight();
  }
  function selectSection(key, { touch = false, point = null } = {}) {
    selected = key;
    applyHighlight();
    viewer?.pulse(key);
    windows?.reveal("settings");
    const label = sectionLabel(generator, key);
    const found = form.revealSection(key, { focus: !touch });
    announce(found ? `${label} selected: ${found.count} setting${found.count === 1 ? "" : "s"}${touch ? "" : ". Focus is on the first one"}.` : `${label} selected. It has no settings to change here.`);
    if (touch && point) {
      showTip(label, point);
      tipTimer = setTimeout(hideTip, 1500);
    }
  }
  function clearSelection() {
    if (!selected) return;
    selected = null;
    applyHighlight();
    announce("Selection cleared.");
  }
  function onPreviewPick(key, _name, point, pointerType) {
    if (key) selectSection(key, { touch: pointerType === "touch", point });
    else clearSelection();
  }
  // Escape with focus outside the tool windows (or on the canvas) clears the selection.
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && selected) clearSelection();
  });

  function ensureViewer() {
    if (viewer || !els.stage) return Promise.resolve(viewer);
    viewerLoading ??= import("./viewer3d.js")
      .then(({ createViewer }) => {
        viewer = createViewer(els.stage, { label: `${generator.title} preview` });
        viewer.setPartResolver(name => partSection(generator, name));
        viewer.onHover(onPreviewHover);
        viewer.onPick(onPreviewPick);
        viewer.setInset(inset);
        viewer.setView(view, { animate: false });
        applyHighlight();
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

  // A trial build for Randomize: the same inputs as build() for a curated font, with no effect on
  // the page. Resolves false when the model does not build or a newer edit superseded it.
  async function canBuild(params) {
    const checked = validateParams(generator, params);
    if (!checked.ok) return false;
    try {
      const options = {};
      const chosen = fontUsable(checked.value) ? checked.value[fontSpec?.key] : "block";
      if (fontSpec && chosen !== "block" && !fontNeedsLicense(chosen)) options.fontId = chosen;
      const ids = locationFontIds(generator, checked.value);
      if (ids.length) options.locationFontIds = ids;
      await client.build(generator.id, checked.value, options);
      return true;
    } catch {
      return false;
    }
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
    const ownFont = fontUsable(checked.value) ? fontMode(checked.value) : null;
    if (ownFont && !fontArea.picked(ownFont)) {
      state.result = null;
      clearFacts();
      form.setErrors([], { [fontSpec.key]: fontNeededMessage(ownFont) });
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
      // The customer's own font only when it is the chosen one; a curated font by id. A generator
      // that prints no text right now (a keychain tag) needs no font at all.
      const options = {};
      const chosen = fontUsable(checked.value) ? checked.value[fontSpec?.key] : "block";
      if (ownFont) {
        const { bytes, key } = fontArea.picked(ownFont);
        Object.assign(options, { fontBytes: bytes, fontKey: key });
      } else if (fontSpec && chosen !== "block") options.fontId = chosen;
      const locationIds = locationFontIds(generator, checked.value);
      if (locationIds.length) options.locationFontIds = locationIds;
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
    fontArea?.sync({ mode: fontUsable(state.params) ? fontMode(state.params) : null, acknowledged: state.params[fontSpec?.ack] === true });
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
    explore.touched();
    saveDraft(generator, state.params);
    syncFontArea();
    build();
  }

  // Layout preferences (localStorage, try/catch): the Settings grouping and collapsed groups.
  const ui = loadUi();
  const canSection = hasSections(generator);
  const startMode = canSection ? (ui.mode === "category" ? "category" : "section") : "category";
  const groupPrefix = `${generator.id}|`;
  const collapsedGroups = Object.fromEntries(Object.entries(ui.groups ?? {}).filter(([k]) => k.startsWith(groupPrefix)).map(([k, v]) => [k.slice(groupPrefix.length), v === true]));
  form = renderForm(els.form, generator, state.params, {
    onChange,
    mode: startMode,
    advanced: !hasAdvanced(generator) || ui.level === "advanced",
    onShowAdvanced: () => setLevel("advanced"),
    collapsed: collapsedGroups,
    onCollapse: (key, isCollapsed) => saveUi({ groups: { [groupPrefix + key]: isCollapsed } }),
    onLink: (key, source) => { link[source] = key; applyHighlight(); }
  });
  // The image picker sits in the form, right under the field that turns it on; the font area
  // (file / installed font) right under the license confirmation it depends on.
  if (imageSpec && els.imageArea) form.attach(imageField, els.imageArea);
  if (fontArea) {
    form.attach(fontSpec.ack, fontArea.element);
    // A browser that can't list installed fonts can't offer that choice.
    if (!fontArea.supported) {
      const radio = els.form.querySelector(`input[name="${CSS.escape(fontSpec.key)}"][value="${CSS.escape(fontSpec.system)}"]`);
      if (radio) {
        radio.disabled = true;
        const label = els.form.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
        if (label) label.append(" (not available in this browser)");
      }
    }
  }
  form.setValues(state.params);
  syncFontArea();

  // Group by: Section | Category. Offered only when the definition names sections.
  if (els.mode) {
    const paintMode = current => { for (const button of els.mode.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === current)); };
    els.mode.hidden = !canSection;
    paintMode(form.getMode());
    els.mode.addEventListener("click", event => {
      const button = event.target.closest?.("[data-mode]");
      if (!button || button.dataset.mode === form.getMode()) return;
      form.setMode(button.dataset.mode);
      paintMode(button.dataset.mode);
      saveUi({ mode: button.dataset.mode });
      announce(`Settings grouped by ${button.dataset.mode}.`);
    });
  }
  // Simple | Advanced: offered only when the definition marks fields `advanced`. Hidden advanced
  // fields keep their values, are still validated and built, and stay reachable from any error.
  let levelBar = null;
  function setLevel(level) {
    form.setAdvanced(level === "advanced");
    saveUi({ level });
    if (levelBar) for (const button of levelBar.querySelectorAll("[data-level]")) button.setAttribute("aria-pressed", String(button.dataset.level === level));
    announce(`${level === "advanced" ? "Advanced" : "Simple"} settings shown.`);
  }
  if (hasAdvanced(generator) && els.mode?.parentElement) {
    levelBar = document.createElement("div");
    levelBar.className = "cz-seg";
    levelBar.id = "cz-level";
    levelBar.setAttribute("role", "group");
    levelBar.setAttribute("aria-label", "Settings detail");
    const now = form.getAdvanced() ? "advanced" : "simple";
    levelBar.innerHTML = `<span class="cz-seg-label" aria-hidden="true">Settings</span>
      <button class="cz-seg-button" type="button" data-level="simple" aria-pressed="${now === "simple"}">Simple</button>
      <button class="cz-seg-button" type="button" data-level="advanced" aria-pressed="${now === "advanced"}">Advanced</button>`;
    levelBar.addEventListener("click", event => {
      const button = event.target.closest?.("[data-level]");
      if (button && button.getAttribute("aria-pressed") !== "true") setLevel(button.dataset.level);
    });
    els.mode.before(levelBar);
  }
  if (els.tip) els.tip.hidden = false;
  windows = els.canvas ? initWindows(els.canvas, { onLayout: next => { inset = next; viewer?.setInset(next); } }) : null;

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

  // ---- Explore: ready-made designs, padlocks and Randomize --------------------------------
  // Every jump (a design, a randomize, a reset) remembers the settings it replaced for one Undo.
  const explore = (() => {
    const designs = designsOf(generator);
    const tools = els.reset?.parentElement ?? null;
    const defaultDesign = designs.find(d => d.id === generator.defaultDesign) ?? null;
    let designId = null;
    let modified = false;
    let previous = null;
    let panel = null;
    let locks = null;
    let undoButton = null;
    let randomButton = null;
    const same = (a, b) => JSON.stringify(storableParams(generator, a)) === JSON.stringify(storableParams(generator, b));
    const paint = () => panel?.setCurrent(designId, { modified });
    function jump(next, { id, message }) {
      previous = { params: state.params, designId, modified };
      state.params = next;
      designId = id;
      modified = false;
      saveDraft(generator, state.params);
      form.setValues(state.params);
      syncFontArea();
      paint();
      if (undoButton) undoButton.hidden = false;
      announce(message);
      build();
    }
    function undo() {
      if (!previous) return;
      const back = previous;
      previous = null;
      state.params = back.params;
      designId = back.designId;
      modified = back.modified;
      saveDraft(generator, state.params);
      form.setValues(state.params);
      syncFontArea();
      paint();
      if (undoButton) undoButton.hidden = true;
      announce("Undone. Your previous settings are back.");
      build();
    }
    function pick(design) {
      const next = applyDesign(generator, design, state.params);
      if (!next) { announce(`${design.label} couldn't be applied.`); return; }
      jump(next, { id: design.id, message: `${design.label} applied. Use Undo to go back.` });
      panel?.collapse();
    }
    async function randomize() {
      if (randomButton.disabled) return;
      randomButton.disabled = true;
      randomButton.setAttribute("aria-busy", "true");
      let result;
      try {
        result = await randomizeUntilBuilds(generator, state.params, { locked: locks?.locked() ?? new Set(), tryBuild: canBuild });
      } finally {
        randomButton.disabled = false;
        randomButton.removeAttribute("aria-busy");
      }
      if (!result.ok) { announce("Couldn't find a new look that builds. Unlock a setting or try again."); build(); return; }
      const lockedCount = locks?.count() ?? 0;
      jump(result.params, { id: null, message: `Randomized ${result.changed.length} setting${result.changed.length === 1 ? "" : "s"}${lockedCount ? `; ${lockedCount} locked` : ""}. Text and QR codes are never changed. Use Undo to go back.` });
    }
    if (designs.length) {
      // Open for a first visit on a wide screen; a phone starts on the settings themselves.
      const fresh = loadDraft(generator) === null && !globalThis.matchMedia?.("(max-width: 760px)").matches;
      panel = createDesignPanel(generator, { open: fresh, onPick: pick });
      (tools ?? els.form).after(panel.element);
      designId = defaultDesign && same(state.params, applyDesign(generator, defaultDesign, state.params) ?? {}) ? defaultDesign.id : (designs.find(d => { const p = applyDesign(generator, d, state.params); return p && same(state.params, p); })?.id ?? null);
      paint();
    }
    if (tools) {
      randomButton = document.createElement("button");
      randomButton.type = "button";
      randomButton.className = "button ghost small-button";
      randomButton.id = "cz-randomize";
      randomButton.textContent = "Randomize";
      randomButton.title = "Try a random look. Padlocked settings, text and QR codes stay as they are.";
      undoButton = document.createElement("button");
      undoButton.type = "button";
      undoButton.className = "button ghost small-button";
      undoButton.id = "cz-undo";
      undoButton.textContent = "Undo";
      undoButton.hidden = true;
      els.reset.before(randomButton, undoButton);
      randomButton.addEventListener("click", randomize);
      undoButton.addEventListener("click", undo);
      const help = document.createElement("p");
      help.className = "help cz-random-help";
      help.id = "cz-random-help";
      help.textContent = "Randomize re-rolls colors, fonts, styles and sizes. Lock a setting with its padlock to keep it. Names, other text and QR codes never change.";
      (panel?.element ?? tools).after(help);
      randomButton.setAttribute("aria-describedby", help.id);
      locks = mountLocks(els.form, generator);
    }
    return {
      touched() { if (!modified && designId) { modified = true; paint(); } else if (!designId) paint(); },
      reset() {
        previous = null;
        if (undoButton) undoButton.hidden = true;
        designId = defaultDesign?.id ?? null;
        modified = false;
        paint();
      }
    };
  })();

  els.reset?.addEventListener("click", () => {
    clearDraft(generator);
    state.params = validateParams(generator, {}).value;
    explore.reset();
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
    updateHint();
    viewer?.setView(next);
  }
  // The hint only promises what this page and view can do: turning exists in 3D, and clicking a
  // part needs the definition's `focus` map.
  function updateHint() {
    if (!els.hint) return;
    const parts = [];
    if (view === "3d") parts.push("Drag to turn, scroll or pinch to zoom.");
    if ((generator.focus ?? []).length) parts.push("Click a part to jump to its settings.");
    els.hint.textContent = parts.join(" ");
    els.hint.hidden = !parts.length;
  }
  els.tabs.forEach(tab => { const label = generator.viewLabels?.[tab.dataset.view]; if (label) tab.textContent = label; });
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
  async function continueToRequest(result) {
    if (continuing) return;
    continuing = true;
    try {
      await continueHandler(continuePayload(generator, state.params, result));
    } catch (error) {
      setNote(String(error?.message ?? "Couldn't continue. Try again."));
    } finally {
      continuing = false;
    }
  }
  els.continueButton?.addEventListener("click", () => {
    const result = state.result;
    if (result && state.status === "ready") continueToRequest(result);
  });

  // Download: a thank-you dialog first (a print offer and an optional email), then the file.
  // The model that is downloaded is the one that was ready when the dialog opened.
  if (els.continueButton) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button ghost";
    button.id = "cz-download";
    button.disabled = true;
    button.innerHTML = '<span class="cz-long">Download my model</span><span class="cz-short" aria-hidden="true">Download</span>';
    button.setAttribute("aria-label", "Download my model");
    els.continueButton.before(button);
    els.downloadButton = button;
    const dialog = createDownloadDialog({
      onDownload: ({ result }) => downloadFile(new Blob([result.data], { type: "model/3mf" }), safeFilename(result.filename)),
      onDownloadStl: ({ result }) => downloadFile(new Blob([partsToStl(result.parts)], { type: "model/stl" }), safeFilename(stlFilename(result.filename))),
      onPrint: ({ result }) => continueToRequest(result)
    });
    button.addEventListener("click", () => {
      const result = state.result;
      if (result && state.status === "ready") dialog.open({ result, generatorId: generator.id }, button);
    });
    updateContinue();
  }

  clearFacts();
  setStatus("idle");
  build();
}

if (typeof document !== "undefined") boot();
