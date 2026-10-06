import { HttpError } from "../../http.js";
import { queryNeon } from "../../neon.js";

const iso = value => value instanceof Date ? value.toISOString() : value ?? null;
const json = value => JSON.stringify(value ?? {});
const num = value => value == null ? null : Number(value);

function filamentFromRow(row) {
  return {
    id: row.id, material: row.material, brandLine: row.brand_line ?? null, color: row.color ?? null,
    spoolNominalGrams: Number(row.spool_nominal_grams), purchaseCostCents: Number(row.purchase_cost_cents),
    freightFeeCents: Number(row.freight_fee_cents), onHandGrams: Number(row.on_hand_grams),
    active: Boolean(row.active), estimateDefault: Boolean(row.estimate_default), notes: row.notes ?? null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}
export function sessionFromRow(row) {
  return { id: row.id, ownershipHash: row.ownership_hash, requestId: row.request_id ?? null, state: row.state, assumptions: row.assumptions ?? {}, expiresAt: iso(row.expires_at), attachedAt: iso(row.attached_at), createdAt: iso(row.created_at) };
}
export function assetFromRow(row) {
  return {
    id: row.id, sessionId: row.estimate_session_id, requestId: row.request_id ?? null, blobPath: row.blob_path, originalName: row.original_name,
    format: row.format, contentType: row.content_type ?? null, declaredSizeBytes: num(row.declared_size_bytes), sizeBytes: num(row.size_bytes),
    sha256: row.sha256 ?? null, state: row.state, geometryMetrics: row.geometry_metrics ?? null, analysisErrorCode: row.analysis_error_code ?? null,
    analysisErrorDetail: row.analysis_error_detail ?? null, retentionExpiresAt: iso(row.retention_expires_at), retentionHold: Boolean(row.retention_hold),
    deletedAt: iso(row.deleted_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    parentAssetId: row.parent_asset_id ?? null, archiveEntry: row.archive_entry ?? null, quantity: Number(row.quantity ?? 1), selected: Boolean(row.selected)
  };
}
export function estimateFromRow(row) {
  return {
    id: row.id, sessionId: row.estimate_session_id ?? null, assetId: row.asset_id ?? null, requestId: row.request_id ?? null, purpose: row.purpose,
    estimatorType: row.estimator_type, confidence: row.confidence, engine: row.engine ?? null, engineVersion: row.engine_version ?? null, profileId: row.profile_id ?? null,
    pricingModelVersion: row.pricing_model_version, rateCardVersion: row.rate_card_version, input: row.input_snapshot, geometry: row.geometry_metrics ?? {},
    slicer: row.slicer_metrics ?? {}, cost: row.cost_snapshot, pricing: row.pricing_snapshot, public: row.public_snapshot,
    priceLowCents: Number(row.price_low_cents), priceHighCents: Number(row.price_high_cents), targetPriceCents: Number(row.target_price_cents), createdAt: iso(row.created_at)
  };
}
export function jobFromRow(row) {
  return {
    id: String(row.id), assetId: row.asset_id, jobType: row.job_type, state: row.state, profileKey: row.profile_key, options: row.options ?? {},
    attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), nextAttemptAt: iso(row.next_attempt_at), leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: iso(row.lease_expires_at), lastErrorCategory: row.last_error_category ?? null, lastErrorDetail: row.last_error_detail ?? null,
    resultEstimateId: row.result_estimate_id ?? null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: iso(row.completed_at)
  };
}
function runFromRow(row) {
  return {
    id: row.id, workItemId: row.work_item_id, estimateId: row.estimate_id ?? null, printer: row.printer ?? null, actualGrams: num(row.actual_grams),
    actualMachineHours: num(row.actual_machine_hours), activeLaborMinutes: num(row.active_labor_minutes), failedAttempts: Number(row.failed_attempts),
    completedQuantity: num(row.completed_quantity), notes: row.notes ?? null, recordedBy: row.recorded_by ?? null, createdAt: iso(row.created_at)
  };
}

export function createNeonPrintRepository({ query = queryNeon } = {}) {
  return {
    // Filament cost basis
    async listFilament() {
      const rows = await query`SELECT id, material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents,
          on_hand_grams, active, estimate_default, notes, created_at, updated_at
        FROM filament_inventory ORDER BY material, active DESC, updated_at DESC, id LIMIT 500`;
      return rows.map(filamentFromRow);
    },
    async filamentForMaterial(material) {
      const rows = await query`SELECT id, material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents,
          on_hand_grams, active, estimate_default, notes, created_at, updated_at
        FROM filament_inventory WHERE material = ${material} AND active = true ORDER BY updated_at DESC, id LIMIT 200`;
      return rows.map(filamentFromRow);
    },
    async saveFilament(input) {
      const rows = input.id
        ? await query`UPDATE filament_inventory SET material = ${input.material}, brand_line = ${input.brandLine}, color = ${input.color},
              spool_nominal_grams = ${input.spoolNominalGrams}, purchase_cost_cents = ${input.purchaseCostCents},
              freight_fee_cents = ${input.freightFeeCents}, on_hand_grams = ${input.onHandGrams}, active = ${input.active},
              estimate_default = ${input.estimateDefault}, notes = ${input.notes}, updated_at = now()
            WHERE id = ${input.id} RETURNING *`
        : await query`INSERT INTO filament_inventory (material, brand_line, color, spool_nominal_grams, purchase_cost_cents,
              freight_fee_cents, on_hand_grams, active, estimate_default, notes)
            VALUES (${input.material}, ${input.brandLine}, ${input.color}, ${input.spoolNominalGrams}, ${input.purchaseCostCents},
              ${input.freightFeeCents}, ${input.onHandGrams}, ${input.active}, ${input.estimateDefault}, ${input.notes}) RETURNING *`;
      if (!rows.length) throw new HttpError(404, "Filament was not found.");
      return filamentFromRow(rows[0]);
    },

    // Sessions and assets
    async createSession({ id, ownershipHash, assumptions, expiresAt }) {
      const rows = await query`INSERT INTO print_estimate_sessions (id, ownership_hash, assumptions, expires_at)
        VALUES (${id}, ${ownershipHash}, ${json(assumptions)}::jsonb, ${expiresAt}::timestamptz) RETURNING *`;
      return sessionFromRow(rows[0]);
    },
    async findSession(id) {
      const rows = await query`SELECT * FROM print_estimate_sessions WHERE id = ${id} LIMIT 1`;
      return rows.length ? sessionFromRow(rows[0]) : null;
    },
    async sessionUsage(sessionId) {
      const rows = await query`SELECT (SELECT count(*) FROM print_assets WHERE estimate_session_id = ${sessionId} AND parent_asset_id IS NULL) AS assets,
          (SELECT count(*) FROM print_assets WHERE estimate_session_id = ${sessionId} AND parent_asset_id IS NOT NULL) AS parts,
          (SELECT count(*) FROM print_estimates WHERE estimate_session_id = ${sessionId}) AS estimates`;
      return { assets: Number(rows[0].assets), parts: Number(rows[0].parts), estimates: Number(rows[0].estimates) };
    },
    /** Atomically counts one attempt in the fixed window and returns the new hit count. */
    async consumeRateLimit({ scope, subject, windowStart }) {
      const rows = await query`INSERT INTO print_estimate_rate_buckets (scope, subject, window_start, hits)
        VALUES (${scope}, ${subject}, ${windowStart}::timestamptz, 1)
        ON CONFLICT (scope, subject, window_start)
        DO UPDATE SET hits = LEAST(print_estimate_rate_buckets.hits + 1, 1000000), updated_at = now()
        RETURNING hits`;
      return Number(rows[0].hits);
    },
    async pruneRateBuckets(before) {
      const rows = await query`DELETE FROM print_estimate_rate_buckets WHERE window_start < ${before}::timestamptz RETURNING scope`;
      return rows.length;
    },
    async createAsset(asset) {
      const rows = await query`INSERT INTO print_assets (id, estimate_session_id, blob_path, original_name, format, content_type, declared_size_bytes, retention_expires_at, parent_asset_id, archive_entry)
        VALUES (${asset.id}, ${asset.sessionId}, ${asset.blobPath}, ${asset.originalName}, ${asset.format}, ${asset.contentType}, ${asset.declaredSizeBytes}, ${asset.retentionExpiresAt}::timestamptz, ${asset.parentAssetId ?? null}, ${asset.archiveEntry ?? null})
        RETURNING *`;
      return assetFromRow(rows[0]);
    },
    async findAsset(id) {
      const rows = await query`SELECT * FROM print_assets WHERE id = ${id} LIMIT 1`;
      return rows.length ? assetFromRow(rows[0]) : null;
    },
    async markAssetUploaded(id, sizeBytes) {
      const rows = await query`UPDATE print_assets SET state = 'uploaded', size_bytes = ${sizeBytes}, updated_at = now()
        WHERE id = ${id} AND state = 'pending_upload' RETURNING *`;
      return rows.length ? assetFromRow(rows[0]) : this.findAsset(id);
    },
    async markAssetAnalyzed(id, { sha256, metrics }) {
      const rows = await query`UPDATE print_assets SET state = 'ready', sha256 = ${sha256}, geometry_metrics = ${json(metrics)}::jsonb,
          analysis_error_code = NULL, analysis_error_detail = NULL, updated_at = now()
        WHERE id = ${id} AND state IN ('uploaded','failed') RETURNING *`;
      return rows.length ? assetFromRow(rows[0]) : this.findAsset(id);
    },
    async markAssetFailed(id, { code, detail }) {
      const rows = await query`UPDATE print_assets SET state = 'failed', analysis_error_code = ${code}, analysis_error_detail = ${String(detail ?? "").slice(0, 500)}, updated_at = now()
        WHERE id = ${id} AND state IN ('uploaded','failed') RETURNING *`;
      return rows.length ? assetFromRow(rows[0]) : this.findAsset(id);
    },
    async listChildren(parentId) {
      const rows = await query`SELECT * FROM print_assets WHERE parent_asset_id = ${parentId} ORDER BY archive_entry, id`;
      return rows.map(assetFromRow);
    },
    async selectParts(parentId, selections) {
      const ids = selections.map(item => item.partId);
      const quantities = Object.fromEntries(selections.map(item => [item.partId, item.quantity]));
      const rows = await query`UPDATE print_assets a SET selected = (a.id = ANY(${ids}::text[])),
          quantity = COALESCE((${json(quantities)}::jsonb ->> a.id)::int, 1), updated_at = now()
        WHERE a.parent_asset_id = ${parentId} RETURNING *`;
      return rows.map(assetFromRow).sort((x, y) => String(x.archiveEntry).localeCompare(String(y.archiveEntry)) || x.id.localeCompare(y.id));
    },
    async orphanedParts({ limit = 50 } = {}) {
      const rows = await query`SELECT a.* FROM print_assets a JOIN print_estimate_sessions s ON s.id = a.estimate_session_id
        WHERE a.parent_asset_id IS NOT NULL AND a.selected = false AND s.state = 'attached' AND a.state <> 'deleted'
        ORDER BY a.created_at, a.id LIMIT ${limit}`;
      return rows.map(assetFromRow);
    },

    // Immutable estimate snapshots
    async insertEstimate(row) {
      const rows = await query`INSERT INTO print_estimates (estimate_session_id, asset_id, request_id, purpose, estimator_type, confidence, engine, engine_version,
          profile_id, pricing_model_version, rate_card_version, input_snapshot, geometry_metrics, slicer_metrics, cost_snapshot, pricing_snapshot,
          public_snapshot, price_low_cents, price_high_cents, target_price_cents)
        VALUES (${row.sessionId}, ${row.assetId}, ${row.requestId ?? null}, ${row.purpose}, ${row.estimatorType}, ${row.confidence}, ${row.engine}, ${row.engineVersion},
          ${row.profileId}, ${row.pricingModelVersion}, ${row.rateCardVersion}, ${json(row.input)}::jsonb, ${json(row.geometry)}::jsonb, ${json(row.slicer)}::jsonb,
          ${json(row.cost)}::jsonb, ${json(row.pricing)}::jsonb, ${json(row.public)}::jsonb, ${row.priceLowCents}, ${row.priceHighCents}, ${row.targetPriceCents})
        RETURNING *`;
      return estimateFromRow(rows[0]);
    },
    async listSessionEstimates(sessionId, limit = 20) {
      const rows = await query`SELECT * FROM print_estimates WHERE estimate_session_id = ${sessionId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
      return rows.map(estimateFromRow);
    },
    async findEstimate(id) {
      const rows = await query`SELECT * FROM print_estimates WHERE id = ${id} LIMIT 1`;
      return rows.length ? estimateFromRow(rows[0]) : null;
    },

    // Asynchronous analysis jobs
    async enqueueJob({ assetId, jobType, profileKey, options, maxAttempts = 4 }) {
      await query`INSERT INTO print_analysis_jobs (asset_id, job_type, profile_key, options, max_attempts)
        VALUES (${assetId}, ${jobType}, ${profileKey}, ${json(options)}::jsonb, ${maxAttempts})
        ON CONFLICT (asset_id, job_type, profile_key) WHERE state IN ('pending','processing') DO NOTHING`;
      const rows = await query`SELECT * FROM print_analysis_jobs WHERE asset_id = ${assetId} AND job_type = ${jobType} AND profile_key = ${profileKey}
        ORDER BY id DESC LIMIT 1`;
      return jobFromRow(rows[0]);
    },
    async listAssetJobs(assetId) {
      const rows = await query`SELECT * FROM print_analysis_jobs WHERE asset_id = ${assetId} ORDER BY id DESC LIMIT 20`;
      return rows.map(jobFromRow);
    },
    async claimJobs({ workerId, batchSize = 1, leaseSeconds = 300, jobType = "slice" }) {
      const rows = await query`WITH candidates AS (
          SELECT id FROM print_analysis_jobs
          WHERE job_type = ${jobType} AND state IN ('pending','processing') AND next_attempt_at <= now()
            AND attempt_count < max_attempts AND (lease_expires_at IS NULL OR lease_expires_at <= now())
          ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT ${batchSize}
        ) UPDATE print_analysis_jobs j SET state = 'processing', lease_owner = ${workerId}, attempt_count = j.attempt_count + 1,
            lease_expires_at = now() + make_interval(secs => ${leaseSeconds}), updated_at = now()
          FROM candidates WHERE j.id = candidates.id RETURNING j.*`;
      return rows.map(jobFromRow);
    },
    async completeJob(jobId, workerId, estimateId) {
      const rows = await query`UPDATE print_analysis_jobs SET state = 'ready', result_estimate_id = ${estimateId}, lease_owner = NULL, lease_expires_at = NULL,
          last_error_category = NULL, last_error_detail = NULL, completed_at = now(), updated_at = now()
        WHERE id = ${jobId}::bigint AND lease_owner = ${workerId} AND state = 'processing' RETURNING *`;
      return rows.length ? jobFromRow(rows[0]) : null;
    },
    async failJob(jobId, workerId, { category, detail, retryAt }) {
      const rows = await query`UPDATE print_analysis_jobs SET
          state = CASE WHEN ${retryAt}::timestamptz IS NULL OR attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
          next_attempt_at = COALESCE(${retryAt}::timestamptz, next_attempt_at), lease_owner = NULL, lease_expires_at = NULL,
          last_error_category = ${category}, last_error_detail = ${String(detail ?? "").slice(0, 500)},
          completed_at = CASE WHEN ${retryAt}::timestamptz IS NULL OR attempt_count >= max_attempts THEN now() ELSE NULL END, updated_at = now()
        WHERE id = ${jobId}::bigint AND lease_owner = ${workerId} AND state = 'processing' RETURNING *`;
      return rows.length ? jobFromRow(rows[0]) : null;
    },

    // Attachment (the Neon completion path attaches inside the request/work statement; this is the standalone form)
    async attachSession({ sessionId, ownershipHash, requestId }) {
      const rows = await query`WITH attached AS (
          UPDATE print_estimate_sessions SET request_id = ${requestId}, state = 'attached', attached_at = now(), updated_at = now()
          WHERE id = ${sessionId} AND ownership_hash = ${ownershipHash} AND state = 'open' AND expires_at > now() AND request_id IS NULL
          RETURNING id
        ), assets AS (
          UPDATE print_assets SET request_id = ${requestId}, retention_expires_at = NULL, updated_at = now()
          WHERE estimate_session_id IN (SELECT id FROM attached) AND state IN ('uploaded','ready','failed') RETURNING id
        ), estimates AS (
          UPDATE print_estimates SET request_id = ${requestId}
          WHERE estimate_session_id IN (SELECT id FROM attached) AND request_id IS NULL RETURNING id
        ) SELECT (SELECT count(*) FROM attached) AS sessions, (SELECT count(*) FROM assets) AS assets`;
      return { attached: Number(rows[0].sessions) === 1, assets: Number(rows[0].assets) };
    },

    // Private operator read model
    async forRequest(requestId, { workItemId = null } = {}) {
      const assets = await query`SELECT * FROM print_assets WHERE request_id = ${requestId} ORDER BY created_at, id LIMIT 40`;      const estimates = await query`SELECT * FROM print_estimates WHERE request_id = ${requestId} ORDER BY created_at DESC, id DESC LIMIT 50`;
      const jobs = await query`SELECT j.* FROM print_analysis_jobs j JOIN print_assets a ON a.id = j.asset_id
        WHERE a.request_id = ${requestId} ORDER BY j.id DESC LIMIT 50`;
      const runs = workItemId ? await query`SELECT * FROM print_runs WHERE work_item_id = ${workItemId} ORDER BY created_at DESC, id DESC LIMIT 50` : [];
      return { assets: assets.map(assetFromRow), estimates: estimates.map(estimateFromRow), jobs: jobs.map(jobFromRow), runs: runs.map(runFromRow) };
    },
    async recordRun(run) {
      const rows = await query`INSERT INTO print_runs (work_item_id, estimate_id, printer, actual_grams, actual_machine_hours, active_labor_minutes,
          failed_attempts, completed_quantity, notes, recorded_by)
        VALUES (${run.workItemId}, ${run.estimateId}, ${run.printer}, ${run.actualGrams}, ${run.actualMachineHours}, ${run.activeLaborMinutes},
          ${run.failedAttempts}, ${run.completedQuantity}, ${run.notes}, ${run.recordedBy}) RETURNING *`;
      return runFromRow(rows[0]);
    },

    // Retention and privacy
    async expiredSessions({ limit = 50 } = {}) {
      const sessions = await query`SELECT * FROM print_estimate_sessions WHERE state = 'open' AND expires_at <= now() ORDER BY expires_at, id LIMIT ${limit}`;
      const result = [];
      for (const row of sessions) {
        const assets = await query`SELECT * FROM print_assets WHERE estimate_session_id = ${row.id}`;
        result.push({ session: sessionFromRow(row), assets: assets.map(assetFromRow) });
      }
      return result;
    },
    async deleteUnattachedSession(sessionId) {
      await query`DELETE FROM print_analysis_jobs WHERE asset_id IN (SELECT a.id FROM print_assets a
        JOIN print_estimate_sessions s ON s.id = a.estimate_session_id WHERE s.id = ${sessionId} AND s.request_id IS NULL)`;
      await query`DELETE FROM print_estimates WHERE estimate_session_id = ${sessionId} AND request_id IS NULL
        AND EXISTS (SELECT 1 FROM print_estimate_sessions WHERE id = ${sessionId} AND request_id IS NULL)`;
      await query`DELETE FROM print_assets WHERE estimate_session_id = ${sessionId} AND request_id IS NULL
        AND EXISTS (SELECT 1 FROM print_estimate_sessions WHERE id = ${sessionId} AND request_id IS NULL)`;
      const rows = await query`DELETE FROM print_estimate_sessions WHERE id = ${sessionId} AND request_id IS NULL RETURNING id`;
      return rows.length === 1;
    },
    async staleUnattachedUploads({ olderThan, limit = 50 }) {
      const rows = await query`SELECT * FROM print_assets WHERE request_id IS NULL AND state = 'pending_upload'
        AND created_at <= ${olderThan}::timestamptz ORDER BY created_at, id LIMIT ${limit}`;
      return rows.map(assetFromRow);
    },
    async deleteAssetRecord(assetId) {
      await query`DELETE FROM print_analysis_jobs WHERE asset_id = ${assetId}`;
      await query`DELETE FROM print_estimates WHERE asset_id = ${assetId} AND request_id IS NULL`;
      const rows = await query`DELETE FROM print_assets WHERE id = ${assetId} AND request_id IS NULL RETURNING id`;
      return rows.length === 1;
    },
    async retentionCandidates({ completedBefore, limit = 50 }) {
      const rows = await query`SELECT a.* FROM print_assets a
        JOIN work_items w ON w.request_id = a.request_id
        WHERE a.state <> 'deleted' AND a.retention_hold = false
          AND w.status IN ('completed','declined','cancelled')
          AND COALESCE(w.completed_at, w.updated_at) <= ${completedBefore}::timestamptz
        ORDER BY a.created_at, a.id LIMIT ${limit}`;
      return rows.map(assetFromRow);
    },
    async markAssetDeleted(assetId) {
      const rows = await query`UPDATE print_assets SET state = 'deleted', deleted_at = now(), updated_at = now()
        WHERE id = ${assetId} AND state <> 'deleted' RETURNING *`;
      return rows.length ? assetFromRow(rows[0]) : null;
    },
    async purgeRequest(requestId) {
      const assets = await query`SELECT * FROM print_assets WHERE request_id = ${requestId}
        OR estimate_session_id IN (SELECT id FROM print_estimate_sessions WHERE request_id = ${requestId})`;
      const ids = assets.map(row => row.id);
      await query`DELETE FROM print_analysis_jobs WHERE asset_id = ANY(${ids}::text[])`;
      await query`DELETE FROM print_estimates WHERE request_id = ${requestId} OR asset_id = ANY(${ids}::text[])
        OR estimate_session_id IN (SELECT id FROM print_estimate_sessions WHERE request_id = ${requestId})`;
      await query`DELETE FROM print_assets WHERE id = ANY(${ids}::text[])`;
      await query`DELETE FROM print_estimate_sessions WHERE request_id = ${requestId}`;
      return { assets: assets.map(assetFromRow) };
    }
  };
}
