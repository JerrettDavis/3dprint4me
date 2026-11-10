// Customizer provenance section of the operator job sheet. Values come from the authenticated
// work-detail response (`request.customization`, already validated and redacted by the server)
// and are rendered with textContent only.
export const WITHHELD = "withheld (in the model's QR code)";
export const CUSTOMIZATION_NOTE = "The attached 3MF is the model to print; these values are provenance.";
const REDACTED = "[redacted]";

const humanize = value => String(value ?? "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const display = value => {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value == null || value === "") return "—";
  if (Array.isArray(value) && value.length && value.every(point => point && Number.isFinite(point.height) && Number.isFinite(point.radius))) {
    const percent = number => Number((number * 100).toFixed(3));
    return value.map(point => `${percent(point.height)}% height / ${percent(point.radius)}% radius`).join('; ');
  }
  return String(value);
};

function el(name, className, text) { const node = document.createElement(name); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function facts(rows) {
  const list = el("dl", "print-facts");
  for (const [term, value] of rows) { const row = el("div"); row.append(el("dt", "", term), el("dd", "", value)); list.append(row); }
  return list;
}

/** [term, value] rows: generator, version, then one row per parameter. */
export function customizationRows(customization) {
  const redacted = new Set(customization.redacted ?? []);
  const params = customization.params && typeof customization.params === "object" ? customization.params : {};
  return [
    ["Generator", display(customization.generatorId)],
    ["Version", display(customization.generatorVersion)],
    ...Object.entries(params).map(([key, value]) => [humanize(key), redacted.has(key) || value === REDACTED ? WITHHELD : display(value)])
  ];
}

/** Returns the Customizer section for a job sheet, or null when the request has no customization. */
export function renderCustomization(request) {
  const customization = request?.customization;
  if (!customization || typeof customization !== "object") return null;
  const section = el("section", "customization-sheet");
  section.setAttribute("aria-labelledby", "customization-sheet-title");
  const heading = el("h3", "", "Customizer"); heading.id = "customization-sheet-title";
  section.append(heading, el("p", "print-meta", CUSTOMIZATION_NOTE), facts(customizationRows(customization)));
  return section;
}
