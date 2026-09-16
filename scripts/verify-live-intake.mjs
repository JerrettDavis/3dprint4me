import { del } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { requireDisabledRemoteDelivery } from "./lib/verification-safety.mjs";

const base = process.argv[2] || "https://3dprint4me.vercel.app";
await requireDisabledRemoteDelivery(base);
const sql = neon(process.env.DATABASE_URL);
const request = {
  projectTitle: "Synthetic intake check", service: "consult", serviceLabel: "Ask a fabrication question",
  description: "Synthetic verification of the deployed private intake and file flow.", modelUrl: "", deadline: null,
  estimate: { low: 65, high: 65, formatted: "$65", currency: "USD", confidence: "rough", breakdown: {} },
  specifications: {}, contact: { name: "Integration Test", email: "verification@example.invalid", phone: null, preferredContact: "email", address: null },
  files: [], consent: true, userAgent: "3dprint4.me automated verification"
};
async function api(path, method, body) {
  const response = await fetch(new URL(path, base), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${payload.error || "unknown error"}`);
  return payload;
}
let id;
let path;
try {
  const created = await api("/api/request", "POST", { action: "create", request });
  id = created.id;
  if (created.mode !== "neon" || !created.live) throw new Error("Live request did not use Neon.");
  const instruction = await api("/api/upload-url", "POST", { requestId: id, filename: "check.txt", contentType: "text/plain", size: 20 });
  path = instruction.path;
  if (instruction.method !== "PUT" || instruction.bodyType !== "file" || !path.startsWith(`${id}/`)) throw new Error("Unexpected upload instruction.");
  const upload = await fetch(instruction.uploadUrl, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "synthetic file check" });
  if (!upload.ok) throw new Error(`Upload returned ${upload.status}.`);
  const completed = await api("/api/request", "PATCH", { action: "complete", id, request, uploadedFiles: [{ name: "check.txt", size: 20, type: "text/plain", path, mode: "signed" }] });
  if (!completed.live || !completed.integrations.database) throw new Error("Live completion did not persist.");
  const rows = await sql`SELECT status, uploaded_files FROM service_requests WHERE id = ${id}`;
  if (rows.length !== 1 || rows[0].status !== "submitted" || rows[0].uploaded_files[0]?.path !== path) throw new Error("Submitted record mismatch.");
  console.log("Live API request, private upload, and database completion verified.");
} finally {
  if (path) await del(path, { access: "private" }).catch(() => {});
  if (id) await sql`DELETE FROM service_requests WHERE id = ${id}`;
}
