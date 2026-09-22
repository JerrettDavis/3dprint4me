import { HttpError } from "./http.js";
import { queryNeon } from "./neon.js";

function normalizeCompletion(row) {
  return {
    workItem: {
      id: row.work_id,
      requestId: row.request_id,
      status: row.status,
      priority: row.priority,
      revision: Number(row.revision)
    },
    event: { id: String(row.event_id), type: "work.created" },
    outbox: { id: String(row.outbox_id), state: "pending" }
  };
}

export function createNeonWorkStore({ query = queryNeon } = {}) {
  return {
    async findOperatorByAuthUserId(authUserId) {
      const rows = await query`SELECT id, auth_user_id, display_name, role, enabled
        FROM operators WHERE auth_user_id = ${authUserId} LIMIT 1`;
      if (!rows.length) return null;
      return { id: rows[0].id, authUserId: rows[0].auth_user_id, displayName: rows[0].display_name, role: rows[0].role, enabled: rows[0].enabled };
    },
    async touchOperator(operatorId) {
      await query`UPDATE operators SET last_seen_at = now(), updated_at = now() WHERE id = ${operatorId} AND enabled = true`;
    },
    async completeRequestWithWork(id, request, files) {
      const rows = await query`
        WITH completed AS (
          UPDATE service_requests
          SET status = 'submitted', payload = ${JSON.stringify(request)}::jsonb,
              uploaded_files = ${JSON.stringify(files)}::jsonb,
              submitted_at = now(), updated_at = now()
          WHERE id = ${id} AND status = 'draft'
          RETURNING id
        ), created_work AS (
          INSERT INTO work_items (request_id)
          SELECT id FROM completed
          RETURNING id, request_id, status, priority, revision
        ), created_event AS (
          INSERT INTO work_events (work_item_id, request_id, event_type, actor_type, data)
          SELECT id, request_id, 'work.created', 'system', jsonb_build_object('version', 1)
          FROM created_work
          RETURNING id, work_item_id
        ), created_outbox AS (
          INSERT INTO notification_outbox (event_id, kind, payload)
          SELECT created_event.id, 'new_work',
                 jsonb_build_object('version', 1, 'eventId', created_event.id::text,
                                    'workId', created_work.id, 'route', '/work/' || created_work.id)
          FROM created_event JOIN created_work ON created_work.id = created_event.work_item_id
          RETURNING id, event_id
        )
        SELECT created_work.id AS work_id, created_work.request_id, created_work.status,
               created_work.priority, created_work.revision, created_event.id AS event_id,
               created_outbox.id AS outbox_id
        FROM created_work
        JOIN created_event ON created_event.work_item_id = created_work.id
        JOIN created_outbox ON created_outbox.event_id = created_event.id`;
      if (rows.length !== 1) throw new HttpError(409, "The project request is missing or has already been completed.");
      return normalizeCompletion(rows[0]);
    }
  };
}

const defaultStore = createNeonWorkStore();
export const completeRequestWithWork = (...args) => defaultStore.completeRequestWithWork(...args);
