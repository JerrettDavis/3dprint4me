import { estimateProductionFromGeometry, MODEL_WARNING_MESSAGES } from "./geometry.js?v=60932ed026a4e317";

const modelPanelNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const modelPanelInteger = new Intl.NumberFormat("en-US");

const MODEL_PRIVATE_COPY = Object.freeze({
  none: "",
  unavailable: "Private model storage is not connected here. The file will still travel with your request if you submit it.",
  uploading: "Uploading privately for verification…",
  verifying: "Uploaded privately. Verifying the model on the server…",
  verified: "Uploaded privately and verified. It is kept for 24 hours unless you submit this request.",
  failed: "The private check did not finish. You can still submit; the file will be reviewed by a person."
});

function modelPanelElement(document, name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const PACK_SLICE_COPY = Object.freeze({
  ready: "A slicer profile estimated time and material for the selected parts. The operator still confirms the final price.",
  pending: "Measured from geometry — this is not a slice. An exact slicer estimate is queued; you can submit now and the operator will confirm it."
});

const PACK_PRICE_NOTE = "Packs are printed part by part; the confirmed price is often higher than this planning range.";

/** ZIP pack picker. Part and file names come from the archive, so they are only ever set as text. */
function packPicker(el, state) {
  const { parts, selection, ignored } = state.pack;
  const fieldset = el("fieldset", "pack-picker");
  fieldset.append(el("legend", "", `Choose parts to print (${parts.length} found in this pack)`));
  for (const part of parts) {
    const choice = selection[part.id];
    const row = el("div", "pack-part");
    const check = el("input");
    check.type = "checkbox"; check.id = `pack-${part.id}`; check.checked = Boolean(choice?.selected); check.disabled = Boolean(part.error);
    check.dataset.partId = part.id; check.dataset.packAction = "select";
    const label = el("label", "pack-part-name", part.name);
    label.htmlFor = check.id;
    const quantity = el("input", "input pack-part-qty");
    quantity.type = "number"; quantity.min = "1"; quantity.max = "99"; quantity.step = "1"; quantity.inputMode = "numeric";
    quantity.value = String(choice?.quantity ?? 1); quantity.id = `pack-qty-${part.id}`; quantity.disabled = Boolean(part.error) || !choice?.selected;
    quantity.dataset.partId = part.id; quantity.dataset.packAction = "quantity";
    quantity.setAttribute("aria-label", `Quantity of ${part.name}`);
    const meta = el("span", "pack-part-meta", part.error
      ? "Could not be measured — a person will review it."
      : `${part.dimensionsMm.map(value => modelPanelNumber.format(value)).join(" × ")} mm · ${modelPanelNumber.format(part.volumeMm3 / 1000)} cm³`);
    meta.id = `pack-meta-${part.id}`;
    check.setAttribute("aria-describedby", meta.id);
    row.append(check, label, quantity, meta);
    fieldset.append(row);
  }
  const chosen = parts.filter(part => selection[part.id]?.selected).length;
  const nodes = [fieldset];
  if (state.pack.hint) nodes.push(el("p", "model-status model-status-warning pack-hint", state.pack.hint));
  nodes.push(el("p", "model-status pack-summary", chosen ? `${chosen} of ${parts.length} parts selected.` : "None of these parts could be measured; a person will review the pack."));
  if (ignored.length) nodes.push(el("p", "model-status", `Not printed: ${ignored.map(entry => entry.name).join(", ")}`));
  nodes.push(el("p", "model-status", PACK_SLICE_COPY[state.slice?.status] ?? "Measured from geometry — this is not a slice. The operator confirms the final price."));
  // The stored pack price counts one plate per selected part, so it is usually above this range.
  nodes.push(el("p", "model-status pack-price-note", PACK_PRICE_NOTE));
  return nodes;
}

export function syncPicker(picker, { parts, selection }) {
  for (const part of parts) {
    const choice = selection[part.id];
    const check = picker.querySelector(`[data-pack-action="select"][data-part-id="${part.id}"]`);
    const quantity = picker.querySelector(`[data-pack-action="quantity"][data-part-id="${part.id}"]`);
    // The picker owns these states; other form code must not decide them.
    if (check) { check.checked = Boolean(choice?.selected); check.disabled = Boolean(part.error); }
    if (quantity) {
      if (quantity !== quantity.ownerDocument.activeElement) quantity.value = String(choice?.quantity ?? 1); // never under the caret
      quantity.disabled = Boolean(part.error) || !choice?.selected;
    }
  }
}

export function createModelPanelView({ document, card }) {
  // The picker is built once per pack and then updated in place. Rebuilding it on every render
  // would detach the checkbox or quantity a customer is using (losing the click and focus).
  let picker = null;
  let pickerKey = null;
  return {
    render(state, options = {}) {
      if (!state.file) { card.hidden = true; card.replaceChildren(); card.dataset.state = "idle"; return; }
      const el = (name, className, text) => modelPanelElement(document, name, className, text);
      card.hidden = false;
      card.dataset.state = state.status;
      const head = el("div", "model-card-head");
      head.append(el("strong", "model-name", state.file.name), el("span", "model-format", state.metrics ? `${state.metrics.format.toUpperCase()}${state.metrics.encoding ? ` · ${state.metrics.encoding}` : ""}` : state.file.name.split(".").pop().toUpperCase()));
      const children = [head];
      if (state.status === "reading") children.push(el("p", "model-status", "Measuring the model in your browser…"));
      if (state.status === "failed") children.push(el("p", "model-status model-status-warning", `${state.message} You can still submit it; a person will review the file.`));
      if (state.status === "analyzed" && state.pack) {
        const nodes = packPicker(el, state);
        const key = JSON.stringify([state.file, state.pack.parts]);
        if (key !== pickerKey || picker?.parentNode !== card) { picker = nodes[0]; pickerKey = key; }
        else syncPicker(picker, state.pack);
        children.push(picker, ...nodes.slice(1));
      }
      else if (state.status === "analyzed" && state.metrics) {
        const m = state.metrics;
        const facts = el("dl", "model-facts");
        const slice = state.slice?.status === "ready" ? state.slice.production : null;
        const production = slice ? { gramsPerUnit: slice.estimatedGramsPerUnit, hoursPerUnit: slice.estimatedHoursPerUnit } : estimateProductionFromGeometry(m, options);
        for (const [label, value] of [
          ["Size", `${m.dimensionsMm.map(value => modelPanelNumber.format(value)).join(" × ")} mm`],
          ["Volume", `${modelPanelNumber.format(m.volumeMm3 / 1000)} cm³`],
          ["Triangles", modelPanelInteger.format(m.triangleCount)],
          [slice ? "Slicer estimate" : "Rough estimate", `${slice ? "" : "~"}${modelPanelNumber.format(production.gramsPerUnit)} g · ${slice ? "" : "~"}${modelPanelNumber.format(production.hoursPerUnit)} h per part`]
        ]) {
          const row = el("div");
          row.append(el("dt", "", label), el("dd", "", value));
          facts.append(row);
        }
        children.push(facts);
        children.push(el("p", "model-status", slice
          ? "A slicer profile estimated time and material, so the range is tighter. The operator still confirms the final price."
          : state.slice?.status === "pending"
            ? "Measured from geometry — this is not a slice. An exact slicer estimate is queued; you can submit now and the operator will confirm it."
            : "Measured from geometry — this is not a slice, so confidence stays rough until the operator confirms it."));
        if (m.warnings?.length) {
          const list = el("ul", "model-warnings");
          list.setAttribute("aria-label", "Model warnings");
          for (const code of m.warnings) if (MODEL_WARNING_MESSAGES[code]) list.append(el("li", "", MODEL_WARNING_MESSAGES[code]));
          children.push(list);
        }
      }
      if (MODEL_PRIVATE_COPY[state.privateState]) children.push(el("p", `model-private model-private-${state.privateState}`, MODEL_PRIVATE_COPY[state.privateState]));
      const kept = children.includes(picker) && picker.parentNode === card ? picker : null;
      if (kept) {
        // Same picker: swap the nodes around it so a focused checkbox or quantity is never detached.
        for (const node of [...card.childNodes]) if (node !== kept) node.remove();
        const index = children.indexOf(kept);
        kept.before(...children.slice(0, index));
        kept.after(...children.slice(index + 1));
        return;
      }
      card.replaceChildren(...children);
    }
  };
}
