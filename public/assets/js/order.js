import "./site.js?v=6dfa37e669b62115";
import { SITE_CONFIG, SERVICE_LABELS } from "./config.js?v=6dfa37e669b62115";
import { buildRequestSummary, calculateEstimate, formatEstimate } from "./quote-engine.js?v=6dfa37e669b62115";
import { toast } from "./site.js?v=6dfa37e669b62115";
import { createProjectRequestClient } from "./order/client.js?v=6dfa37e669b62115";
import { createOrderController } from "./order/controller.js?v=6dfa37e669b62115";
import { createDraftStore } from "./order/draft-store.js?v=6dfa37e669b62115";
import { createFileManager } from "./order/files.js?v=6dfa37e669b62115";
import { activeProjectData, projectRequestFromData, readProjectForm } from "./order/model.js?v=6dfa37e669b62115";
import { createStepValidator } from "./order/validation.js?v=6dfa37e669b62115";
import { createOrderView } from "./order/view.js?v=6dfa37e669b62115";

const form = document.querySelector("#project-form");
const currentSearch = () => window.__THREEDP_TEST_SEARCH || location.search;
const client = createProjectRequestClient();
const draftStore = createDraftStore({ storage: () => localStorage, draftKey: "3dp-project-draft-v1", submittedKey: "3dp-submitted-requests" });
const view = createOrderView({ document, window, form, formatEstimate });
let currentStep = 0;
let latestEstimate = calculateEstimate({ service: "print" });

const getData = () => readProjectForm(form, { terms: document.querySelector("#terms") });

function saveDraft() {
  if (!draftStore.saveDraft(getData())) view.showDraftStorageWarning();
}

function updateEstimate() {
  latestEstimate = calculateEstimate(activeProjectData(getData()));
  view.renderEstimate(latestEstimate);
}

const files = createFileManager({
  config: SITE_CONFIG,
  client,
  notify: toast,
  render: selected => view.renderFiles(selected),
  onChange: () => { updateEstimate(); saveDraft(); }
});

const buildRequest = () => projectRequestFromData({ data: getData(), estimate: latestEstimate, files: files.list(), buildSummary: buildRequestSummary });

const validateStep = createStepValidator({
  document,
  form,
  getData,
  getFiles: files.list,
  fieldError: view.fieldError,
  clearErrors: view.clearErrors,
  notify: toast
});

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

const controller = createOrderController({
  getData,
  buildRequest,
  validateFinalStep: () => validateStep(3),
  client,
  files,
  draftStore,
  view: {
    submitting: view.submitting,
    uploadProgress: view.uploadProgress,
    showSubmission(request, stored) { view.showSubmission(request, stored, mailtoFor(request)); },
    submissionError(error) {
      view.submissionError(error);
      if (error.kind !== "correctable") console.error(error);
      toast(error.message || "The request could not be submitted.");
    }
  },
  newLocalId: () => `LOCAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
});

function renderReview() { view.renderReview(buildRequest(), getData(), files.list()); }
function showStep(index, focus = true) {
  currentStep = Math.max(0, Math.min(view.elements.steps.length - 1, index));
  view.showStep(currentStep, { focus, review: renderReview });
}

function restoreDraft() {
  const data = draftStore.loadDraft();
  const requestedService = new URLSearchParams(currentSearch()).get("service");
  if (requestedService && SERVICE_LABELS[requestedService]) data.service = requestedService;
  Object.entries(data).forEach(([name, value]) => {
    [...form.elements].filter(field => field.name === name).forEach(field => {
      if (field.type === "radio") field.checked = field.value === String(value);
      else if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value;
    });
  });
}

function updateFormState() { view.updateConditionalFields(getData()); updateEstimate(); saveDraft(); }

function downloadRequest() {
  const request = controller.completedRequest();
  if (!request) return;
  const blob = new Blob([JSON.stringify(request, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${request.id}-3dprint4me-request.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function startDepositCheckout() {
  const request = controller.completedRequest();
  if (!request?.backend.live || !request.backend.checkoutToken) return;
  view.elements.depositButton.disabled = true;
  view.elements.depositButton.textContent = "Opening checkout…";
  try {
    const payload = await client.checkout({ requestId: request.id, projectTitle: request.projectTitle, email: request.contact.email, checkoutToken: request.backend.checkoutToken });
    if (payload.url) location.href = payload.url;
    else throw new Error(payload.error || "Checkout is not configured.");
  } catch (error) {
    toast(error.message);
    view.elements.depositButton.disabled = false;
    view.elements.depositButton.textContent = "Pay optional $25 deposit";
  }
}

async function refreshIntegrationState() {
  try {
    const health = await client.health();
    const request = controller.completedRequest();
    view.setDepositVisible(Boolean(health.integrations?.stripe) && !(request && (!request.backend.live || !request.backend.checkoutToken)));
  } catch { view.setDepositVisible(false); }
}

restoreDraft();
document.querySelector("#deadline").min = new Date().toISOString().slice(0, 10);
view.updateConditionalFields(getData());
updateEstimate();
showStep(0, false);
refreshIntegrationState();

form.addEventListener("input", updateFormState);
form.addEventListener("change", updateFormState);
form.addEventListener("submit", controller.submit);
view.elements.nextButton.addEventListener("click", () => { if (validateStep(currentStep)) showStep(currentStep + 1); });
view.elements.backButton.addEventListener("click", () => showStep(currentStep - 1));
view.elements.fileInput.addEventListener("change", () => { files.add(view.elements.fileInput.files); view.elements.fileInput.value = ""; });
view.elements.fileList.addEventListener("click", event => { const button = event.target.closest("[data-file-index]"); if (button) files.remove(Number(button.dataset.fileIndex)); });
["dragenter", "dragover"].forEach(type => view.elements.uploadZone.addEventListener(type, event => { event.preventDefault(); view.elements.uploadZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(type => view.elements.uploadZone.addEventListener(type, event => { event.preventDefault(); view.elements.uploadZone.classList.remove("dragover"); }));
view.elements.uploadZone.addEventListener("drop", event => files.add(event.dataTransfer.files));
document.querySelector("#download-request").addEventListener("click", downloadRequest);
view.elements.depositButton.addEventListener("click", startDepositCheckout);

const paymentState = new URLSearchParams(currentSearch()).get("payment");
if (paymentState === "success") toast("Checkout returned to this site. Check your Stripe receipt to confirm payment; I’ll verify the deposit separately.", 7000);
if (paymentState === "cancelled") toast("Checkout was cancelled. Your project request is still saved.", 7000);
