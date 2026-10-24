-- Additive private partner context. No browser database access or activation.
CREATE TABLE IF NOT EXISTS partner_programs (
 id uuid PRIMARY KEY, label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 starts_on date NOT NULL, ends_on date NOT NULL DEFAULT '2026-12-31',
 enabled boolean NOT NULL DEFAULT false, synthetic boolean NOT NULL DEFAULT false,
 default_weekly_cap_cents integer NOT NULL DEFAULT 20000 CHECK(default_weekly_cap_cents BETWEEN 0 AND 40000),
 max_weekly_cap_cents integer NOT NULL DEFAULT 40000 CHECK(max_weekly_cap_cents=40000),
 timezone text NOT NULL DEFAULT 'America/Chicago' CHECK(timezone='America/Chicago'),
 settings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(settings)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(starts_on<=ends_on AND ends_on<='2026-12-31')
);
CREATE TABLE IF NOT EXISTS partner_accounts (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','suspended','revoked')),
 profile jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(profile)='object'),
 credential_hash text, credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,program_id)
);
CREATE INDEX IF NOT EXISTS partner_accounts_program ON partner_accounts(program_id,status);
CREATE TABLE IF NOT EXISTS partner_invites (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES partner_accounts(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL DEFAULT 'enroll' CHECK(purpose IN ('enroll','recover')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS partner_invites_partner ON partner_invites(partner_id);
CREATE TABLE IF NOT EXISTS partner_sessions (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES partner_accounts(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'), credential_version integer NOT NULL,
 expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at<=absolute_expires_at)
);
CREATE INDEX IF NOT EXISTS partner_sessions_partner ON partner_sessions(partner_id);
CREATE TABLE IF NOT EXISTS partner_rate_limits (
 bucket_hash text PRIMARY KEY CHECK(bucket_hash ~ '^[a-f0-9]{64}$'),
 window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts>0), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_program_weeks (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id),
 week_start_local date NOT NULL CHECK(extract(isodow FROM week_start_local)=1),
 cap_cents integer NOT NULL CHECK(cap_cents BETWEEN 0 AND 40000),
 committed_cents integer NOT NULL DEFAULT 0 CHECK(committed_cents>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(program_id,week_start_local), UNIQUE(id,program_id)
);
CREATE TABLE IF NOT EXISTS partner_campaigns (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused','retired')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,program_id)
);
CREATE INDEX IF NOT EXISTS partner_campaigns_program ON partner_campaigns(program_id,status);
CREATE TABLE IF NOT EXISTS partner_gigs (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id),
 partner_id uuid NOT NULL, campaign_id uuid NOT NULL, program_week_id uuid,
 terms_snapshot jsonb NOT NULL CHECK(jsonb_typeof(terms_snapshot)='object'),
 agreement_issue_id uuid, accepted_fee_cents integer CHECK(accepted_fee_cents>=0), maximum_bonus_cents integer NOT NULL DEFAULT 0 CHECK(maximum_bonus_cents BETWEEN 0 AND 40000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','offered','accepted','declined','withdrawn','expired','submitted','changes_requested','approved','payable','paid','disputed','cancellation_requested','settled','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), accepted_at timestamptz, submitted_at timestamptz, approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,partner_id), UNIQUE(id,program_id), UNIQUE(id,program_week_id),
 FOREIGN KEY(partner_id,program_id) REFERENCES partner_accounts(id,program_id),
 FOREIGN KEY(campaign_id,program_id) REFERENCES partner_campaigns(id,program_id),
 FOREIGN KEY(program_week_id,program_id) REFERENCES partner_program_weeks(id,program_id)
);
CREATE INDEX IF NOT EXISTS partner_gigs_partner ON partner_gigs(partner_id,status,created_at,id);
CREATE INDEX IF NOT EXISTS partner_gigs_campaign ON partner_gigs(campaign_id);
CREATE INDEX IF NOT EXISTS partner_gigs_week ON partner_gigs(program_week_id);
CREATE TABLE IF NOT EXISTS partner_budget_reservations (
 id uuid PRIMARY KEY, program_week_id uuid NOT NULL REFERENCES partner_program_weeks(id),
 gig_id uuid NOT NULL UNIQUE, amount_cents integer NOT NULL CHECK(amount_cents BETWEEN 0 AND 40000),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(gig_id,program_week_id) REFERENCES partner_gigs(id,program_week_id)
);
CREATE INDEX IF NOT EXISTS partner_reservations_week ON partner_budget_reservations(program_week_id);
CREATE TABLE IF NOT EXISTS partner_negotiations (
 id uuid PRIMARY KEY, gig_id uuid NOT NULL, partner_id uuid NOT NULL,
 proposed_fee_cents integer NOT NULL CHECK(proposed_fee_cents BETWEEN 0 AND 40000),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000), actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(gig_id,partner_id) REFERENCES partner_gigs(id,partner_id)
);
CREATE TABLE IF NOT EXISTS partner_visits (
 id uuid PRIMARY KEY, gig_id uuid NOT NULL, partner_id uuid NOT NULL, client_created_id uuid NOT NULL,
 business_name text NOT NULL CHECK(length(business_name) BETWEEN 1 AND 200), business_key text NOT NULL,
 outcome text NOT NULL, details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
 visited_at timestamptz NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 UNIQUE(partner_id,client_created_id), UNIQUE(gig_id,business_key), UNIQUE(id,partner_id),
 FOREIGN KEY(gig_id,partner_id) REFERENCES partner_gigs(id,partner_id)
);
CREATE INDEX IF NOT EXISTS partner_visits_gig ON partner_visits(gig_id);
CREATE TABLE IF NOT EXISTS partner_leads (
 id uuid PRIMARY KEY, visit_id uuid NOT NULL, partner_id uuid NOT NULL,
 contact_data jsonb NOT NULL CHECK(jsonb_typeof(contact_data)='object'), contact_key text NOT NULL,
 consent_text text NOT NULL CHECK(length(trim(consent_text))>0), purpose text NOT NULL CHECK(length(trim(purpose))>0),
 consent_at timestamptz NOT NULL, withdrawn_at timestamptz, deleted_at timestamptz,
 status text NOT NULL DEFAULT 'needs_review' CHECK(status IN ('needs_review','qualified','rejected','withdrawn','deleted')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(visit_id,partner_id) REFERENCES partner_visits(id,partner_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_leads_active_contact ON partner_leads(contact_key) WHERE withdrawn_at IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_leads_active_email ON partner_leads((lower(contact_data->>'email'))) WHERE withdrawn_at IS NULL AND deleted_at IS NULL AND contact_data->>'email' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_leads_active_phone ON partner_leads((contact_data->>'phone')) WHERE withdrawn_at IS NULL AND deleted_at IS NULL AND contact_data->>'phone' IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_leads_partner ON partner_leads(partner_id);
CREATE TABLE IF NOT EXISTS partner_consent_events (
 id uuid PRIMARY KEY, lead_id uuid NOT NULL REFERENCES partner_leads(id), actor_id text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('granted','withdrawn','corrected','deleted')), evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_referrals (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES partner_accounts(id), code text NOT NULL UNIQUE,
 originating_gig_id uuid, policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(originating_gig_id,partner_id) REFERENCES partner_gigs(id,partner_id), UNIQUE(id,partner_id)
);
CREATE TABLE IF NOT EXISTS partner_referral_events (
 id uuid PRIMARY KEY, referral_id uuid NOT NULL, partner_id uuid NOT NULL,
 source_event_id text NOT NULL, event_type text NOT NULL CHECK(event_type IN ('consented_lead','verified_sale','rejected')),
 bonus_policy_version text NOT NULL, amount_cents integer NOT NULL DEFAULT 0 CHECK(amount_cents BETWEEN 0 AND 40000),
 verified_by text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(referral_id,source_event_id,event_type,bonus_policy_version), UNIQUE(id,partner_id),
 FOREIGN KEY(referral_id,partner_id) REFERENCES partner_referrals(id,partner_id)
);
CREATE TABLE IF NOT EXISTS partner_payables (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES partner_accounts(id), gig_id uuid, referral_event_id uuid,
 amount_cents integer NOT NULL CHECK(amount_cents>=0), currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(gig_id), UNIQUE(referral_event_id), UNIQUE(id,partner_id),
 CHECK((gig_id IS NOT NULL)::int+(referral_event_id IS NOT NULL)::int=1),
 FOREIGN KEY(gig_id,partner_id) REFERENCES partner_gigs(id,partner_id),
 FOREIGN KEY(referral_event_id,partner_id) REFERENCES partner_referral_events(id,partner_id)
);
CREATE TABLE IF NOT EXISTS partner_payment_events (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL, payable_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('settled','reversed','adjustment')),
 amount_cents integer NOT NULL CHECK(amount_cents<>0), reverses_event_id uuid REFERENCES partner_payment_events(id),
 payment_reference text NOT NULL, payment_method text NOT NULL, actor_id text NOT NULL,
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key uuid NOT NULL UNIQUE, UNIQUE(id,payable_id,partner_id),
 FOREIGN KEY(reverses_event_id,payable_id,partner_id) REFERENCES partner_payment_events(id,payable_id,partner_id), FOREIGN KEY(payable_id,partner_id) REFERENCES partner_payables(id,partner_id),
 CHECK((event_type='settled' AND amount_cents>0 AND reverses_event_id IS NULL) OR (event_type='reversed' AND amount_cents<0 AND reverses_event_id IS NOT NULL) OR event_type='adjustment')
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_single_reversal ON partner_payment_events(reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_payments_payable ON partner_payment_events(payable_id);
CREATE TABLE IF NOT EXISTS partner_material_events (
 id uuid PRIMARY KEY, gig_id uuid NOT NULL REFERENCES partner_gigs(id), event_type text NOT NULL CHECK(event_type IN ('issued','returned')),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'), actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_legal_documents (
 id uuid PRIMARY KEY, template_key text NOT NULL UNIQUE, title text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','changes_requested','reviewed','published','retired')),
 active_version_id uuid, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_legal_versions (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES partner_legal_documents(id), version_no integer NOT NULL CHECK(version_no>0),
 title text NOT NULL DEFAULT 'Review document', issuable boolean NOT NULL DEFAULT false,
 required_scopes jsonb NOT NULL DEFAULT '["agreement_language"]' CHECK(jsonb_typeof(required_scopes)='array'),
 markdown text NOT NULL CHECK(length(markdown)<=200000), variables_schema jsonb NOT NULL CHECK(jsonb_typeof(variables_schema)='object'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'), authored_by text NOT NULL,
 base_version_id uuid REFERENCES partner_legal_versions(id), change_reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,version_no), UNIQUE(id,document_id)
);
CREATE TABLE IF NOT EXISTS partner_legal_reviews (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES partner_legal_versions(id),
 scope text NOT NULL CHECK(scope IN ('classification','agreement_language','solicitation_policy','accounting')),
 decision text NOT NULL CHECK(decision IN ('approved','conditional','changes_requested','rejected')),
 package_id uuid, reviewer_role text CHECK(reviewer_role IN ('attorney','cpa')),
 reviewer_name text NOT NULL, evidence_ref text NOT NULL, notes text NOT NULL DEFAULT '',
 actor_id text NOT NULL, reviewed_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS partner_legal_reviews_version ON partner_legal_reviews(version_id,scope);
CREATE TABLE IF NOT EXISTS partner_legal_comments (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES partner_legal_versions(id),
 clause_anchor text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 reviewer_id text NOT NULL, resolves_comment_id uuid REFERENCES partner_legal_comments(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_review_packages (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES partner_legal_versions(id),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'), created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_review_artifacts (
 package_id uuid PRIMARY KEY REFERENCES partner_review_packages(id),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 8388608),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL CHECK(filename ~ '^review-[a-f0-9-]+[.]zip$'),
 manifest_signature text NOT NULL, public_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_agreement_issues (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES partner_legal_versions(id), partner_id uuid NOT NULL REFERENCES partner_accounts(id),
 snapshot_markdown text NOT NULL, bindings jsonb NOT NULL CHECK(jsonb_typeof(bindings)='object'),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'), issued_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,partner_id), UNIQUE(id,partner_id,snapshot_sha256)
);
CREATE TABLE IF NOT EXISTS partner_agreement_acknowledgments (
 id uuid PRIMARY KEY, issue_id uuid NOT NULL UNIQUE, partner_id uuid NOT NULL, snapshot_sha256 text NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(issue_id,partner_id,snapshot_sha256) REFERENCES partner_agreement_issues(id,partner_id,snapshot_sha256)
);
CREATE TABLE IF NOT EXISTS partner_activity_sessions (
 id uuid PRIMARY KEY, partner_id uuid NOT NULL REFERENCES partner_accounts(id),
 started_at timestamptz NOT NULL, ended_at timestamptz, paused_at timestamptz, running_since timestamptz, elapsed_seconds integer NOT NULL DEFAULT 0 CHECK(elapsed_seconds>=0),
 optional boolean NOT NULL DEFAULT true CHECK(optional=true), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_activity_one_open ON partner_activity_sessions(partner_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS partner_command_keys (
 actor_id text NOT NULL, operation text NOT NULL, idempotency_key uuid NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'), response_json jsonb, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation,idempotency_key)
);
CREATE TABLE IF NOT EXISTS partner_audit_events (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id), actor_kind text NOT NULL CHECK(actor_kind IN ('OWNER','PARTNER','SYSTEM')),
 actor_id text NOT NULL, action text NOT NULL, entity_kind text NOT NULL, entity_id text NOT NULL,
 minimal_diff jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(minimal_diff)='object'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_audit_program ON partner_audit_events(program_id,created_at,id);
CREATE TABLE IF NOT EXISTS partner_outbox (
 id uuid PRIMARY KEY, event_id uuid NOT NULL UNIQUE REFERENCES partner_audit_events(id),
 event_type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(payload)='object'),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), available_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, lease_until timestamptz, failure_code text
);
CREATE TABLE IF NOT EXISTS partner_export_batches (
 id uuid PRIMARY KEY, actor_id text NOT NULL, program_id uuid NOT NULL REFERENCES partner_programs(id),
 kind text NOT NULL CHECK(kind IN ('accounting','statement','own_data')), manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS partner_work_events (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id), gig_id uuid, partner_id uuid,
 event_type text NOT NULL, actor_kind text NOT NULL CHECK(actor_kind IN ('OWNER','PARTNER','SYSTEM')), actor_id text NOT NULL,
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000), data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(gig_id,partner_id) REFERENCES partner_gigs(id,partner_id)
);
CREATE INDEX IF NOT EXISTS partner_work_events_gig ON partner_work_events(gig_id,created_at,id);
CREATE TABLE IF NOT EXISTS partner_payable_adjustments (
 id uuid PRIMARY KEY, payable_id uuid NOT NULL REFERENCES partner_payables(id), amount_cents integer NOT NULL CHECK(amount_cents<>0),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), resolution_reference text NOT NULL,
 partner_acknowledged boolean NOT NULL CHECK(partner_acknowledged=true), verified_resolution boolean NOT NULL CHECK(verified_resolution=true),
 actor_id text NOT NULL, occurred_at timestamptz NOT NULL, UNIQUE(payable_id,resolution_reference)
);
CREATE INDEX IF NOT EXISTS partner_adjustments_payable ON partner_payable_adjustments(payable_id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_proof_once ON partner_payment_events(payable_id,(lower(btrim(payment_reference)))) WHERE event_type='settled';
CREATE TABLE IF NOT EXISTS partner_export_entries (
 id uuid PRIMARY KEY, program_id uuid NOT NULL REFERENCES partner_programs(id), batch_id uuid NOT NULL REFERENCES partner_export_batches(id),
 basis text NOT NULL CHECK(basis IN ('cash','accrual')), source_kind text NOT NULL CHECK(source_kind IN ('payable','adjustment','payment')),
 source_id uuid NOT NULL, UNIQUE(program_id,basis,source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS partner_export_payloads (
 batch_id uuid PRIMARY KEY REFERENCES partner_export_batches(id), partner_id uuid NOT NULL REFERENCES partner_accounts(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), expires_at timestamptz NOT NULL,
 invalidated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_export_payloads_expiry ON partner_export_payloads(expires_at,batch_id) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS partner_export_payloads_partner ON partner_export_payloads(partner_id) WHERE invalidated_at IS NULL;
-- Immutable evidence is corrected by new records, never overwritten or deleted.
CREATE OR REPLACE FUNCTION partner_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Partner evidence is immutable'; END;
$$;
DO $$
DECLARE table_name text; immutable boolean;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['partner_programs','partner_accounts','partner_invites','partner_sessions','partner_rate_limits','partner_program_weeks','partner_campaigns','partner_gigs','partner_budget_reservations','partner_negotiations','partner_visits','partner_leads','partner_consent_events','partner_referrals','partner_referral_events','partner_payables','partner_payment_events','partner_material_events','partner_legal_documents','partner_legal_versions','partner_legal_reviews','partner_legal_comments','partner_review_packages','partner_review_artifacts','partner_agreement_issues','partner_agreement_acknowledgments','partner_activity_sessions','partner_command_keys','partner_audit_events','partner_outbox','partner_export_batches','partner_work_events','partner_payable_adjustments','partner_export_entries','partner_export_payloads'] LOOP
  immutable := table_name=ANY(ARRAY['partner_budget_reservations','partner_negotiations','partner_consent_events','partner_referral_events','partner_payables','partner_payment_events','partner_material_events','partner_legal_versions','partner_legal_reviews','partner_legal_comments','partner_review_packages','partner_review_artifacts','partner_agreement_issues','partner_agreement_acknowledgments','partner_audit_events','partner_export_batches','partner_work_events','partner_payable_adjustments','partner_export_entries']);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
  IF immutable THEN
   EXECUTE format('DROP TRIGGER IF EXISTS partner_immutable ON %I',table_name);
   EXECUTE format('CREATE TRIGGER partner_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation()',table_name);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
   EXECUTE format('REVOKE ALL ON %I FROM platform_backend',table_name);
   EXECUTE format('GRANT SELECT,INSERT ON %I TO platform_backend',table_name);
   IF NOT immutable THEN EXECUTE format('GRANT UPDATE ON %I TO platform_backend',table_name); END IF;
   EXECUTE format('DROP POLICY IF EXISTS platform_backend_access ON %I',table_name);
   EXECUTE format('CREATE POLICY platform_backend_access ON %I TO platform_backend USING(true) WITH CHECK(true)',table_name);
  END IF;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION partner_reject_evidence_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION partner_protect_accepted_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.accepted_at IS NOT NULL AND (NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot OR NEW.accepted_fee_cents IS DISTINCT FROM OLD.accepted_fee_cents OR NEW.maximum_bonus_cents IS DISTINCT FROM OLD.maximum_bonus_cents OR NEW.program_week_id IS DISTINCT FROM OLD.program_week_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.agreement_issue_id IS DISTINCT FROM OLD.agreement_issue_id) THEN
  RAISE EXCEPTION 'Accepted gig terms are immutable';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS partner_accepted_terms ON partner_gigs;
CREATE TRIGGER partner_accepted_terms BEFORE UPDATE ON partner_gigs FOR EACH ROW EXECUTE FUNCTION partner_protect_accepted_terms();
REVOKE ALL ON FUNCTION partner_protect_accepted_terms() FROM PUBLIC;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='partner_document_active_version' AND conrelid='partner_legal_documents'::regclass) THEN
  ALTER TABLE partner_legal_documents ADD CONSTRAINT partner_document_active_version FOREIGN KEY(active_version_id,id) REFERENCES partner_legal_versions(id,document_id);
 END IF;
END;
$$;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
  GRANT DELETE ON partner_activity_sessions TO platform_backend;
 END IF;
END;
$$;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='partner_gig_issued_agreement' AND conrelid='partner_gigs'::regclass) THEN
  ALTER TABLE partner_gigs ADD CONSTRAINT partner_gig_issued_agreement FOREIGN KEY(agreement_issue_id,partner_id) REFERENCES partner_agreement_issues(id,partner_id);
 END IF;
END;
$$;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='partner_review_package_provenance' AND conrelid='partner_legal_reviews'::regclass) THEN
  ALTER TABLE partner_legal_reviews ADD CONSTRAINT partner_review_package_provenance FOREIGN KEY(package_id) REFERENCES partner_review_packages(id);
 END IF;
END;
$$;
