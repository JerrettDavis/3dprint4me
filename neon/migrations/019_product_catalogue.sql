-- Private merchandising state. Public shop data is a reviewed static projection.
CREATE TABLE IF NOT EXISTS product_catalogue_drafts (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100 AND id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  revision integer NOT NULL CHECK (revision > 0),
  source_work_item_id text REFERENCES work_items(id) ON DELETE RESTRICT,
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object' AND draft->>'id' = id AND (draft->>'revision')::integer = revision),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_catalogue_commands (
  product_id text NOT NULL REFERENCES product_catalogue_drafts(id) ON DELETE RESTRICT,
  command_id text NOT NULL CHECK (char_length(command_id) BETWEEN 1 AND 100),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, command_id)
);

CREATE TABLE IF NOT EXISTS product_catalogue_jobs (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES product_catalogue_drafts(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cancelled')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_catalogue_jobs_queued ON product_catalogue_jobs (available_at, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS product_catalogue_jobs_expired ON product_catalogue_jobs (lease_until, id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS product_catalogue_jobs_product ON product_catalogue_jobs (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_catalogue_drafts_source ON product_catalogue_drafts (source_work_item_id) WHERE source_work_item_id IS NOT NULL;

-- Match the platform backup boundary: the non-runtime schema owner can dump
-- complete tables; runtime roles still require the backend policy below.
ALTER TABLE product_catalogue_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalogue_drafts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_catalogue_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalogue_commands NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_catalogue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalogue_jobs NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON product_catalogue_drafts, product_catalogue_commands, product_catalogue_jobs FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_backend') THEN
    GRANT SELECT, INSERT, UPDATE ON product_catalogue_drafts, product_catalogue_commands, product_catalogue_jobs TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON product_catalogue_drafts;
    CREATE POLICY platform_backend_access ON product_catalogue_drafts TO platform_backend USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS platform_backend_access ON product_catalogue_commands;
    CREATE POLICY platform_backend_access ON product_catalogue_commands TO platform_backend USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS platform_backend_access ON product_catalogue_jobs;
    CREATE POLICY platform_backend_access ON product_catalogue_jobs TO platform_backend USING (true) WITH CHECK (true);
  END IF;
END $$;
