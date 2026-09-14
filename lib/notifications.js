import { createHmac } from "node:crypto";
import { createSignedDownload, hasSupabase } from "./supabase.js";
import * as blobStore from "./blob.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
export function hasEmailDelivery() { return Boolean(process.env.RESEND_API_KEY && process.env.REQUEST_TO_EMAIL && process.env.REQUEST_FROM_EMAIL); }
export function hasWebhookDelivery() { return Boolean(process.env.REQUEST_WEBHOOK_URL); }

async function signedFiles(files) {
  if (!hasSupabase() && !blobStore.hasBlob()) return [];
  return Promise.all(files.filter(file => file.path).map(async file => ({ ...file, url: blobStore.hasBlob() ? await blobStore.createSignedDownload(file.path, 900) : await createSignedDownload(file.path, 900) })));
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (!hasEmailDelivery()) return false;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.REQUEST_FROM_EMAIL, to: [to], subject, html, reply_to: replyTo }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Resend returned ${response.status}.`);
  return true;
}

function summaryTable(request) {
  const rows = [["Service", request.serviceLabel], ["Estimate", request.estimate.formatted], ["Deadline", request.deadline || "Not specified"], ["Preferred contact", request.contact.preferredContact], ["Phone", request.contact.phone || "Not provided"], ["Model link", request.modelUrl || "Not provided"]];
  return `<table style="border-collapse:collapse;width:100%">${rows.map(([label, value]) => `<tr><th style="padding:8px;text-align:left;border-bottom:1px solid #ddd">${escapeHtml(label)}</th><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

export async function sendRequestEmails(id, request, files) {
  if (!hasEmailDelivery()) return { sent: 0 };
  const links = await signedFiles(files);
  const fileList = links.length ? `<ul>${links.map(file => `<li><a href="${escapeHtml(file.url)}">${escapeHtml(file.name)}</a> (${Math.ceil(file.size / 1024)} KB; link expires in 15 minutes)</li>`).join("")}</ul>` : `<p>${files.length ? "File names were recorded but no private upload was available. Ask the customer to attach them to a reply." : "No files attached."}</p>`;
  const ownerHtml = `<h1>${escapeHtml(request.projectTitle)}</h1><p><strong>Request:</strong> ${escapeHtml(id)}</p>${summaryTable(request)}<h2>Description</h2><p>${escapeHtml(request.description).replaceAll("\n", "<br>")}</p><h2>Files</h2>${fileList}<h2>Specifications</h2><pre>${escapeHtml(JSON.stringify(request.specifications, null, 2))}</pre>`;
  const fileHandoff = files.some(file => !file.path)
    ? `<p>Your selected files were not uploaded. Please reply to this email and attach them, including your request ID.</p>`
    : "";
  const customerHtml = `<h1>Project request received</h1><p>Thanks, ${escapeHtml(request.contact.name)}. Your reference is <strong>${escapeHtml(id)}</strong>.</p><p>I’ll review the details, then reply with a confirmed price, material, and schedule. The current planning range is <strong>${escapeHtml(request.estimate.formatted)}</strong>.</p>${fileHandoff}<p>This is a request, not a binding order or final charge.</p>`;
  const results = await Promise.allSettled([
    sendEmail({ to: process.env.REQUEST_TO_EMAIL, subject: `[${id}] ${request.projectTitle}`, html: ownerHtml, replyTo: request.contact.email }),
    sendEmail({ to: request.contact.email, subject: `3dprint4.me request ${id}`, html: customerHtml, replyTo: process.env.REQUEST_TO_EMAIL })
  ]);
  const owner = results[0].status === "fulfilled" && results[0].value;
  const customer = results[1].status === "fulfilled" && results[1].value;
  if (results[1].status === "rejected") console.warn("Customer receipt email failed.");
  if (results[0].status === "rejected") throw results[0].reason;
  return { sent: Number(owner) + Number(customer), owner, customer };
}

export async function postRequestWebhook(id, request, files) {
  if (!hasWebhookDelivery()) return { delivered: false };
  const body = JSON.stringify({ event: "project.requested", id, request, files, occurredAt: new Date().toISOString() });
  const headers = { "Content-Type": "application/json", "User-Agent": "3dprint4.me/1.0" };
  if (process.env.REQUEST_WEBHOOK_SECRET) headers["X-3DP-Signature"] = `sha256=${createHmac("sha256", process.env.REQUEST_WEBHOOK_SECRET).update(body).digest("hex")}`;
  const response = await fetch(process.env.REQUEST_WEBHOOK_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}.`);
  return { delivered: true };
}
