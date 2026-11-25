-- Private invoice read model and recoverable notification delivery. No browser grants.
CREATE TABLE IF NOT EXISTS invoice_tracking_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  settings jsonb NOT NULL DEFAULT '{"timeZone":"America/Chicago","notificationsEnabled":false,"taxSchedule":null,"taxPeriods":[],"workBilling":[]}'::jsonb
    CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 1048576),
  snapshot jsonb CHECK (snapshot IS NULL OR (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 8388608)),
  last_successful_at timestamptz,
  last_attempt_at timestamptz,
  error_category text CHECK (error_category IN ('provider_unavailable', 'source_changed')),
  sync_token text CHECK (sync_token IS NULL OR sync_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  sync_lease_until timestamptz,
  CHECK ((sync_token IS NULL) = (sync_lease_until IS NULL))
);
INSERT INTO invoice_tracking_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS invoice_tracking_events (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8192),
  delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'leased', 'delivered', 'suppressed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token text CHECK (lease_token IS NULL OR lease_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  lease_until timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK ((delivery_state = 'leased') = (lease_token IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS invoice_tracking_events_pending ON invoice_tracking_events(available_at, id) WHERE delivery_state = 'pending';
CREATE INDEX IF NOT EXISTS invoice_tracking_events_expired ON invoice_tracking_events(lease_until, id) WHERE delivery_state = 'leased';

CREATE TABLE IF NOT EXISTS invoice_tracking_commands (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{8,128}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 200),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  command jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(command) = 'object' AND octet_length(command::text) <= 8192),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoice_tracking_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_tracking_commands ENABLE ROW LEVEL SECURITY;
-- The schema owner retains complete backup access; the runtime is a separate role.
ALTER TABLE invoice_tracking_state NO FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_tracking_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE invoice_tracking_commands NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_tracking_state, invoice_tracking_events, invoice_tracking_commands FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_backend') THEN
    GRANT SELECT, INSERT, UPDATE ON invoice_tracking_state, invoice_tracking_events, invoice_tracking_commands TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON invoice_tracking_state;
    CREATE POLICY platform_backend_access ON invoice_tracking_state TO platform_backend USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS platform_backend_access ON invoice_tracking_events;
    CREATE POLICY platform_backend_access ON invoice_tracking_events TO platform_backend USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS platform_backend_access ON invoice_tracking_commands;
    CREATE POLICY platform_backend_access ON invoice_tracking_commands TO platform_backend USING (true) WITH CHECK (true);
  END IF;
END $$;
