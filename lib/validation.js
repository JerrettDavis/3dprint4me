import { cleanOptionalString, cleanString, cleanUrl, HttpError, isValidEmail, safeNumber } from "./http.js";

export const SERVICES = new Set(["print", "design", "repair", "consult"]);
export const ALLOWED_EXTENSIONS = new Set(["stl", "3mf", "step", "stp", "obj", "f3d", "zip", "jpg", "jpeg", "png", "webp", "pdf", "txt"]);

function cleanSpecifications(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).slice(0, 60).map(([key, value]) => [cleanString(key, 80), typeof value === "boolean" ? value : cleanString(value, 500)]).filter(([key]) => key));
}

function cleanFileMetadata(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map(file => ({ name: sanitizeFilename(file?.name), size: Math.round(safeNumber(file?.size, { min: 0, max: 25 * 1024 * 1024 })), type: cleanString(file?.type || "application/octet-stream", 160) }));
}

export function sanitizeFilename(value) {
  const raw = cleanString(value, 180).split(/[\\/]/).pop() || "file";
  const normalized = raw.normalize("NFKC").replace(/[^A-Za-z0-9._() +\-]/g, "_").replace(/\s+/g, " ").trim();
  const filename = normalized || "file";
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new HttpError(400, `${filename} uses an unsupported file type.`);
  return filename.slice(0, 180);
}

export function validateRequestId(value) {
  const id = cleanString(value, 64).toUpperCase();
  if (!/^(3DP|LOCAL)-[A-Z0-9-]{8,58}$/.test(id)) throw new HttpError(400, "The project request ID is invalid.");
  return id;
}

export function normalizeProjectRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Project details are required.");
  const projectTitle = cleanString(input.projectTitle, 120);
  const service = cleanString(input.service, 30);
  const description = cleanString(input.description, 5000);
  const contactName = cleanString(input.contact?.name, 120);
  const email = cleanString(input.contact?.email, 254).toLowerCase();
  if (!projectTitle) throw new HttpError(400, "A project name is required.");
  if (!SERVICES.has(service)) throw new HttpError(400, "Choose a supported service.");
  if (!description) throw new HttpError(400, "A project description is required.");
  if (!contactName) throw new HttpError(400, "A contact name is required.");
  if (!isValidEmail(email)) throw new HttpError(400, "A valid contact email is required.");
  if (input.consent !== true) throw new HttpError(400, "The project terms must be accepted.");
  const estimateLow = Math.round(safeNumber(input.estimate?.low, { min: 0, max: 100000 }));
  const estimateHigh = Math.round(safeNumber(input.estimate?.high, { min: estimateLow, max: 100000, fallback: estimateLow }));
  const files = cleanFileMetadata(input.files);
  const modelUrl = cleanUrl(input.modelUrl);
  if (service === "print" && !modelUrl && !files.length) throw new HttpError(400, "A model file or accessible model link is required for print requests.");
  return {
    projectTitle, service, serviceLabel: cleanString(input.serviceLabel, 120) || service, description, modelUrl,
    deadline: cleanOptionalString(input.deadline, 32),
    estimate: { low: estimateLow, high: estimateHigh, formatted: cleanString(input.estimate?.formatted, 80) || `$${estimateLow}–$${estimateHigh}`, currency: cleanString(input.estimate?.currency, 8) || "USD", confidence: cleanString(input.estimate?.confidence, 40) || "rough", breakdown: cleanSpecifications(input.estimate?.breakdown) },
    specifications: cleanSpecifications(input.specifications),
    contact: { name: contactName, email, phone: cleanOptionalString(input.contact?.phone, 40), preferredContact: cleanString(input.contact?.preferredContact, 30) || "email", address: cleanOptionalString(input.contact?.address, 500) },
    files, consent: true, source: "3dprint4.me", userAgent: cleanOptionalString(input.userAgent, 500), submittedAt: new Date().toISOString()
  };
}

function normalizeUploadPath(value, requestId, mode) {
  const path = cleanOptionalString(value, 500);
  if (!path) {
    if (mode === "signed") throw new HttpError(400, "A signed upload must include its private storage path.");
    return null;
  }
  const prefix = `${requestId}/`;
  if (!path.startsWith(prefix) || path.includes("\\") || path.includes("//") || path.split("/").some(segment => segment === ".." || segment === ".")) {
    throw new HttpError(400, "An uploaded file path is outside this project request.");
  }
  return path;
}

export function normalizeUploadedFiles(input, requestId) {
  if (!Array.isArray(input)) return [];
  const id = validateRequestId(requestId);
  return input.slice(0, 8).map(file => {
    const mode = cleanString(file?.mode || "unknown", 30);
    if (!new Set(["signed", "metadata", "unknown"]).has(mode)) throw new HttpError(400, "An uploaded file mode is invalid.");
    return {
      name: sanitizeFilename(file?.name),
      size: Math.round(safeNumber(file?.size, { min: 0, max: 25 * 1024 * 1024 })),
      type: cleanString(file?.type || "application/octet-stream", 160),
      path: normalizeUploadPath(file?.path, id, mode),
      mode
    };
  });
}
