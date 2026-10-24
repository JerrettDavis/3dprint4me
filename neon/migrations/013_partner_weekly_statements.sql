-- Private immutable balance snapshots; no activation, email or payment.
CREATE TABLE IF NOT EXISTS partner_weekly_statements (
 id uuid PRIMARY KEY,
 program_id uuid NOT NULL REFERENCES partner_programs(id),
 partner_id uuid NOT NULL,
 week_start_local date NOT NULL CHECK(extract(isodow FROM week_start_local)=1),
 generated_at timestamptz NOT NULL,
 record_count integer NOT NULL CHECK(record_count BETWEEN 0 AND 10000),
 csv text NOT NULL CHECK(octet_length(csv)<=5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(partner_id,program_id) REFERENCES partner_accounts(id,program_id),
 UNIQUE(partner_id,week_start_local)
);
CREATE INDEX IF NOT EXISTS partner_weekly_statements_program ON partner_weekly_statements(program_id,week_start_local DESC,id);
CREATE INDEX IF NOT EXISTS partner_weekly_statements_history ON partner_weekly_statements(week_start_local DESC,id DESC);
REVOKE ALL ON partner_weekly_statements FROM PUBLIC;
DROP TRIGGER IF EXISTS partner_immutable ON partner_weekly_statements;
CREATE TRIGGER partner_immutable BEFORE UPDATE OR DELETE ON partner_weekly_statements
 FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
  REVOKE ALL ON partner_weekly_statements FROM platform_backend;
  GRANT SELECT,INSERT ON partner_weekly_statements TO platform_backend;
 END IF;
END $$;
