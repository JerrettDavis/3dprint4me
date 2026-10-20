import { queryNeon } from '../neon.js';
import { HttpError } from '../http.js';

const normalize = row => row ? ({ operationId: row.operation_id, workId: row.work_item_id, revision: Number(row.work_revision), actorId: row.actor_id,
  payload: row.payload, payloadHash: row.payload_hash, state: row.state, provider: row.provider ?? null, errorCode: row.error_code ?? null,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }) : null;
const outcomes = new Set(['draft', 'linked', 'needs_review', 'needs_reconciliation']);
export function createNeonInvoiceRepository({ query = queryNeon } = {}) {
  async function get(workId) { return normalize((await query`SELECT * FROM invoice_operations WHERE work_item_id = ${workId}`)[0]); }
  return {
    get,
    async reserve({ workId, revision, actorId, operationId, payload, payloadHash }) {
      const existing = await get(workId);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new HttpError(409, 'This job already has a different confirmed billing operation. Review it in Invoice Ninja.');
        return { created: false, record: existing };
      }
      const inserted = await query`INSERT INTO invoice_operations (operation_id, work_item_id, work_revision, actor_id, payload, payload_hash)
        SELECT ${operationId}, w.id, w.revision, ${actorId}, ${JSON.stringify(payload)}::jsonb, ${payloadHash}
        FROM work_items w WHERE w.id = ${workId} AND w.revision = ${revision}
        AND EXISTS (SELECT 1 FROM operators WHERE id = ${actorId} AND enabled AND role = 'owner')
        ON CONFLICT DO NOTHING RETURNING *`;
      const record = normalize(inserted[0]) ?? await get(workId);
      if (!record || record.payloadHash !== payloadHash) throw new HttpError(409, 'Work changed or another billing operation already exists. Reload and review.');
      return { created: inserted.length === 1, record };
    },
    async begin(operationId) {
      const rows = await query`UPDATE invoice_operations SET state = 'creating', updated_at = now()
        WHERE operation_id = ${operationId} AND state = 'prepared' RETURNING operation_id`;
      return rows.length === 1;
    },
    async finish(operationId, { state, provider, errorCode }) {
      if (!outcomes.has(state)) throw new TypeError('Unsupported billing outcome.');
      const rows = await query`UPDATE invoice_operations SET state = ${state}, provider = ${provider ? JSON.stringify(provider) : null}::jsonb,
        error_code = ${errorCode ?? null}, updated_at = now() WHERE operation_id = ${operationId} AND state <> 'prepared' RETURNING *`;
      if (rows.length !== 1) throw new HttpError(409, 'Billing operation is not ready for this outcome.');
      return normalize(rows[0]);
    }
  };
}
