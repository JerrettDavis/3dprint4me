const COMMON_FIELDS = new Set([
  "service", "projectTitle", "description", "modelUrl", "deadline", "delivery",
  "contactNotes", "name", "email", "phone", "preferredContact", "address",
  "projectFiles", "terms", "website"
]);
const SERVICE_FIELDS = Object.freeze({
  print: new Set(["material", "quality", "colors", "finish", "supports", "quantity", "sizeClass", "grams", "machineHours"]),
  design: new Set(["complexity", "sourceQuality", "deliverable", "includePrint"]),
  repair: new Set(["printerModel", "repairType", "recentChange"]),
  consult: new Set(["consultType", "meetingFormat", "consultOutcome"])
});

export function activeProjectData(data) {
  const allowed = SERVICE_FIELDS[data?.service] ?? new Set();
  return Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => COMMON_FIELDS.has(key) || allowed.has(key)));
}

const isPlainObject = value => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Builds the request from the active service projection. Customizer provenance is print-only:
 * other service paths never submit it. The server re-validates and redacts it again.
 */
export function projectRequestFromData({ data, estimate, files, buildSummary, customization = null, packSelection = null }) {
  const active = activeProjectData(data);
  let summary = buildSummary(active, estimate, files);
  // A ZIP pack's part selection is print-only plain text (see packRequestSpecifications).
  if (active.service === "print" && packSelection && Object.keys(packSelection).length) summary = { ...summary, specifications: { ...summary.specifications, ...packSelection } };
  if (active.service !== "print" || !customization) return summary;
  return { ...summary, customization: { generatorId: customization.generatorId, generatorVersion: customization.generatorVersion, params: { ...customization.params } } };
}

/** Provenance from a customizer hand-off record (params are already redacted by the customizer). */
export function customizationFromHandoff(record) {
  if (!record) return null;
  return { generatorId: record.generatorId, generatorVersion: record.generatorVersion, params: isPlainObject(record.params) ? { ...record.params } : {} };
}

/** Generated project text for empty fields when a customizer model arrives. */
export function handoffPrefill(record) {
  const name = `Custom ${String(record.generatorTitle || record.generatorId)}`.slice(0, 100);
  return { projectTitle: name, description: `${name} — see attached model.` };
}

export function readProjectForm(form, { FormDataImpl = FormData, terms = form.querySelector?.("#terms") } = {}) {
  const data = Object.fromEntries(new FormDataImpl(form).entries());
  data.terms = Boolean(terms?.checked);
  return data;
}
