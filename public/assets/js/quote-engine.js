import { SITE_CONFIG, SERVICE_LABELS } from "./config.js";

const money = new Intl.NumberFormat(SITE_CONFIG.defaults.locale, {
  style: "currency",
  currency: SITE_CONFIG.defaults.currency,
  maximumFractionDigits: 0
});
const n = (value, fallback = 0) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? fallback : Number(value);
const range = (low, high, confidence = "rough", breakdown = {}) => ({
  low: Math.max(0, Math.round(low)),
  high: Math.max(Math.max(0, Math.round(low)), Math.round(high)),
  confidence,
  breakdown
});

function quantityMultiplier(quantity) {
  return SITE_CONFIG.pricing.print.quantityDiscount.find(tier => quantity >= tier.min)?.multiplier ?? 1;
}

function printEstimate(data) {
  const p = SITE_CONFIG.pricing.print;
  const quantity = Math.max(1, n(data.quantity, 1));
  const fallback = p.sizeFallback[data.sizeClass] ?? p.sizeFallback.palm;
  const grams = Math.max(1, n(data.grams, fallback.grams));
  const hours = Math.max(0.25, n(data.machineHours, fallback.hours));
  const materialRate = p.materialPerGram[data.material] ?? p.materialPerGram.other;
  const quality = p.qualityMultiplier[data.quality] ?? 1;
  const colors = Math.min(4, Math.max(1, n(data.colors, 1)));
  const finish = p.finishAdd[data.finish] ?? 0;
  const unit = (grams * materialRate) + (hours * p.machineHour * quality);
  const production = unit * quantity * quantityMultiplier(quantity);
  const setup = p.setup + (p.colorsAdd[colors] ?? p.colorsAdd[4]);
  const delivery = SITE_CONFIG.pricing.delivery[data.delivery] ?? 0;
  const subtotal = Math.max(p.minimum, setup + production + finish + delivery);
  const exactInputs = Boolean(data.grams && data.machineHours);
  const spread = exactInputs ? 0.14 : 0.28;
  return range(Math.max(p.minimum, subtotal * (1 - spread)), subtotal * (1 + spread), exactInputs ? "better" : "rough", {
    service: SERVICE_LABELS.print,
    material: String(data.material || "PLA").toUpperCase(),
    quantity: String(quantity),
    assumption: exactInputs ? `${grams} g · ${hours} machine hr` : `${data.sizeClass || "palm"} size assumption`,
    delivery: data.delivery || "pickup"
  });
}

function designEstimate(data) {
  const p = SITE_CONFIG.pricing.design;
  const hours = p.complexityHours[data.complexity] ?? p.complexityHours.fitted;
  const sourceMultiplier = p.sourceMultiplier[data.sourceQuality] ?? 1;
  const deliverable = p.deliverableAdd[data.deliverable] ?? 0;
  const printAdd = data.includePrint === "yes" ? 25 : 0;
  return range(hours[0] * p.hourly * sourceMultiplier + deliverable + printAdd, hours[1] * p.hourly * sourceMultiplier + deliverable + printAdd, "rough", {
    service: SERVICE_LABELS.design,
    complexity: data.complexity || "fitted part",
    source: data.sourceQuality || "dimensions",
    deliverable: data.deliverable || "STEP + STL",
    printing: data.includePrint === "yes" ? "Included for review" : "Not included"
  });
}

function repairEstimate(data) {
  const p = SITE_CONFIG.pricing.repair;
  const selected = p[data.repairType] ?? p.diagnostic;
  const travel = data.delivery === "local" ? SITE_CONFIG.pricing.delivery.local : 0;
  return range(selected[0] + travel, selected[1] + travel, "rough", {
    service: SERVICE_LABELS.repair,
    work: data.repairType || "diagnostic",
    printer: data.printerModel || "Details needed",
    parts: "Not included",
    handoff: data.delivery || "pickup/drop-off"
  });
}

function consultEstimate(data) {
  const p = SITE_CONFIG.pricing.consult;
  const selected = p[data.consultType] ?? p.hour;
  return range(selected[0], selected[1], data.consultType === "printerDesign" ? "rough" : "better", {
    service: SERVICE_LABELS.consult,
    engagement: data.consultType || "one-hour session",
    format: data.meetingFormat || "video/phone",
    outcome: data.consultOutcome || "Project plan and recommendations"
  });
}

export function calculateEstimate(data) {
  switch (data.service) {
    case "design": return designEstimate(data);
    case "repair": return repairEstimate(data);
    case "consult": return consultEstimate(data);
    default: return printEstimate(data);
  }
}

export function formatEstimate(estimate) {
  return estimate.low === estimate.high ? money.format(estimate.low) : `${money.format(estimate.low)}–${money.format(estimate.high)}`;
}

export function buildRequestSummary(data, estimate, files = []) {
  return {
    projectTitle: data.projectTitle?.trim(),
    service: data.service,
    serviceLabel: SERVICE_LABELS[data.service] || data.service,
    description: data.description?.trim(),
    modelUrl: data.modelUrl?.trim() || null,
    deadline: data.deadline || null,
    estimate: { ...estimate, formatted: formatEstimate(estimate), currency: SITE_CONFIG.defaults.currency },
    specifications: Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      !["name", "email", "phone", "address", "preferredContact", "description", "projectTitle", "modelUrl", "deadline", "service", "projectFiles", "terms", "website"].includes(key) && value !== "" && value != null
    )),
    contact: {
      name: data.name?.trim(),
      email: data.email?.trim(),
      phone: data.phone?.trim() || null,
      preferredContact: data.preferredContact || "email",
      address: data.delivery === "shipping" ? data.address?.trim() || null : null
    },
    files: files.map(file => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream" })),
    consent: Boolean(data.terms),
    source: "3dprint4.me",
    userAgent: navigator.userAgent,
    submittedAt: new Date().toISOString()
  };
}
