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

const iso = value => value instanceof Date ? value.toISOString() : value;
function normalizeItem(row) {
  return {
    id: row.id, requestId: row.request_id, status: row.status, previousStatus: row.previous_status ?? null,
    priority: row.priority, acknowledged: Boolean(row.acknowledged_at), acknowledgedAt: iso(row.acknowledged_at) ?? null,
    acknowledgedBy: row.acknowledged_by ?? null, targetDate: iso(row.target_date)?.slice?.(0, 10) ?? null,
    assignedOperatorId: row.assigned_operator_id ?? null, revision: Number(row.revision),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: iso(row.completed_at) ?? null
  };
}
function normalizeEvent(row) {
  return { id: String(row.id ?? row.event_id), type: row.event_type, actorType: row.actor_type, actorId: row.actor_id ?? null, data: row.data ?? {}, occurredAt: iso(row.occurred_at) };
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
    async listWork(filters) {
      const cursorSort = filters.cursor?.sort ?? null;
      const cursorId = filters.cursor?.id ?? null;
      const rows = await query`SELECT w.id, w.request_id, w.status, sr.service, sr.project_title,
          w.priority, w.acknowledged_at, sr.submitted_at, w.target_date, w.revision, w.created_at
        FROM work_items w JOIN service_requests sr ON sr.id = w.request_id
        WHERE (${filters.service}::text IS NULL OR sr.service = ${filters.service})
          AND (${filters.priority}::text IS NULL OR w.priority = ${filters.priority})
          AND CASE ${filters.view}
            WHEN 'unacknowledged' THEN w.acknowledged_at IS NULL AND w.status NOT IN ('completed','declined','cancelled')
            WHEN 'waiting' THEN w.status = 'waiting_customer'
            WHEN 'completed' THEN w.status IN ('completed','declined','cancelled')
            WHEN 'all' THEN true
            ELSE w.status NOT IN ('waiting_customer','completed','declined','cancelled') END
          AND (${cursorSort}::timestamptz IS NULL OR (w.created_at, w.id) > (${cursorSort}::timestamptz, ${cursorId}))
        ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 w.created_at, w.id LIMIT ${filters.limit + 1}`;
      const page = rows.slice(0, filters.limit);
      return {
        items: page.map(row => ({ id: row.id, requestId: row.request_id, status: row.status, service: row.service, projectTitle: row.project_title, priority: row.priority, acknowledged: Boolean(row.acknowledged_at), submittedAt: iso(row.submitted_at), targetDate: iso(row.target_date)?.slice?.(0, 10) ?? null, revision: Number(row.revision) })),
        nextCursor: rows.length > filters.limit && page.length ? Buffer.from(JSON.stringify({ sort: iso(page.at(-1).created_at), id: page.at(-1).id }), "utf8").toString("base64url") : null
      };
    },
    async getWork(id) {
      const rows = await query`SELECT w.*, sr.payload, sr.uploaded_files FROM work_items w
        JOIN service_requests sr ON sr.id = w.request_id WHERE w.id = ${id} LIMIT 1`;
      if (!rows.length) throw new HttpError(404, "Work item was not found.");
      const notes = await query`SELECT id, operator_id, body, created_at FROM work_notes WHERE work_item_id = ${id} ORDER BY created_at, id`;
      const events = await query`SELECT id, event_type, actor_type, actor_id, data, occurred_at FROM work_events WHERE work_item_id = ${id} ORDER BY id`;
      return { item: normalizeItem(rows[0]), request: rows[0].payload, files: rows[0].uploaded_files ?? [], notes: notes.map(row => ({ id: row.id, operatorId: row.operator_id, body: row.body, createdAt: iso(row.created_at) })), events: events.map(normalizeEvent) };
    },
    async listEvents(after, limit) {
      const rows = await query`SELECT id, work_item_id, request_id, event_type, actor_type, actor_id, data, occurred_at
        FROM work_events WHERE id > ${after}::bigint ORDER BY id LIMIT ${limit}`;
      const events = rows.map(row => ({ ...normalizeEvent(row), workItemId: row.work_item_id, requestId: row.request_id }));
      return { events, nextCursor: events.at(-1)?.id ?? String(after) };
    },
    async applyWorkCommand(id, command, operator, idempotencyKey) {
      const prior = await query`SELECT result FROM work_actions WHERE operator_id = ${operator.id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
      if (prior[0]?.result) return prior[0].result;
      const eventType = { acknowledge: "work.acknowledged", "set-priority": "work.priority_changed", "set-target-date": "work.target_date_changed", "set-assignee": "work.assignee_changed", "set-status": "work.status_changed", "add-note": "work.note_added" }[command.type];
      const rows = await query`WITH existing AS (
          SELECT result FROM work_actions WHERE operator_id = ${operator.id} AND idempotency_key = ${idempotencyKey}
        ), updated AS (
          UPDATE work_items w SET
            acknowledged_at = CASE WHEN ${command.type} = 'acknowledge' THEN COALESCE(w.acknowledged_at, now()) ELSE w.acknowledged_at END,
            acknowledged_by = CASE WHEN ${command.type} = 'acknowledge' THEN COALESCE(w.acknowledged_by, ${operator.id}) ELSE w.acknowledged_by END,
            priority = CASE WHEN ${command.type} = 'set-priority' THEN ${command.priority ?? null} ELSE w.priority END,
            target_date = CASE WHEN ${command.type} = 'set-target-date' THEN ${command.targetDate ?? null}::date ELSE w.target_date END,
            assigned_operator_id = CASE WHEN ${command.type} = 'set-assignee' THEN ${command.operatorId ?? null} ELSE w.assigned_operator_id END,
            previous_status = CASE WHEN ${command.type} = 'set-status' AND ${command.status ?? null} = 'waiting_customer' THEN w.status ELSE CASE WHEN ${command.type} = 'set-status' THEN NULL ELSE w.previous_status END END,
            status = CASE WHEN ${command.type} = 'set-status' THEN ${command.status ?? null} ELSE w.status END,
            completed_at = CASE WHEN ${command.type} = 'set-status' AND ${command.status ?? null} = 'completed' THEN now() ELSE w.completed_at END,
            revision = w.revision + 1, updated_at = now()
          WHERE w.id = ${id} AND w.revision = ${command.revision} AND NOT EXISTS (SELECT 1 FROM existing)
            AND (${command.type} <> 'set-status' OR
              (w.status = 'submitted' AND ${command.status ?? null} = ANY(ARRAY['triage','waiting_customer','declined','cancelled'])) OR
              (w.status = 'triage' AND ${command.status ?? null} = ANY(ARRAY['quoted','waiting_customer','declined','cancelled'])) OR
              (w.status = 'quoted' AND ${command.status ?? null} = ANY(ARRAY['approved','waiting_customer','declined','cancelled'])) OR
              (w.status = 'approved' AND ${command.status ?? null} = 'scheduled' AND w.target_date IS NOT NULL) OR
              (w.status = 'approved' AND ${command.status ?? null} = 'cancelled') OR
              (w.status = 'scheduled' AND ${command.status ?? null} = ANY(ARRAY['in_progress','cancelled'])) OR
              (w.status = 'in_progress' AND ${command.status ?? null} = ANY(ARRAY['completed','cancelled'])) OR
              (w.status = 'waiting_customer' AND ${command.status ?? null} = w.previous_status))
          RETURNING *
        ), inserted_note AS (
          INSERT INTO work_notes (work_item_id, operator_id, body)
          SELECT id, ${operator.id}, ${command.body ?? null} FROM updated WHERE ${command.type} = 'add-note'
          RETURNING id
        ), created_event AS (
          INSERT INTO work_events (work_item_id, request_id, event_type, actor_type, actor_id, data)
          SELECT id, request_id, ${eventType}, 'operator', ${operator.id},
            jsonb_strip_nulls(jsonb_build_object('version', 1, 'priority', ${command.priority ?? null}, 'targetDate', ${command.targetDate ?? null}, 'operatorId', ${command.operatorId ?? null}, 'status', ${command.status ?? null}, 'noteId', (SELECT id FROM inserted_note LIMIT 1)))
          FROM updated RETURNING id, work_item_id, event_type, occurred_at
        ), result_row AS (
          SELECT updated.*, created_event.id AS event_id, created_event.event_type, created_event.occurred_at
          FROM updated JOIN created_event ON created_event.work_item_id = updated.id
        ), saved AS (
          INSERT INTO work_actions (operator_id, idempotency_key, work_item_id, result)
          SELECT ${operator.id}, ${idempotencyKey}, id,
            jsonb_build_object('item', jsonb_build_object(
              'id', id, 'requestId', request_id, 'status', status, 'previousStatus', previous_status,
              'priority', priority, 'acknowledged', acknowledged_at IS NOT NULL,
              'acknowledgedAt', acknowledged_at, 'acknowledgedBy', acknowledged_by,
              'targetDate', target_date, 'assignedOperatorId', assigned_operator_id,
              'revision', revision, 'createdAt', created_at, 'updatedAt', updated_at,
              'completedAt', completed_at),
              'event', jsonb_build_object('id', event_id::text, 'type', event_type, 'occurredAt', occurred_at))
          FROM result_row ON CONFLICT (operator_id, idempotency_key) DO NOTHING
        ) SELECT * FROM result_row`;
      if (!rows.length) {
        const repeated = await query`SELECT result FROM work_actions WHERE operator_id = ${operator.id} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
        if (repeated[0]?.result) return repeated[0].result;
        const current = await query`SELECT revision FROM work_items WHERE id = ${id} LIMIT 1`;
        if (!current.length) throw new HttpError(404, "Work item was not found.");
        if (Number(current[0].revision) !== command.revision) throw new HttpError(409, "Work changed before this update could be saved.", { code: "revision_conflict", currentRevision: Number(current[0].revision) });
        throw new HttpError(422, "That work update is not allowed.");
      }
      const row = rows[0];
      return { item: normalizeItem(row), event: { id: String(row.event_id), type: row.event_type, occurredAt: iso(row.occurred_at) } };
    },
    async hasPushSubscription(operator) {
      const rows = await query`SELECT id FROM push_subscriptions WHERE operator_id = ${operator.id} AND enabled = true LIMIT 1`;
      return rows.length === 1;
    },
    async savePushSubscription(operator, subscription, userAgent) {
      await query`INSERT INTO push_subscriptions (operator_id, endpoint, p256dh, auth_key, expiration_time, user_agent)
        VALUES (${operator.id}, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth}, ${subscription.expirationTime}, ${userAgent})
        ON CONFLICT (endpoint) DO UPDATE SET operator_id = EXCLUDED.operator_id, p256dh = EXCLUDED.p256dh,
          auth_key = EXCLUDED.auth_key, expiration_time = EXCLUDED.expiration_time, user_agent = EXCLUDED.user_agent,
          enabled = true, failure_count = 0, updated_at = now()`;
      return { subscribed: true };
    },
    async disablePushSubscription(operator, endpoint) {
      const rows = await query`UPDATE push_subscriptions SET enabled = false, updated_at = now()
        WHERE operator_id = ${operator.id} AND endpoint = ${endpoint} AND enabled = true RETURNING id`;
      return { disabled: rows.length === 1 };
    },
    async queueTestNotification(operator) {
      const rows = await query`WITH latest AS (
          SELECT we.id AS event_id, we.work_item_id FROM work_events we JOIN work_items w ON w.id = we.work_item_id
          WHERE w.assigned_operator_id IS NULL OR w.assigned_operator_id = ${operator.id} ORDER BY we.id DESC LIMIT 1
        ) INSERT INTO notification_outbox (event_id, kind, payload)
          SELECT event_id, 'test', jsonb_build_object('version', 1, 'eventId', event_id::text, 'workId', work_item_id, 'route', '/work/' || work_item_id)
          FROM latest ON CONFLICT (event_id, kind) DO UPDATE SET state = 'pending', next_attempt_at = now(), updated_at = now()
          RETURNING id`;
      if (!rows.length) throw new HttpError(409, "Create a work request before testing notifications.");
      return { queued: true };
    },
    async claimPushOutbox({ workerId, batchSize }) {
      return query`WITH candidates AS (
          SELECT id FROM notification_outbox
          WHERE state IN ('pending','processing') AND next_attempt_at <= now()
            AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${batchSize}
        ) UPDATE notification_outbox o SET state = 'processing', lease_owner = ${workerId},
            lease_expires_at = now() + interval '2 minutes', updated_at = now()
          FROM candidates WHERE o.id = candidates.id
          RETURNING o.id::text AS id, o.event_id::text AS "eventId", o.payload`;
    },
    async listPushSubscriptions(entry) {
      const rows = await query`WITH inserted AS (
          INSERT INTO notification_deliveries (outbox_id, subscription_id)
          SELECT ${entry.id}::bigint, id FROM push_subscriptions WHERE enabled = true
          ON CONFLICT (outbox_id, subscription_id) DO NOTHING RETURNING subscription_id
        ) SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth_key
          FROM push_subscriptions ps JOIN notification_deliveries d ON d.subscription_id = ps.id
          WHERE d.outbox_id = ${entry.id}::bigint AND ps.enabled = true AND d.state IN ('pending','retrying')`;
      return rows.map(row => ({ id: row.id, endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } }));
    },
    async recordPushOutcome({ outboxId, subscriptionId, state, category }) {
      await query`WITH delivery AS (
          UPDATE notification_deliveries SET state = ${state}, attempt_count = attempt_count + 1,
            delivered_at = CASE WHEN ${state} = 'delivered' THEN now() ELSE delivered_at END,
            last_error_category = ${category}, next_attempt_at = CASE WHEN ${state} = 'retrying' THEN now() + interval '1 minute' ELSE next_attempt_at END,
            updated_at = now() WHERE outbox_id = ${outboxId}::bigint AND subscription_id = ${subscriptionId} RETURNING subscription_id
        ) UPDATE push_subscriptions ps SET enabled = CASE WHEN ${state} = 'disabled' THEN false ELSE enabled END,
          failure_count = CASE WHEN ${state} = 'delivered' THEN 0 WHEN ${state} IN ('retrying','failed') THEN failure_count + 1 ELSE failure_count END,
          last_success_at = CASE WHEN ${state} = 'delivered' THEN now() ELSE last_success_at END, updated_at = now()
        FROM delivery WHERE ps.id = delivery.subscription_id`;
    },
    async finishPushOutbox(id, summary) {
      const retry = summary.retrying > 0;
      const delivered = summary.delivered > 0 || summary.disabled > 0;
      await query`UPDATE notification_outbox SET attempt_count = attempt_count + 1, lease_owner = NULL, lease_expires_at = NULL,
        state = ${retry ? "pending" : delivered ? "delivered" : "failed"},
        next_attempt_at = CASE WHEN ${retry} THEN now() + interval '1 minute' ELSE next_attempt_at END,
        delivered_at = CASE WHEN ${!retry && delivered} THEN now() ELSE delivered_at END, updated_at = now()
        WHERE id = ${id}::bigint`;
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
