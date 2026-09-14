import { neon } from "@neondatabase/serverless";
import { HttpError } from "./http.js";

export function hasNeon() { return Boolean(process.env.DATABASE_URL); }
function sql() {
  if (!hasNeon()) throw new HttpError(503, "Project storage is not configured.");
  return neon(process.env.DATABASE_URL);
}
async function query(strings, ...values) {
  try { return await sql()(strings, ...values); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Neon request failed.");
    throw new HttpError(502, "Project storage is temporarily unavailable.");
  }
}

export async function createRequestRecord(id, request) {
  await query`INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload)
    VALUES (${id}, 'draft', ${request.service}, ${request.projectTitle}, ${request.contact.name}, ${request.contact.email}, ${JSON.stringify(request)}::jsonb)`;
}

export async function completeRequestRecord(id, request, files) {
  const rows = await query`UPDATE service_requests SET status = 'submitted', payload = ${JSON.stringify(request)}::jsonb,
    uploaded_files = ${JSON.stringify(files)}::jsonb, submitted_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'draft' RETURNING id`;
  if (rows.length !== 1) throw new HttpError(409, "The project request is missing or has already been completed.");
}

export async function requestRecordExists(id) {
  const rows = await query`SELECT id FROM service_requests WHERE id = ${id} AND status = 'draft' LIMIT 1`;
  return rows.length === 1;
}
