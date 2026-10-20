-- Private owner-confirmed billing. Server database owner only; no public policies.
CREATE TABLE IF NOT EXISTS invoice_operations (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  work_item_id text NOT NULL UNIQUE REFERENCES work_items(id) ON DELETE RESTRICT,
  work_revision integer NOT NULL CHECK (work_revision > 0),
  actor_id text NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 80000),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','creating','draft','linked','needs_reconciliation','needs_review')),
  provider jsonb,
  error_code text CHECK (error_code IS NULL OR error_code IN ('invoice_provider_unavailable','invoice_review_required','invoice_client_invalid','invoicing_unconfigured')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoice_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_operations FROM PUBLIC;

CREATE OR REPLACE FUNCTION preserve_invoice_operation_intent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
    OR NEW.work_revision IS DISTINCT FROM OLD.work_revision
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
    RAISE EXCEPTION 'Billing intent is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invoice_operation_intent_immutable ON invoice_operations;
CREATE TRIGGER invoice_operation_intent_immutable BEFORE UPDATE ON invoice_operations
FOR EACH ROW EXECUTE FUNCTION preserve_invoice_operation_intent();
