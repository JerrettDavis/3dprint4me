// Private print-estimate section of the operator job sheet. All values come from the
// authenticated work-detail response and are rendered with textContent only.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const whole = new Intl.NumberFormat("en-US");
const one = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const money = value => value == null ? "—" : usd.format(value);
const percent = value => value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
const titleCase = value => String(value ?? "").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const bytes = value => value == null ? "—" : value < 1024 * 1024 ? `${one.format(value / 1024)} KB` : `${one.format(value / 1024 / 1024)} MB`;
const when = value => value ? new Date(value).toLocaleString() : "—";

function el(name, className, text) { const node = document.createElement(name); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
function facts(rows) {
  const list = el("dl", "print-facts");
  for (const [term, value] of rows) { const row = el("div"); row.append(el("dt", "", term), el("dd", "", value)); list.append(row); }
  return list;
}
function table(caption, headers, rows) {
  const node = el("table", "print-table");
  node.append(el("caption", "", caption));
  const head = el("tr");
  for (const header of headers) { const cell = el("th", "", header); cell.scope = "col"; head.append(cell); }
  const thead = el("thead"); thead.append(head);
  const tbody = el("tbody");
  for (const row of rows) { const tr = el("tr"); row.forEach((value, index) => { const cell = el(index === 0 ? "th" : "td", "", value); if (index === 0) cell.scope = "row"; tr.append(cell); }); tbody.append(tr); }
  node.append(thead, tbody);
  return node;
}

function fileRows(assets, onDownload) {
  const list = el("ul", "print-files");
  for (const asset of assets) {
    const item = el("li", "print-file");
    const head = el("div", "print-file-head");
    head.append(el("strong", "", asset.originalName), el("span", `print-state print-state-${asset.state}`, titleCase(asset.state)));
    const g = asset.geometry;
    const meta = [asset.format.toUpperCase(), bytes(asset.sizeBytes), g ? `${g.dimensionsMm.map(value => one.format(value)).join(" × ")} mm` : null, g ? `${whole.format(g.triangleCount)} triangles` : null, g ? `${one.format(g.volumeCm3)} cm³` : null].filter(Boolean).join(" · ");
    item.append(head, el("p", "print-meta", meta));
    if (asset.analysisError) item.append(el("p", "print-error", `Analysis failed: ${asset.analysisError.code}${asset.analysisError.detail ? ` — ${asset.analysisError.detail}` : ""}`));
    if (g?.warnings?.length) item.append(el("p", "print-warning", `Warnings: ${g.warnings.map(titleCase).join(", ")}`));
    if (asset.retention?.deletedAt) item.append(el("p", "print-meta", `Deleted under retention policy ${when(asset.retention.deletedAt)}`));
    if (asset.downloadable) {
      const button = el("button", "print-download", `Download ${asset.originalName}`);
      button.type = "button";
      button.onclick = () => onDownload(asset.id);
      item.append(button, el("span", "print-meta", " Signed link expires in 60 seconds."));
    }
    list.append(item);
  }
  return list;
}

function latestSection(estimate) {
  const section = el("div", "print-latest");
  section.append(el("h4", "", "Latest estimate"));
  const basis = [titleCase(estimate.estimatorType), `${estimate.confidence} confidence`, [estimate.engine, estimate.engineVersion].filter(Boolean).join(" "), estimate.profileId, `pricing ${estimate.pricingModelVersion}`, when(estimate.createdAt)].filter(Boolean).join(" · ");
  section.append(el("p", "print-basis", basis));
  const p = estimate.pricing;
  section.append(facts([
    ["Customer range", `${money(p.range.low)}–${money(p.range.high)}`],
    ["Selected price", `${money(p.selectedPrice)} (${titleCase(p.selectedBy)})`],
    ["Market / rate card", money(p.marketPrice)],
    ["Economic floor", `${money(p.economicFloor)} at ${percent(p.requiredMinimumMargin)} minimum margin`],
    ["Internal cost", `${money(estimate.cost.total)} (${money(estimate.cost.perUnit)} per unit)`],
    ["Projected profit", `${money(p.projected.grossProfit.low)} / ${money(p.projected.grossProfit.target)} / ${money(p.projected.grossProfit.high)}`],
    ["Projected margin", `${percent(p.projected.margin.low)} / ${percent(p.projected.margin.target)} / ${percent(p.projected.margin.high)}`]
  ]));
  const c = estimate.cost; const r = c.rates ?? {};
  section.append(table("Internal cost breakdown", ["Component", "Basis", "Cost"], [
    ["Material", `${one.format(estimate.production.totalGrams ?? 0)} g × ${money(r.landedUsdPerKg)}/kg + ${percent(r.wasteRate)} waste (${titleCase(c.materialCost?.source)})`, money(c.material)],
    ["Passive machine", `${one.format(estimate.production.totalHours ?? 0)} h × ${money(r.passiveMachineUsdPerHour)}/h`, money(c.passiveMachine)],
    ["Active labor", `${c.plates} plate${c.plates === 1 ? "" : "s"} × ${r.activeHoursPerPlate} h × ${money(r.loadedLaborUsdPerActiveHour)}/h`, money(c.activeLabor)],
    ["Finishing labor", titleCase(estimate.assumptions.finish ?? "none"), money(c.finishingLabor)],
    ["Total", `${c.quantity} unit${c.quantity === 1 ? "" : "s"}`, money(c.total)]
  ]));
  const a = estimate.assumptions;
  section.append(el("p", "print-meta", `Assumptions: ${[String(a.material ?? "").toUpperCase(), a.quality, `${a.colors} color${a.colors === 1 ? "" : "s"}`, `supports ${a.supports}`, `qty ${a.quantity}`, a.delivery].filter(Boolean).join(" · ")}`));
  if (estimate.slicer) section.append(el("p", "print-meta", `Slicer: ${one.format(estimate.slicer.elapsedSeconds / 3600)} h · ${one.format(estimate.slicer.materialGrams)} g · ${estimate.slicer.layerCount ?? "—"} layers · ${estimate.slicer.toolChanges ?? 0} tool changes`));
  return section;
}

function runsSection(printEstimation, latest, onRecordRun) {
  const section = el("div", "print-runs");
  section.append(el("h4", "", "Actual production"));
  if (printEstimation.runs.length) {
    section.append(table("Estimated versus actual", ["Recorded", "Actual", "Variance", "Notes"], printEstimation.runs.map(run => [
      when(run.createdAt),
      `${run.actualGrams ?? "—"} g · ${run.actualMachineHours ?? "—"} h · ${run.activeLaborMinutes ?? "—"} min · ${run.failedAttempts} failed`,
      run.variance ? `grams ${percent(run.variance.grams)} · time ${percent(run.variance.machineHours)}` : "No linked estimate",
      run.notes ?? ""
    ])));
  } else section.append(el("p", "print-meta", "No production run recorded yet."));
  const form = el("form", "print-run-form");
  const field = (name, label, attrs = {}) => { const wrap = el("label", "", label); const input = el("input"); input.name = name; Object.assign(input, { type: "number", min: "0", step: "any", inputMode: "decimal" }, attrs); wrap.append(input); form.append(wrap); };
  field("actualGrams", "Actual grams"); field("actualMachineHours", "Machine hours"); field("activeLaborMinutes", "Labor minutes", { step: "1" }); field("failedAttempts", "Failed attempts", { step: "1", value: "0" }); field("completedQuantity", "Completed quantity", { step: "1" });
  const save = el("button", "", "Record run"); save.type = "submit"; form.append(save);
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
    onRecordRun({ ...values, ...(latest ? { estimateId: latest.id } : {}) });
  };
  section.append(form);
  return section;
}

/** Returns the print section for a job sheet, or null when the request has no print estimate data. */
export function renderPrintEstimation(printEstimation, { onDownload, onRecordRun }) {
  if (!printEstimation) return null;
  const section = el("section", "print-sheet");
  section.setAttribute("aria-labelledby", "print-sheet-title");
  const heading = el("h3", "", "Print estimate"); heading.id = "print-sheet-title";
  section.append(heading);
  if (!printEstimation.available) { section.append(el("p", "print-meta", "Print estimate data is unavailable right now. The request itself is intact.")); return section; }
  if (!printEstimation.assets.length && !printEstimation.latestEstimate) { section.append(el("p", "print-meta", "No private model or estimate snapshot is attached to this request.")); return section; }
  if (printEstimation.assets.length) { section.append(el("h4", "", "Source files"), fileRows(printEstimation.assets, onDownload)); }
  if (printEstimation.latestEstimate) section.append(latestSection(printEstimation.latestEstimate));
  if (printEstimation.jobs.length) {
    const jobs = el("div", "print-jobs"); jobs.append(el("h4", "", "Slicer analysis"));
    jobs.append(table("Analysis jobs", ["Job", "State", "Attempts", "Last error", "Next attempt"], printEstimation.jobs.map(job => [`${titleCase(job.jobType)} · ${job.profileKey}`, titleCase(job.state), `${job.attemptCount}/${job.maxAttempts}`, job.lastErrorCategory ? titleCase(job.lastErrorCategory) : "—", job.state === "pending" ? when(job.nextAttemptAt) : "—"])));
    section.append(jobs);
  }
  if (printEstimation.estimates.length) {
    const history = el("div", "print-history"); history.append(el("h4", "", "Estimate history"));
    history.append(table("Estimate snapshots, newest first", ["Created", "Type", "Range", "Internal cost", "Target margin"], printEstimation.estimates.map(row => [when(row.createdAt), `${titleCase(row.estimatorType)} · ${row.purpose}`, `${money(row.low)}–${money(row.high)}`, money(row.costTotal), percent(row.targetMargin)])));
    section.append(history);
  }
  section.append(runsSection(printEstimation, printEstimation.latestEstimate, onRecordRun));
  return section;
}
