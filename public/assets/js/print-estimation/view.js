import { estimateProductionFromGeometry, MODEL_WARNING_MESSAGES } from "./geometry.js?v=295d8d664ce2c0cd";

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

export function createModelPanelView({ document, card }) {
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
      if (state.status === "analyzed" && state.metrics) {
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
      card.replaceChildren(...children);
    }
  };
}
