-- Spoolman spool <-> Invoice Ninja expense ledger and received-payment log. Backend-only.
CREATE TABLE IF NOT EXISTS supply_ledger (
  key text PRIMARY KEY CHECK (key ~ '^spoolman:[a-zA-Z0-9_-]{1,64}:[0-9]{1,9}$'),
  status text NOT NULL CHECK (status IN ('pending','synced')),
  expense_id text CHECK (expense_id IS NULL OR expense_id ~ '^[A-Za-z0-9]{4,64}$'),
  alerted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'synced' OR expense_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS expected_payment_receipts (
  id bigserial PRIMARY KEY,
  payer text NOT NULL,
  received_on date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  invoice_ninja_payment_id text,
  UNIQUE (payer, received_on)
);
CREATE TABLE IF NOT EXISTS bookkeeping_alerts (key text PRIMARY KEY, sent_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE bookkeeping_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bookkeeping_alerts FROM PUBLIC;
ALTER TABLE supply_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE expected_payment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supply_ledger, expected_payment_receipts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON supply_ledger, expected_payment_receipts, bookkeeping_alerts TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON bookkeeping_alerts;
    CREATE POLICY platform_backend_access ON bookkeeping_alerts TO platform_backend USING (true) WITH CHECK (true);
    GRANT USAGE ON SEQUENCE expected_payment_receipts_id_seq TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON supply_ledger;
    CREATE POLICY platform_backend_access ON supply_ledger TO platform_backend USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS platform_backend_access ON expected_payment_receipts;
    CREATE POLICY platform_backend_access ON expected_payment_receipts TO platform_backend USING (true) WITH CHECK (true);
  END IF;
END $$;
