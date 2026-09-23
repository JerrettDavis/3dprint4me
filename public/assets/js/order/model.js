const COMMON_FIELDS = new Set([
  "service", "projectTitle", "description", "modelUrl", "deadline", "delivery",
  "contactNotes", "name", "email", "phone", "preferredContact", "address",
  "projectFiles", "terms", "website"
]);
const SERVICE_FIELDS = Object.freeze({
  print: new Set(["material", "quality", "colors", "finish", "quantity", "sizeClass", "grams", "machineHours"]),
  design: new Set(["complexity", "sourceQuality", "deliverable", "includePrint"]),
  repair: new Set(["printerModel", "repairType", "recentChange"]),
  consult: new Set(["consultType", "meetingFormat", "consultOutcome"])
});

export function activeProjectData(data) {
  const allowed = SERVICE_FIELDS[data?.service] ?? new Set();
  return Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => COMMON_FIELDS.has(key) || allowed.has(key)));
}

export function projectRequestFromData({ data, estimate, files, buildSummary }) {
  return buildSummary(activeProjectData(data), estimate, files);
}

export function readProjectForm(form, { FormDataImpl = FormData, terms = form.querySelector?.("#terms") } = {}) {
  const data = Object.fromEntries(new FormDataImpl(form).entries());
  data.terms = Boolean(terms?.checked);
  return data;
}
