-- Additive, native-platform migration. Do not apply to the fenced Neon source.
ALTER TABLE quick_inquiries ADD COLUMN IF NOT EXISTS project_request_id text REFERENCES service_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS quick_inquiries_project_request_idx ON quick_inquiries(project_request_id);

ALTER TABLE work_items ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'request';
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS inquiry_id text REFERENCES quick_inquiries(id) ON DELETE RESTRICT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS project_draft boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS work_items_inquiry_idx ON work_items(inquiry_id);
CREATE INDEX IF NOT EXISTS work_items_kind_active_idx ON work_items(kind,created_at,id)
  WHERE status NOT IN ('completed','declined','cancelled');
ALTER TABLE work_events ALTER COLUMN request_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='work_items'::regclass AND conname='work_items_source_check') THEN
    ALTER TABLE work_items ADD CONSTRAINT work_items_source_check CHECK (
      (kind='inquiry' AND inquiry_id IS NOT NULL AND request_id IS NULL AND NOT project_draft)
      OR (kind='request' AND request_id IS NOT NULL));
    ALTER TABLE work_items ADD CONSTRAINT work_items_inquiry_state_check CHECK (
      kind<>'inquiry' OR (status IN ('submitted','triage','waiting_customer','completed','declined','cancelled')
        AND (previous_status IS NULL OR previous_status IN ('submitted','triage'))));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_inquiry_work_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE canonical text;
BEGIN
  IF TG_TABLE_NAME='quick_inquiries' THEN
    IF OLD.project_request_id IS NOT NULL AND NEW.project_request_id IS DISTINCT FROM OLD.project_request_id THEN
      RAISE EXCEPTION 'Inquiry project identity is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (OLD.inquiry_id IS NOT NULL AND NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id)
      OR (OLD.request_id IS NOT NULL AND NEW.request_id IS DISTINCT FROM OLD.request_id)
      OR (OLD.kind='request' AND NEW.kind<>'request') THEN
      RAISE EXCEPTION 'Work source identity is immutable';
    END IF;
  END IF;
  IF NEW.kind='request' AND NEW.inquiry_id IS NOT NULL THEN
    SELECT project_request_id INTO canonical FROM quick_inquiries WHERE id=NEW.inquiry_id;
    IF canonical IS DISTINCT FROM NEW.request_id THEN
      RAISE EXCEPTION 'Inquiry must use its canonical project';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inquiry_project_identity ON quick_inquiries;
CREATE TRIGGER inquiry_project_identity BEFORE UPDATE ON quick_inquiries
  FOR EACH ROW EXECUTE FUNCTION guard_inquiry_work_identity();
DROP TRIGGER IF EXISTS inquiry_work_identity ON work_items;
CREATE TRIGGER inquiry_work_identity BEFORE INSERT OR UPDATE ON work_items
  FOR EACH ROW EXECUTE FUNCTION guard_inquiry_work_identity();
REVOKE ALL ON FUNCTION guard_inquiry_work_identity() FROM PUBLIC;

CREATE TABLE IF NOT EXISTS inquiry_handoffs (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  inquiry_id text NOT NULL REFERENCES quick_inquiries(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('operator','customer')),
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '7 days'),
  CHECK (actor_type='operator' OR operator_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS inquiry_handoffs_active_idx ON inquiry_handoffs(inquiry_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS inquiry_handoffs_expiry_idx ON inquiry_handoffs(expires_at);
ALTER TABLE inquiry_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inquiry_handoffs FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
    GRANT USAGE ON SCHEMA public TO platform_backend;
    GRANT SELECT,INSERT,UPDATE,DELETE ON inquiry_handoffs TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON inquiry_handoffs;
    CREATE POLICY platform_backend_access ON inquiry_handoffs TO platform_backend USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Bounded historical repair: retain submission time, no email or push replay.
-- The rollout repeats this bounded operation after the new API is healthy.
WITH missing AS (
  SELECT q.id,q.project_request_id,COALESCE(q.submitted_at,q.created_at) AS submitted_at,
         COALESCE(r.status='draft',false) AS project_draft
  FROM quick_inquiries q LEFT JOIN service_requests r ON r.id=q.project_request_id
  WHERE q.status='submitted' AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.inquiry_id=q.id)
  ORDER BY q.submitted_at,q.id LIMIT 1000
), created AS (
  INSERT INTO work_items(kind,inquiry_id,request_id,project_draft,created_at)
  SELECT CASE WHEN project_request_id IS NULL THEN 'inquiry' ELSE 'request' END,
         id,project_request_id,project_draft,submitted_at FROM missing
  ON CONFLICT (inquiry_id) DO NOTHING RETURNING id,request_id
)
INSERT INTO work_events(work_item_id,request_id,event_type,actor_type,data)
SELECT id,request_id,'work.created','system','{"version":1,"source":"inquiry","backfill":true}'::jsonb FROM created;
