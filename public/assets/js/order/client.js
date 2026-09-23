export class ProjectRequestClientError extends Error {
  constructor(message, { status = 0, kind = "unavailable", cause } = {}) {
    super(message, { cause });
    this.name = "ProjectRequestClientError";
    this.status = status;
    this.kind = kind;
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
    if (!response.ok) throw new ProjectRequestClientError(payload.error || `Request failed (${response.status})`, { status: response.status, kind: kindFor(response.status, operation) });
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
    prepareFiles: (requestId, mode, files, onProgress) => ["neon", "supabase"].includes(mode) ? upload(requestId, files, onProgress) : Promise.resolve(metadata(files))
  };
}
