CREATE TABLE IF NOT EXISTS service_requests (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','quoted','approved','in_progress','completed','declined','cancelled')),
  service text NOT NULL CHECK (service IN ('print','design','repair','consult')),
  project_title text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_requests_created_at_idx ON service_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_email_idx ON service_requests (lower(contact_email));
