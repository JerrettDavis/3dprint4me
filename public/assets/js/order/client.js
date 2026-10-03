export class ProjectRequestClientError extends Error {
  constructor(message, { status = 0, kind = "unavailable", cause, code } = {}) {
    super(message, { cause });
    this.name = "ProjectRequestClientError";
    this.status = status;
    this.kind = kind;
    // A machine-readable reason from the server (e.g. "customization-stale"), when it sent one.
    if (typeof code === "string") this.code = code;
  }
}

function kindFor(status, operation) {
  if (status >= 400 && status < 500) return "correctable";
  return operation === "complete" ? "uncertain-completion" : "unavailable";
}

export function createProjectRequestClient({ fetchImpl = (...args) => fetch(...args) } = {}) {
  async function requestJson(url, options = {}, operation = "request") {
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    } catch (cause) {
      throw new ProjectRequestClientError("The service could not be reached.", { kind: kindFor(0, operation), cause });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ProjectRequestClientError(payload.error || `Request failed (${response.status})`, { status: response.status, kind: kindFor(response.status, operation), code: payload.details?.code });
    return payload;
  }

  async function upload(requestId, files, onProgress = () => {}) {
    const uploaded = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      onProgress(index + 1, files.length);
      const instruction = await requestJson("/api/upload-url", {
        method: "POST",
        body: JSON.stringify({ requestId, filename: file.name, contentType: file.type, size: file.size })
      }, "upload-authorization");
      if (!instruction.uploadUrl) throw new ProjectRequestClientError(`No upload destination was created for ${file.name}.`);
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      let response;
      try {
        response = await fetchImpl(instruction.uploadUrl, {
          method: instruction.method || "PUT",
          headers: { ...(instruction.headers || {}) },
          body: instruction.bodyType === "file" ? file : form
        });
      } catch (cause) {
        throw new ProjectRequestClientError(`Could not upload ${file.name}.`, { cause });
      }
      if (!response.ok) throw new ProjectRequestClientError(`Could not upload ${file.name}.`, { status: response.status });
      uploaded.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", path: instruction.path || null, mode: "signed" });
    }
    return uploaded;
  }

  function metadata(files) {
    return files.map(file => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream", path: null, mode: "metadata" }));
  }

  return {
    create: body => requestJson("/api/request", { method: "POST", body: JSON.stringify({ action: "create", ...body }) }, "create"),
    complete: body => requestJson("/api/request", { method: "PATCH", body: JSON.stringify({ action: "complete", ...body }) }, "complete"),
    health: () => requestJson("/api/health"),
    checkout: body => requestJson("/api/checkout", { method: "POST", body: JSON.stringify(body) }, "checkout"),
    upload,
    async prepareFiles(requestId, mode, files, onProgress, isPreUploaded = () => false) {
      // A model already stored privately with its print estimate is referenced, never re-uploaded.
      const estimateModels = files.filter(file => isPreUploaded(file)).map(file => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream", path: null, mode: "estimate" }));
      const remaining = files.filter(file => !isPreUploaded(file));
      const prepared = ["neon", "supabase"].includes(mode) ? await upload(requestId, remaining, onProgress) : metadata(remaining);
      return [...estimateModels, ...prepared];
    }
  };
}
