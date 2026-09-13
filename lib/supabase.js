import { HttpError } from "./http.js";

const url = () => String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || "service-files";
const storageUrl = () => `${url()}/storage/v1`;
export function hasSupabase() { return Boolean(url() && key()); }

async function supabaseFetch(path, options = {}) {
  if (!hasSupabase()) throw new HttpError(503, "Supabase is not configured.");
  const response = await fetch(`${url()}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let payload = null;
  let parseFailed = false;
  if (text) {
    try { payload = JSON.parse(text); }
    catch {
      parseFailed = true;
      payload = { message: text.slice(0, 1000) };
    }
  }
  if (!response.ok || parseFailed) {
    console.error("Supabase request failed", response.status);
    throw new HttpError(502, "Project storage is temporarily unavailable.");
  }
  return payload;
}

export async function createRequestRecord(id, request) {
  await supabaseFetch("/rest/v1/service_requests", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id, status: "draft", service: request.service, project_title: request.projectTitle, contact_name: request.contact.name, contact_email: request.contact.email, payload: request }) });
}

export async function completeRequestRecord(id, request, files) {
  const rows = await supabaseFetch(`/rest/v1/service_requests?id=eq.${encodeURIComponent(id)}&status=eq.draft`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "submitted", payload: request, uploaded_files: files, submitted_at: new Date().toISOString() })
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new HttpError(409, "The project request is missing or has already been completed.");
  }
}

export async function requestRecordExists(id) {
  const rows = await supabaseFetch(`/rest/v1/service_requests?select=id,status&id=eq.${encodeURIComponent(id)}&limit=1`, { headers: { Accept: "application/json" } });
  return Array.isArray(rows) && rows.length === 1 && rows[0]?.status === "draft";
}

function encodeStoragePath(path) { return path.split("/").map(encodeURIComponent).join("/"); }

function signedStorageUrl(relative, expectedPath, token = null) {
  if (typeof relative !== "string" || !relative) throw new HttpError(502, "Private file storage returned an invalid link.");
  let parsed;
  try {
    const full = /^https?:\/\//i.test(relative)
      ? relative
      : relative.startsWith("/storage/v1/")
        ? `${url()}${relative}`
        : `${storageUrl()}${relative.startsWith("/") ? relative : `/${relative}`}`;
    parsed = new URL(full);
    if (token && !parsed.searchParams.has("token")) parsed.searchParams.set("token", token);
    const project = new URL(url());
    if (parsed.origin !== project.origin || parsed.username || parsed.password || parsed.pathname !== expectedPath || !parsed.searchParams.get("token")) throw new Error("link mismatch");
  } catch { throw new HttpError(502, "Private file storage returned an invalid link."); }
  return parsed.toString();
}

export async function createSignedUpload(path) {
  const encoded = encodeStoragePath(path);
  const payload = await supabaseFetch(`/storage/v1/object/upload/sign/${encodeURIComponent(bucket())}/${encoded}`, { method: "POST", body: JSON.stringify({ upsert: false }) });
  const relative = payload?.url || `/object/upload/sign/${encodeURIComponent(bucket())}/${encoded}?token=${encodeURIComponent(payload?.token || "")}`;
  const uploadUrl = signedStorageUrl(relative, `/storage/v1/object/upload/sign/${encodeURIComponent(bucket())}/${encoded}`, payload?.token);
  return { uploadUrl, token: payload?.token || new URL(uploadUrl).searchParams.get("token") || null };
}

export async function createSignedDownload(path, expiresIn = 900) {
  const encoded = encodeStoragePath(path);
  const payload = await supabaseFetch(`/storage/v1/object/sign/${encodeURIComponent(bucket())}/${encoded}`, { method: "POST", body: JSON.stringify({ expiresIn }) });
  const relative = payload?.signedURL || payload?.signedUrl;
  return signedStorageUrl(relative, `/storage/v1/object/sign/${encodeURIComponent(bucket())}/${encoded}`);
}
