-- Separate neutral intake; no service selection, estimates, payment, or public access.
CREATE TABLE IF NOT EXISTS quick_inquiries (
  id text PRIMARY KEY,
  key_hash text NOT NULL UNIQUE CHECK (length(key_hash)=64),
  payload_hash text NOT NULL CHECK (length(payload_hash)=64),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  inquiry jsonb NOT NULL,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  notification_status text NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending','sending','sent','failed')),
  notification_attempts integer NOT NULL DEFAULT 0 CHECK (notification_attempts BETWEEN 0 AND 3),
  notification_started_at timestamptz,
  notification_last_at timestamptz,
  notification_payload jsonb
);
CREATE INDEX IF NOT EXISTS quick_inquiries_submitted_at_idx ON quick_inquiries (submitted_at) WHERE status='submitted';
ALTER TABLE quick_inquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quick_inquiries FROM PUBLIC;
CREATE TABLE IF NOT EXISTS inquiry_rate_limits (
  key_hash text PRIMARY KEY,
  bucket timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);
ALTER TABLE inquiry_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inquiry_rate_limits FROM PUBLIC;
