import { randomUUID } from "node:crypto";
import { del, head } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { createRequestRecord, requestRecordExists, completeRequestRecord } from "../lib/neon.js";
import { createSignedUpload, createSignedDownload } from "../lib/blob.js";

const id = `3DP-20990101-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
const path = `${id}/provider-check.txt`;
const request = { service: "consult", projectTitle: "Provider verification", contact: { name: "Integration Test", email: "verification@example.invalid" } };
const sql = neon(process.env.DATABASE_URL);
let uploaded = false;
try {
  await createRequestRecord(id, request);
  if (!(await requestRecordExists(id))) throw new Error("Draft was not persisted.");
  const { uploadUrl } = await createSignedUpload(path, 32, "text/plain");
  const uploadedResponse = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "private provider check" });
  if (!uploadedResponse.ok) throw new Error(`Private upload failed: ${uploadedResponse.status}`);
  uploaded = true;
  const headResult = await head(path, { access: "private" });
  if (!headResult) throw new Error("Private upload did not create an object.");
  const privateUrl = new URL(uploadUrl);
  privateUrl.search = "";
  const denied = await fetch(privateUrl);
  if (denied.ok) throw new Error("Private file was publicly readable.");
  const downloadUrl = await createSignedDownload(path, 60);
  const downloaded = await fetch(downloadUrl);
  const downloadedBody = await downloaded.text();
  if (!downloaded.ok || downloadedBody !== "private provider check") throw new Error(`Signed download failed: ${downloaded.status}, ${downloadedBody.length} bytes.`);
  await completeRequestRecord(id, request, [{ name: "provider-check.txt", path, mode: "signed" }]);
  if (await requestRecordExists(id)) throw new Error("Submitted row still appears as a draft.");
  console.log("Neon persistence and private Blob upload/download verified.");
} finally {
  if (uploaded) await del(path, { access: "private" });
  await sql`DELETE FROM service_requests WHERE id = ${id}`;
}
