// The panel under the font picker for the two fonts that come from the customer: a font file,
// or a font installed on their computer. Both sit behind the license confirmation (the
// font_license_ack checkbox): nothing here is usable until it is checked. The picked bytes live
// in this page's memory only (never params, drafts or the hand-off record).
import { MAX_FONT_BYTES, INSTALLED_UNSUPPORTED, INSTALLED_TOO_LARGE, installedFontsSupported, listInstalledFonts, filterFonts, readInstalledFont } from "./system-fonts.js";

export const FONT_FILE_ACCEPT = ".ttf,.otf,.woff,font/ttf,font/otf,font/woff";
const NEEDS_ACK = "Confirm the license box above to choose a font.";

const el = (doc, tag, props = {}, ...children) => {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k === "hidden" || k === "disabled" || k === "type" || k === "value" || k === "placeholder") node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
};

/**
 * spec: the generator's font spec ({ custom, system }). onPick(mode) runs after a font is chosen.
 * query: the installed-font lister (defaults to the browser's, injected by tests).
 */
export function createFontArea({ document: doc = document, spec, onPick = () => {}, query, supported = installedFontsSupported() } = {}) {
  const picked = { [spec.custom]: null, [spec.system]: null };
  const state = { mode: null, acknowledged: false, list: null, loading: false };

  const status = el(doc, "p", { class: "cz-font-status", id: "cz-font-status", "aria-live": "polite" });
  const file = el(doc, "input", { class: "cz-file", type: "file", id: "cz-font-file", accept: FONT_FILE_ACCEPT, "aria-describedby": "cz-font-help cz-font-status" });
  const fileSource = el(doc, "div", { class: "cz-font-source", "data-source": spec.custom, hidden: true },
    el(doc, "label", { class: "cz-label", for: "cz-font-file", text: "Your font file" }),
    file,
    el(doc, "p", { class: "help", id: "cz-font-help", text: "TTF, OTF or WOFF. The file stays on this device; it is never uploaded." }));

  const open = el(doc, "button", { class: "button ghost small-button cz-font-open", type: "button", id: "cz-font-system-open", text: "Choose an installed font…" });
  const filter = el(doc, "input", { class: "input", type: "search", id: "cz-font-system-filter", placeholder: "Filter installed fonts…", autocomplete: "off", "aria-label": "Filter installed fonts" });
  const options = el(doc, "ul", { class: "cz-font-options", id: "cz-font-system-list", "aria-label": "Installed fonts" });
  const more = el(doc, "p", { class: "help cz-font-more", "aria-live": "polite" });
  const list = el(doc, "div", { class: "cz-font-list", hidden: true }, filter, options, more);
  const systemSource = el(doc, "div", { class: "cz-font-source", "data-source": spec.system, hidden: true },
    open,
    el(doc, "p", { class: "help", id: "cz-font-system-help", text: supported
      ? "Your browser asks permission to list the fonts on this computer. The list and the font you pick stay on this device; they are never uploaded."
      : INSTALLED_UNSUPPORTED }),
    list);
  if (!supported) open.disabled = true;

  const root = el(doc, "div", { class: "cz-font-area", id: "cz-font-area", hidden: true }, fileSource, systemSource, status);

  const setStatus = (text, kind = "") => { status.textContent = text; status.dataset.state = kind; };

  function renderStatus() {
    const choice = state.mode && picked[state.mode];
    if (!state.acknowledged) setStatus(NEEDS_ACK);
    else if (choice) setStatus(`Using ${choice.label}. It stays on this device and only shapes the text.`);
    else setStatus("");
  }

  function renderOptions() {
    if (!state.list) return;
    const { shown, total } = filterFonts(state.list, filter.value);
    const current = picked[spec.system]?.key;
    options.replaceChildren(...shown.map(f => {
      const button = el(doc, "button", { class: "cz-font-option", type: "button", "data-id": f.id, "aria-pressed": String(current === `system:${f.id}`), text: f.label });
      button.style.fontFamily = `${JSON.stringify(f.family)}, system-ui, sans-serif`;
      button.disabled = !state.acknowledged;
      return el(doc, "li", {}, button);
    }));
    more.textContent = total > shown.length ? `Showing ${shown.length} of ${total} fonts. Type to narrow the list.` : (total ? `${total} font${total === 1 ? "" : "s"}.` : "No fonts match.");
  }

  function sync({ mode, acknowledged }) {
    state.mode = mode;
    state.acknowledged = acknowledged;
    root.hidden = mode !== spec.custom && mode !== spec.system;
    fileSource.hidden = mode !== spec.custom;
    systemSource.hidden = mode !== spec.system;
    file.disabled = !acknowledged;
    open.disabled = !acknowledged || !supported;
    filter.disabled = !acknowledged;
    for (const b of options.querySelectorAll("button")) b.disabled = !acknowledged;
    renderStatus();
  }

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen || !state.acknowledged) return;
    if (chosen.size > MAX_FONT_BYTES) { setStatus("That font file is too large (over 15 MB).", "error"); return; }
    picked[spec.custom] = { bytes: new Uint8Array(await chosen.arrayBuffer()), key: `${chosen.name}:${chosen.size}:${chosen.lastModified}`, label: chosen.name };
    renderStatus();
    onPick(spec.custom);
  });

  open.addEventListener("click", async () => {
    if (!state.acknowledged || state.loading) return;
    state.loading = true;
    setStatus("Waiting for your browser's permission…");
    try {
      state.list ??= await listInstalledFonts(query);
      list.hidden = false;
      renderOptions();
      renderStatus();
      filter.focus();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      state.loading = false;
    }
  });
  filter.addEventListener("input", renderOptions);
  options.addEventListener("click", async event => {
    const button = event.target.closest?.("button[data-id]");
    if (!button || !state.acknowledged) return;
    const entry = state.list?.find(f => f.id === button.dataset.id);
    if (!entry) return;
    try {
      picked[spec.system] = await readInstalledFont(entry);
    } catch (error) {
      setStatus(error.message || INSTALLED_TOO_LARGE, "error");
      return;
    }
    renderOptions();
    renderStatus();
    onPick(spec.system);
  });

  return {
    element: root,
    sync,
    /** The font the customer picked for this mode: { bytes, key, label } or null. */
    picked: mode => picked[mode] ?? null,
    supported
  };
}
