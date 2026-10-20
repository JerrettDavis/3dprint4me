-- Native production only. Provision the non-login platform_backend group before
-- applying this migration; login credentials live exclusively in private config.
CREATE TABLE IF NOT EXISTS operator_identity_bindings (
  issuer text NOT NULL CHECK (char_length(issuer) BETWEEN 8 AND 512),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer,subject),
  UNIQUE (operator_id,issuer,subject)
);
CREATE INDEX IF NOT EXISTS operator_identity_operator_idx ON operator_identity_bindings(operator_id);
CREATE TABLE IF NOT EXISTS operator_login_flows (
  cookie_hash text PRIMARY KEY CHECK (cookie_hash ~ '^[a-f0-9]{64}$'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (char_length(state) BETWEEN 16 AND 256),
  nonce text NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 256),
  verifier text NOT NULL CHECK (char_length(verifier) BETWEEN 43 AND 128),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS operator_login_expiry_idx ON operator_login_flows(expires_at);
CREATE TABLE IF NOT EXISTS operator_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  operator_id text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operator_id,issuer,subject) REFERENCES operator_identity_bindings(operator_id,issuer,subject) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS operator_session_expiry_idx ON operator_sessions(expires_at);
CREATE INDEX IF NOT EXISTS operator_session_identity_idx ON operator_sessions(operator_id,issuer,subject);
CREATE TABLE IF NOT EXISTS platform_proxy_nonces (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9_-]{32,96}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_nonce_expiry_idx ON platform_proxy_nonces(expires_at);
CREATE TABLE IF NOT EXISTS platform_job_leases (
  name text PRIMARY KEY CHECK (name IN ('model-retention','auth-expiry')),
  worker_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Serialize capacity checks across API processes, and fail closed at the bound.
CREATE OR REPLACE FUNCTION platform_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='platform_proxy_nonces' THEN
    PERFORM pg_advisory_xact_lock(315031,1);
    IF (SELECT count(*) FROM platform_proxy_nonces)>=10000 THEN RAISE EXCEPTION 'Replay storage capacity reached'; END IF;
  ELSIF TG_TABLE_NAME='operator_login_flows' THEN
    PERFORM pg_advisory_xact_lock(315031,2);
    IF (SELECT count(*) FROM operator_login_flows)>=1000 THEN RAISE EXCEPTION 'Login storage capacity reached'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS platform_nonce_capacity ON platform_proxy_nonces;
CREATE TRIGGER platform_nonce_capacity BEFORE INSERT ON platform_proxy_nonces FOR EACH ROW EXECUTE FUNCTION platform_capacity_guard();
DROP TRIGGER IF EXISTS platform_login_capacity ON operator_login_flows;
CREATE TRIGGER platform_login_capacity BEFORE INSERT ON operator_login_flows FOR EACH ROW EXECUTE FUNCTION platform_capacity_guard();

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO platform_backend;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO platform_backend;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO platform_backend;
REVOKE INSERT,UPDATE,DELETE ON operators FROM platform_backend;
GRANT UPDATE(last_seen_at,updated_at) ON operators TO platform_backend;
REVOKE INSERT,UPDATE,DELETE ON operator_identity_bindings FROM platform_backend;

-- These are backend-role policies. Per-operator access remains enforced by the
-- application; browsers never receive a database credential or database endpoint.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.tablename);
    EXECUTE format('DROP POLICY IF EXISTS platform_backend_access ON public.%I',item.tablename);
    EXECUTE format('CREATE POLICY platform_backend_access ON public.%I TO platform_backend USING (true) WITH CHECK (true)',item.tablename);
  END LOOP;
END;
$$;
