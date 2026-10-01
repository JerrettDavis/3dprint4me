-- Database-backed fixed-window counters for anonymous estimate session creation and
-- upload-token issuance (global and per client). Additive and idempotent; no existing
-- table or column is altered. Apply after 001-004 (not applied automatically):
--   node --env-file=.env.production.local scripts/migrate-neon.mjs 005_print_estimate_rate_limits.sql
-- Per-client subjects are salted SHA-256 digests of the caller address, never the raw address.

CREATE TABLE IF NOT EXISTS print_estimate_rate_buckets (
  scope text NOT NULL CHECK (scope IN ('session-create', 'upload-token')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 80),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1 CHECK (hits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject, window_start)
);
CREATE INDEX IF NOT EXISTS print_estimate_rate_buckets_window_idx ON print_estimate_rate_buckets (window_start);
ALTER TABLE print_estimate_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON print_estimate_rate_buckets FROM PUBLIC;
