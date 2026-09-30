-- Print estimation, private model assets, and filament cost basis.
-- Additive only: no existing table or column is altered. Apply after 001-003:
--   node --env-file=.env.production.local scripts/migrate-neon.mjs 004_print_estimation.sql

-- Private filament cost basis. Landed cost per kg is derived, never entered twice.
CREATE TABLE IF NOT EXISTS filament_inventory (
  id text PRIMARY KEY DEFAULT ('fil_' || replace(gen_random_uuid()::text, '-', '')),
  material text NOT NULL CHECK (material ~ '^[a-z0-9-]{2,40}$'),
  brand_line text CHECK (brand_line IS NULL OR char_length(brand_line) <= 120),
  color text CHECK (color IS NULL OR char_length(color) <= 80),
  spool_nominal_grams integer NOT NULL CHECK (spool_nominal_grams BETWEEN 1 AND 100000),
  purchase_cost_cents integer NOT NULL CHECK (purchase_cost_cents BETWEEN 0 AND 10000000),
  freight_fee_cents integer NOT NULL DEFAULT 0 CHECK (freight_fee_cents BETWEEN 0 AND 10000000),
  landed_cents_per_kg numeric GENERATED ALWAYS AS (((purchase_cost_cents + freight_fee_cents)::numeric * 1000) / spool_nominal_grams) STORED,
  on_hand_grams integer NOT NULL DEFAULT 0 CHECK (on_hand_grams BETWEEN 0 AND 10000000),
  active boolean NOT NULL DEFAULT true,
  estimate_default boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS filament_inventory_material_idx
  ON filament_inventory (material, active, estimate_default, updated_at DESC);
ALTER TABLE filament_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON filament_inventory FROM PUBLIC;

-- Anonymous pre-submit estimate sessions. Ownership is a capability token whose
-- SHA-256 hash is stored; attaching to a request ends the customer capability.
CREATE TABLE IF NOT EXISTS print_estimate_sessions (
  id text PRIMARY KEY CHECK (id ~ '^est_[a-f0-9]{32}$'),
  ownership_hash text NOT NULL CHECK (ownership_hash ~ '^[a-f0-9]{64}$'),
  request_id text UNIQUE REFERENCES service_requests(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','attached','expired')),
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  attached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_estimate_sessions_expiry_idx ON print_estimate_sessions (state, expires_at);
ALTER TABLE print_estimate_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_estimate_sessions FROM PUBLIC;

-- One row per privately uploaded model. The Blob path is private operator data.
CREATE TABLE IF NOT EXISTS print_assets (
  id text PRIMARY KEY CHECK (id ~ '^asset_[a-f0-9]{32}$'),
  estimate_session_id text NOT NULL REFERENCES print_estimate_sessions(id) ON DELETE RESTRICT,
  request_id text REFERENCES service_requests(id) ON DELETE RESTRICT,
  blob_path text NOT NULL UNIQUE CHECK (blob_path LIKE 'print-estimates/%' AND blob_path NOT LIKE '%..%'),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  format text NOT NULL CHECK (format IN ('stl','3mf')),
  content_type text CHECK (content_type IS NULL OR char_length(content_type) <= 160),
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes > 0),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes > 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending_upload' CHECK (state IN ('pending_upload','uploaded','ready','failed','deleted')),
  geometry_metrics jsonb,
  analysis_error_code text CHECK (analysis_error_code IS NULL OR char_length(analysis_error_code) <= 64),
  analysis_error_detail text CHECK (analysis_error_detail IS NULL OR char_length(analysis_error_detail) <= 500),
  retention_expires_at timestamptz,
  retention_hold boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_assets_request_idx ON print_assets (request_id, created_at);
CREATE INDEX IF NOT EXISTS print_assets_session_idx ON print_assets (estimate_session_id, created_at);
CREATE INDEX IF NOT EXISTS print_assets_retention_idx ON print_assets (state, retention_expires_at);
ALTER TABLE print_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_assets FROM PUBLIC;

-- Immutable, versioned calculation snapshots. A new analysis inserts a new row.
CREATE TABLE IF NOT EXISTS print_estimates (
  id text PRIMARY KEY DEFAULT ('pest_' || replace(gen_random_uuid()::text, '-', '')),
  estimate_session_id text REFERENCES print_estimate_sessions(id) ON DELETE RESTRICT,
  asset_id text REFERENCES print_assets(id) ON DELETE RESTRICT,
  request_id text REFERENCES service_requests(id) ON DELETE RESTRICT,
  purpose text NOT NULL DEFAULT 'preview' CHECK (purpose IN ('preview','submission','slice','operator')),
  estimator_type text NOT NULL CHECK (estimator_type IN ('manual','size','geometry','slicer','catalog')),
  confidence text NOT NULL CHECK (confidence IN ('rough','better','high')),
  engine text CHECK (engine IS NULL OR char_length(engine) <= 80),
  engine_version text CHECK (engine_version IS NULL OR char_length(engine_version) <= 80),
  profile_id text CHECK (profile_id IS NULL OR char_length(profile_id) <= 160),
  pricing_model_version text NOT NULL,
  rate_card_version text NOT NULL,
  input_snapshot jsonb NOT NULL,
  geometry_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  slicer_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_snapshot jsonb NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  public_snapshot jsonb NOT NULL,
  price_low_cents integer NOT NULL CHECK (price_low_cents >= 0),
  price_high_cents integer NOT NULL CHECK (price_high_cents >= price_low_cents),
  target_price_cents integer NOT NULL CHECK (target_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_estimates_request_idx ON print_estimates (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS print_estimates_session_idx ON print_estimates (estimate_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS print_estimates_asset_idx ON print_estimates (asset_id, created_at DESC);
ALTER TABLE print_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_estimates FROM PUBLIC;

-- Snapshots never change. The only permitted update links a snapshot to its request once.
CREATE OR REPLACE FUNCTION print_estimates_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'request_id') IS DISTINCT FROM (to_jsonb(OLD) - 'request_id')
     OR (OLD.request_id IS NOT NULL AND NEW.request_id IS DISTINCT FROM OLD.request_id) THEN
    RAISE EXCEPTION 'print estimate snapshots are immutable';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS print_estimates_immutable ON print_estimates;
CREATE TRIGGER print_estimates_immutable BEFORE UPDATE ON print_estimates
  FOR EACH ROW EXECUTE FUNCTION print_estimates_immutable();

-- Durable asynchronous analysis/slice queue with bounded retries and leases.
CREATE TABLE IF NOT EXISTS print_analysis_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id text NOT NULL REFERENCES print_assets(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN ('geometry','slice')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','ready','failed','cancelled')),
  profile_key text NOT NULL CHECK (char_length(profile_key) BETWEEN 1 AND 160),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_category text CHECK (last_error_category IS NULL OR char_length(last_error_category) <= 64),
  last_error_detail text CHECK (last_error_detail IS NULL OR char_length(last_error_detail) <= 500),
  result_estimate_id text REFERENCES print_estimates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS print_analysis_jobs_claim_idx ON print_analysis_jobs (state, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS print_analysis_jobs_asset_idx ON print_analysis_jobs (asset_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS print_analysis_jobs_active_profile_idx
  ON print_analysis_jobs (asset_id, job_type, profile_key) WHERE state IN ('pending','processing');
ALTER TABLE print_analysis_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_analysis_jobs FROM PUBLIC;

-- Actual production results for estimated-versus-actual calibration.
CREATE TABLE IF NOT EXISTS print_runs (
  id text PRIMARY KEY DEFAULT ('run_' || replace(gen_random_uuid()::text, '-', '')),
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE RESTRICT,
  estimate_id text REFERENCES print_estimates(id) ON DELETE SET NULL,
  printer text CHECK (printer IS NULL OR char_length(printer) <= 120),
  actual_grams numeric CHECK (actual_grams IS NULL OR actual_grams >= 0),
  actual_machine_hours numeric CHECK (actual_machine_hours IS NULL OR actual_machine_hours >= 0),
  active_labor_minutes integer CHECK (active_labor_minutes IS NULL OR active_labor_minutes >= 0),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  completed_quantity integer CHECK (completed_quantity IS NULL OR completed_quantity >= 0),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  recorded_by text REFERENCES operators(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS print_runs_work_idx ON print_runs (work_item_id, created_at);
ALTER TABLE print_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_runs FROM PUBLIC;
