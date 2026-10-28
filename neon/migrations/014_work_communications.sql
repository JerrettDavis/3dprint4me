-- Private shop conversation. Provider payload is frozen for idempotent retries.
CREATE TABLE IF NOT EXISTS work_communications (
 id text PRIMARY KEY,
 work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE RESTRICT,
 operator_id text NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
 command_id text NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('email','comment')),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 8000),
 recipient text,
 subject text,
 envelope jsonb,
 state text NOT NULL CHECK(state IN ('private','pending','sending','sent','failed','uncertain','unconfigured')),
 author text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 first_attempt_at timestamptz,
 last_attempt_at timestamptz,
 claim_id text,
 UNIQUE(work_item_id,operator_id,command_id),
 CHECK((kind='comment' AND state='private' AND recipient IS NULL AND envelope IS NULL) OR (kind='email' AND state<>'private' AND recipient IS NOT NULL AND envelope IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS work_communications_history ON work_communications(work_item_id,created_at,id);
REVOKE ALL ON work_communications FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON work_communications TO platform_backend;
 END IF;
END $$;
