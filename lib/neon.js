import { HttpError } from "./http.js";
import { hasDatabase, queryDatabase } from './database.js';

// Compatibility names used by existing SQL repositories; DATABASE_DRIVER selects
// hosted Neon HTTP or pooled native PostgreSQL without changing domain behavior.
export const hasNeon = hasDatabase;
export const queryNeon = queryDatabase;

export async function createRequestRecord(id, request) {
  await queryNeon`INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload)
    VALUES (${id}, 'draft', ${request.service}, ${request.projectTitle}, ${request.contact.name}, ${request.contact.email}, ${JSON.stringify(request)}::jsonb)`;
}

export async function completeRequestRecord(id, request, files) {
  const rows = await queryNeon`UPDATE service_requests SET status = 'submitted', payload = ${JSON.stringify(request)}::jsonb,
    uploaded_files = ${JSON.stringify(files)}::jsonb, submitted_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'draft' RETURNING id`;
  if (rows.length !== 1) throw new HttpError(409, "The project request is missing or has already been completed.");
}

export async function requestRecordExists(id) {
  const rows = await queryNeon`SELECT id FROM service_requests WHERE id = ${id} AND status = 'draft' LIMIT 1`;
  return rows.length === 1;
}
