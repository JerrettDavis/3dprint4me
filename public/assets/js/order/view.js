import { formatBytes } from "./files.js?v=6dfa37e669b62115";

export function createOrderView({ document, window, form, formatEstimate }) {
  const elements = {
    steps: [...document.querySelectorAll(".form-step")],
    progressBar: document.querySelector("#progress-bar"),
    progressLabels: [...document.querySelectorAll(".progress-labels span")],
    backButton: document.querySelector("#back-button"),
    nextButton: document.querySelector("#next-button"),
    submitButton: document.querySelector("#submit-button"),
    formActions: document.querySelector("#form-actions"),
    submissionState: document.querySelector("#submission-state"),
    fileInput: document.querySelector("#project-files"),
    fileList: document.querySelector("#file-list"),
    uploadZone: document.querySelector("#upload-zone"),
    depositButton: document.querySelector("#deposit-button")
  };

  function updateConditionalFields(data) {
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

  function renderEstimate(estimate) {
    document.querySelector("#estimate-amount").textContent = formatEstimate(estimate);
    document.querySelector("#estimate-confidence").textContent = estimate.confidence === "better" ? "Better estimate from the details provided" : "Planning range, confirmed after review";
    document.querySelector("#estimate-list").replaceChildren(...Object.entries(estimate.breakdown).map(([key, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase());
      dd.textContent = value;
      row.append(dt, dd);
      return row;
    }));
  }

  function renderReview(summary, data, files) {
    const rows = [
      ["Project", summary.projectTitle], ["Service", summary.serviceLabel], ["Estimate", summary.estimate.formatted],
      ["Contact", `${summary.contact.name} · ${summary.contact.email}`], ["Handoff", data.delivery || "pickup"],
      ["Files", files.length ? files.map(file => file.name).join(", ") : "Link or details only"], ["Description", summary.description]
    ];
    document.querySelector("#review-card").replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "review-row";
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value || "Not provided";
      row.append(term, detail);
      return row;
    }));
  }

  return {
    elements,
    updateConditionalFields,
    renderEstimate,
    renderFiles(files) {
      elements.fileList.replaceChildren(...files.map((file, index) => {
        const row = document.createElement("div");
        row.className = "file-item";
        const name = document.createElement("span");
        name.className = "file-item-name";
        name.textContent = file.name;
        const size = document.createElement("span");
        size.className = "file-item-size";
        size.textContent = formatBytes(file.size);
        const remove = document.createElement("button");
        remove.className = "file-remove";
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.dataset.fileIndex = String(index);
        remove.textContent = "Remove";
        row.append(name, size, remove);
        return row;
      }));
    },
    showStep(index, { focus = true, review } = {}) {
      elements.steps.forEach((step, position) => { step.classList.toggle("active", position === index); step.setAttribute("aria-hidden", String(position !== index)); });
      elements.progressBar.style.width = `${((index + 1) / elements.steps.length) * 100}%`;
      elements.progressBar.setAttribute("aria-valuenow", String(index + 1));
      elements.progressLabels.forEach((label, position) => label.classList.toggle("active", position === index));
      elements.backButton.hidden = index === 0;
      elements.nextButton.hidden = index === elements.steps.length - 1;
      elements.submitButton.hidden = index !== elements.steps.length - 1;
      if (index === elements.steps.length - 1) review?.();
      if (focus) elements.steps[index].querySelector("h2")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    renderReview,
    fieldError(field, message, errorId = null) {
      field.setAttribute("aria-invalid", "true");
      const error = document.querySelector(errorId || `#${CSS.escape(field.id)}-error`);
      if (error) error.textContent = message;
    },
    clearErrors() {
      form.querySelectorAll("[aria-invalid='true']").forEach(field => field.removeAttribute("aria-invalid"));
      form.querySelectorAll(".error").forEach(error => { error.textContent = ""; });
    },
    submitting(label) { elements.submitButton.disabled = true; elements.submitButton.textContent = label; },
    uploadProgress(current, total) { elements.submitButton.textContent = `Uploading ${current}/${total}…`; },
    submissionError(error) { elements.submitButton.disabled = false; elements.submitButton.textContent = "Submit project request"; return error; },
    showSubmission(request, savedLocally, mailto) {
      document.querySelector("#draft-storage-note").hidden = true;
      elements.steps.forEach(step => { step.classList.remove("active"); step.setAttribute("aria-hidden", "true"); });
      elements.formActions.hidden = true;
      elements.submissionState.classList.add("visible");
      document.querySelector("#confirmation-title").textContent = request.backend.live ? "Your project request is in." : "Your request is ready.";
      document.querySelector("#request-id").textContent = request.id;
      document.querySelector("#confirmation-copy").textContent = request.backend.live
        ? request.uploadedFiles.some(file => !file.path)
          ? "I’ll review the details and respond with a confirmed price, material choice, and schedule. Your selected files were not uploaded; use Email this request and attach them with your request ID."
          : "I’ll review the details and respond with a confirmed price, material choice, and schedule."
        : savedLocally
          ? "Your request was saved in this browser but not delivered to us. Please use Email this request, or download a copy and send it to us."
          : "Your request was not saved in this browser or delivered to us. Use Email this request or Download a copy now before leaving this page.";
      document.querySelector("#backend-note").hidden = request.backend.live;
      if (!request.backend.live || !request.backend.checkoutToken) elements.depositButton.hidden = true;
      document.querySelector("#email-request").href = mailto;
      elements.submissionState.querySelector("h2")?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    showDraftStorageWarning() { document.querySelector("#draft-storage-note").hidden = false; },
    setDepositVisible(visible) { elements.depositButton.hidden = !visible; }
  };
}
