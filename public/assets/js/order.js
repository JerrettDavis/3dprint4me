import "./site.js?v=72c3aa9ae76ea28e";
import { SITE_CONFIG, SERVICE_LABELS } from "./config.js?v=72c3aa9ae76ea28e";
import { buildRequestSummary, calculateEstimate, formatEstimate } from "./quote-engine.js?v=72c3aa9ae76ea28e";
import { toast } from "./site.js?v=72c3aa9ae76ea28e";

const form = document.querySelector("#project-form");
const steps = [...document.querySelectorAll(".form-step")];
const progressBar = document.querySelector("#progress-bar");
const progressLabels = [...document.querySelectorAll(".progress-labels span")];
const backButton = document.querySelector("#back-button");
const nextButton = document.querySelector("#next-button");
const submitButton = document.querySelector("#submit-button");
const formActions = document.querySelector("#form-actions");
const submissionState = document.querySelector("#submission-state");
const fileInput = document.querySelector("#project-files");
const fileList = document.querySelector("#file-list");
const uploadZone = document.querySelector("#upload-zone");
const estimateAmount = document.querySelector("#estimate-amount");
const estimateConfidence = document.querySelector("#estimate-confidence");
const estimateList = document.querySelector("#estimate-list");
const draftKey = "3dp-project-draft-v1";
const currentSearch = () => window.__THREEDP_TEST_SEARCH || location.search;

let currentStep = 0;
let selectedFiles = [];
let latestEstimate = calculateEstimate({ service: "print" });
let completedRequest = null;

const formatBytes = bytes => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function formDataObject() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.terms = document.querySelector("#terms")?.checked || false;
  return data;
}

function saveDraft() {
  const data = formDataObject();
  delete data.terms;
  delete data.website;
  try { localStorage.setItem(draftKey, JSON.stringify(data)); }
  catch { document.querySelector("#draft-storage-note").hidden = false; }
}

function restoreDraft() {
  const params = new URLSearchParams(currentSearch());
  const requestedService = params.get("service");
  let data = {};
  try { data = JSON.parse(localStorage.getItem(draftKey) || "{}"); } catch { data = {}; }
  if (requestedService && SERVICE_LABELS[requestedService]) data.service = requestedService;
  Object.entries(data).forEach(([name, value]) => {
    const fields = [...form.elements].filter(field => field.name === name);
    fields.forEach(field => {
      if (field.type === "radio") field.checked = field.value === String(value);
      else if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value;
    });
  });
}

function updateConditionalFields() {
  const data = formDataObject();
  const service = data.service || "print";
  document.querySelectorAll("[data-service-panel]").forEach(panel => {
    const visible = panel.dataset.servicePanel === service;
    panel.classList.toggle("visible", visible);
    panel.setAttribute("aria-hidden", String(!visible));
    panel.querySelectorAll("input, select, textarea").forEach(field => { field.disabled = !visible; });
  });
  document.querySelectorAll("[data-delivery-panel]").forEach(panel => {
    const visible = panel.dataset.deliveryPanel === (data.delivery || "pickup");
    panel.classList.toggle("visible", visible);
    panel.setAttribute("aria-hidden", String(!visible));
    panel.querySelectorAll("input, select, textarea").forEach(field => { field.disabled = !visible; });
  });
}

function updateEstimate() {
  latestEstimate = calculateEstimate(formDataObject());
  estimateAmount.textContent = formatEstimate(latestEstimate);
  estimateConfidence.textContent = latestEstimate.confidence === "better" ? "Better estimate from the details provided" : "Planning range, confirmed after review";
  estimateList.replaceChildren(...Object.entries(latestEstimate.breakdown).map(([key, value]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
}

function showStep(index, focus = true) {
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  steps.forEach((step, i) => {
    step.classList.toggle("active", i === currentStep);
    step.setAttribute("aria-hidden", String(i !== currentStep));
  });
  progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
  progressBar.setAttribute("aria-valuenow", String(currentStep + 1));
  progressLabels.forEach((label, i) => label.classList.toggle("active", i === currentStep));
  backButton.hidden = currentStep === 0;
  nextButton.hidden = currentStep === steps.length - 1;
  submitButton.hidden = currentStep !== steps.length - 1;
  if (currentStep === steps.length - 1) renderReview();
  if (focus) steps[currentStep].querySelector("h2")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function fieldError(field, message, errorId = null) {
  field.setAttribute("aria-invalid", "true");
  const error = document.querySelector(errorId || `#${CSS.escape(field.id)}-error`);
  if (error) error.textContent = message;
}

function clearErrors() {
  form.querySelectorAll("[aria-invalid='true']").forEach(field => field.removeAttribute("aria-invalid"));
  form.querySelectorAll(".error").forEach(error => { error.textContent = ""; });
}

function validateStep(index) {
  clearErrors();
  const data = formDataObject();
  const invalid = [];
  const require = (id, message) => {
    const field = document.querySelector(`#${id}`);
    if (!field || field.disabled || String(field.value || "").trim()) return;
    fieldError(field, message);
    invalid.push(field);
  };

  if (index === 0 && !data.service) {
    const field = document.querySelector("input[name='service']");
    fieldError(field, "Choose a service to continue.", "#service-error");
    invalid.push(field);
  }
  if (index === 1) {
    require("project-title", "Give the project a short name.");
    require("description", "Describe what you need and how it will be used.");
    if (data.service === "print" && selectedFiles.length === 0 && !String(data.modelUrl || "").trim()) {
      const field = document.querySelector("#model-url");
      fieldError(field, "Add a model file or a link so the part can be reviewed.");
      invalid.push(field);
    }
    if (data.service === "repair") require("printer-model", "Add the printer make and model.");
    const modelUrl = document.querySelector("#model-url");
    if (modelUrl.value && !modelUrl.checkValidity()) {
      fieldError(modelUrl, "Enter a complete web address, including https://.");
      invalid.push(modelUrl);
    }
  }
  if (index === 2) {
    require("name", "Add your name.");
    require("email", "Add an email address.");
    const email = document.querySelector("#email");
    if (email.value && !email.checkValidity()) {
      fieldError(email, "Enter a valid email address.");
      invalid.push(email);
    }
    if (data.delivery === "shipping") require("address", "Add the shipping destination.");
    if (["text", "call"].includes(data.preferredContact) && !String(data.phone || "").trim()) {
      const phone = document.querySelector("#phone");
      fieldError(phone, `Add a phone number for ${data.preferredContact === "text" ? "text replies" : "phone calls"}.`);
      invalid.push(phone);
    }
  }
  if (index === 3 && !document.querySelector("#terms").checked) {
    const field = document.querySelector("#terms");
    fieldError(field, "Please confirm the estimate and project terms.");
    invalid.push(field);
  }
  if (invalid.length) {
    invalid[0].focus();
    toast("Please check the highlighted field.");
    return false;
  }
  return true;
}

function renderReview() {
  const data = formDataObject();
  const summary = buildRequestSummary(data, latestEstimate, selectedFiles);
  const rows = [
    ["Project", summary.projectTitle],
    ["Service", summary.serviceLabel],
    ["Estimate", summary.estimate.formatted],
    ["Contact", `${summary.contact.name} · ${summary.contact.email}`],
    ["Handoff", data.delivery || "pickup"],
    ["Files", selectedFiles.length ? selectedFiles.map(file => file.name).join(", ") : "Link or details only"],
    ["Description", summary.description]
  ];
  document.querySelector("#review-card").innerHTML = rows.map(([label, value]) => `<div class="review-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Not provided")}</dd></div>`).join("");
}

function addFiles(fileCollection) {
  const allowed = [".stl", ".3mf", ".step", ".stp", ".obj", ".f3d", ".zip", ".jpg", ".jpeg", ".png", ".webp", ".pdf", ".txt"];
  for (const file of [...fileCollection]) {
    const extension = `.${file.name.split(".").pop().toLowerCase()}`;
    if (!allowed.includes(extension)) { toast(`${file.name}: unsupported file type.`); continue; }
    if (file.size > SITE_CONFIG.maxUploadBytes) { toast(`${file.name}: larger than ${formatBytes(SITE_CONFIG.maxUploadBytes)}.`); continue; }
    if (selectedFiles.some(existing => existing.name === file.name && existing.size === file.size)) continue;
    if (selectedFiles.length >= SITE_CONFIG.maxFiles) { toast(`Up to ${SITE_CONFIG.maxFiles} files can be attached.`); break; }
    selectedFiles.push(file);
  }
  renderFiles();
  updateEstimate();
  saveDraft();
}

function renderFiles() {
  fileList.replaceChildren(...selectedFiles.map((file, index) => {
    const row = document.createElement("div");
    row.className = "file-item";
    row.innerHTML = `<span class="file-item-name">${escapeHtml(file.name)}</span><span class="file-item-size">${formatBytes(file.size)}</span><button class="file-remove" type="button" aria-label="Remove ${escapeHtml(file.name)}" data-file-index="${index}">Remove</button>`;
    return row;
  }));
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function uploadFiles(requestId, backendMode = "local") {
  if (backendMode !== "supabase") {
    return selectedFiles.map(file => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream", path: null, mode: "metadata" }));
  }
  const uploaded = [];
  for (let index = 0; index < selectedFiles.length; index++) {
    const file = selectedFiles[index];
    submitButton.textContent = `Uploading ${index + 1}/${selectedFiles.length}…`;
    const instruction = await jsonFetch("/api/upload-url", { method: "POST", body: JSON.stringify({ requestId, filename: file.name, contentType: file.type, size: file.size }) });
    if (!instruction.uploadUrl) throw new Error(`No upload destination was created for ${file.name}.`);
      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "3600");
      uploadBody.append("", file);
      const response = await fetch(instruction.uploadUrl, { method: instruction.method || "PUT", headers: { ...(instruction.headers || {}) }, body: instruction.bodyType === "file" ? file : uploadBody });
    if (!response.ok) throw new Error(`Could not upload ${file.name}.`);
    uploaded.push({ name: file.name, size: file.size, type: file.type, path: instruction.path || null, mode: "signed" });
  }
  return uploaded;
}

function saveLocalCopy(request) {
  let drafts = [];
  try { drafts = JSON.parse(localStorage.getItem("3dp-submitted-requests") || "[]"); } catch { drafts = []; }
  drafts.unshift(request);
  try {
    localStorage.setItem("3dp-submitted-requests", JSON.stringify(drafts.slice(0, 10)));
    return true;
  } catch { return false; }
}

async function submitProject(event) {
  event.preventDefault();
  if (!validateStep(3)) return;
  const data = formDataObject();
  const request = buildRequestSummary(data, latestEstimate, selectedFiles);
  submitButton.disabled = true;
  submitButton.textContent = "Creating request…";
  try {
    let created;
    try {
      created = await jsonFetch("/api/request", { method: "POST", body: JSON.stringify({ action: "create", request, website: data.website || "" }) });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
      console.warn("Backend unavailable; preserving a local request copy.", error);
      created = { id: `LOCAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, mode: "local", live: false, offlineFallback: true };
    }
    const uploadedFiles = await uploadFiles(created.id, created.mode);
    let completed;
    if (created.mode === "ignored") {
      completed = { id: created.id, mode: "ignored", live: true };
    } else if (created.offlineFallback) {
      completed = { id: created.id, mode: "local", live: false };
    } else {
      try {
        completed = await jsonFetch("/api/request", { method: "PATCH", body: JSON.stringify({ action: "complete", id: created.id, request, uploadedFiles }) });
      } catch (error) {
        if (error.status >= 400 && error.status < 500) throw error;
        console.warn("Could not complete remote delivery; preserving locally.", error);
        completed = { id: created.id, mode: created.mode || "local", live: false, warning: error.message };
      }
    }
    completedRequest = { ...request, id: created.id, uploadedFiles, backend: completed };
    const savedLocally = saveLocalCopy(completedRequest);
    try { localStorage.removeItem(draftKey); } catch { /* Browser storage can be unavailable. */ }
    showSubmission(completedRequest, savedLocally);
  } catch (error) {
    if (!(error.status >= 400 && error.status < 500)) console.error(error);
    toast(error.message || "The request could not be submitted.");
    submitButton.disabled = false;
    submitButton.textContent = "Submit project request";
  }
}

function showSubmission(request, savedLocally) {
  document.querySelector("#draft-storage-note").hidden = true;
  steps.forEach(step => { step.classList.remove("active"); step.setAttribute("aria-hidden", "true"); });
  formActions.hidden = true;
  submissionState.classList.add("visible");
  document.querySelector("#confirmation-title").textContent = request.backend.live ? "Your project request is in." : "Your request is ready.";
  document.querySelector("#request-id").textContent = request.id;
  document.querySelector("#confirmation-copy").textContent = request.backend.live
    ? request.uploadedFiles.some(file => !file.path)
      ? "I’ll review the details and respond with a confirmed price, material choice, and schedule. Your selected files were not uploaded; use Email this request and attach them with your request ID."
      : "I’ll review the details and respond with a confirmed price, material choice, and schedule."
    : savedLocally
      ? "Your request was saved in this browser but not delivered to us. Please use Email this request, or download a copy and send it to us."
      : "Your request was not saved in this browser or delivered to us. Use Email this request or Download a copy now before leaving this page.";
  const backendNote = document.querySelector("#backend-note");
  backendNote.hidden = request.backend.live;
  if (!request.backend.live || !request.backend.checkoutToken) document.querySelector("#deposit-button").hidden = true;
  document.querySelector("#email-request").href = mailtoFor(request);
  submissionState.querySelector("h2")?.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function mailtoFor(request) {
  const subject = encodeURIComponent(`[${request.id}] ${request.projectTitle} — ${request.serviceLabel}`);
  const body = encodeURIComponent([
    `Project: ${request.projectTitle}`,
    `Service: ${request.serviceLabel}`,
    `Rough estimate: ${request.estimate.formatted}`,
    `Name: ${request.contact.name}`,
    `Email: ${request.contact.email}`,
    `Phone: ${request.contact.phone || "Not provided"}`,
    "",
    request.description,
    "",
    request.modelUrl ? `Model link: ${request.modelUrl}` : "",
    request.files.length ? `Files selected: ${request.files.map(file => file.name).join(", ")} (attach them if they were not uploaded)` : ""
  ].filter(Boolean).join("\n"));
  return `mailto:${SITE_CONFIG.email}?subject=${subject}&body=${body}`;
}

function downloadRequest() {
  if (!completedRequest) return;
  const blob = new Blob([JSON.stringify(completedRequest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${completedRequest.id}-3dprint4me-request.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function startDepositCheckout() {
  if (!completedRequest?.backend.live || !completedRequest.backend.checkoutToken) return;
  const button = document.querySelector("#deposit-button");
  button.disabled = true;
  button.textContent = "Opening checkout…";
  try {
    const payload = await jsonFetch("/api/checkout", { method: "POST", body: JSON.stringify({ requestId: completedRequest.id, projectTitle: completedRequest.projectTitle, email: completedRequest.contact.email, checkoutToken: completedRequest.backend.checkoutToken }) });
    if (payload.url) location.href = payload.url;
    else throw new Error(payload.error || "Checkout is not configured.");
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = "Pay optional $25 deposit";
  }
}

async function refreshIntegrationState() {
  const deposit = document.querySelector("#deposit-button");
  try {
    const health = await jsonFetch("/api/health");
    deposit.hidden = !health.integrations?.stripe || (completedRequest && (!completedRequest.backend.live || !completedRequest.backend.checkoutToken));
  } catch {
    deposit.hidden = true;
  }
}

restoreDraft();
document.querySelector("#deadline").min = new Date().toISOString().slice(0, 10);
updateConditionalFields();
updateEstimate();
showStep(0, false);
refreshIntegrationState();

form.addEventListener("input", () => { updateConditionalFields(); updateEstimate(); saveDraft(); });
form.addEventListener("change", () => { updateConditionalFields(); updateEstimate(); saveDraft(); });
form.addEventListener("submit", submitProject);
nextButton.addEventListener("click", () => { if (validateStep(currentStep)) showStep(currentStep + 1); });
backButton.addEventListener("click", () => showStep(currentStep - 1));
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
fileList.addEventListener("click", event => { const button = event.target.closest("[data-file-index]"); if (!button) return; selectedFiles.splice(Number(button.dataset.fileIndex), 1); renderFiles(); updateEstimate(); });
["dragenter", "dragover"].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(type => uploadZone.addEventListener(type, event => { event.preventDefault(); uploadZone.classList.remove("dragover"); }));
uploadZone.addEventListener("drop", event => addFiles(event.dataTransfer.files));
document.querySelector("#download-request").addEventListener("click", downloadRequest);
document.querySelector("#deposit-button").addEventListener("click", startDepositCheckout);

const paymentState = new URLSearchParams(currentSearch()).get("payment");
if (paymentState === "success") toast("Checkout returned to this site. Check your Stripe receipt to confirm payment; I’ll verify the deposit separately.", 7000);
if (paymentState === "cancelled") toast("Checkout was cancelled. Your project request is still saved.", 7000);
