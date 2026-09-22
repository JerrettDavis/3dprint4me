CREATE TABLE IF NOT EXISTS operators (
  id text PRIMARY KEY DEFAULT ('op_' || replace(gen_random_uuid()::text, '-', '')),
  auth_user_id text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  role text NOT NULL DEFAULT 'operator' CHECK (role IN ('owner','operator')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS work_items (
  id text PRIMARY KEY DEFAULT ('work_' || replace(gen_random_uuid()::text, '-', '')),
  request_id text NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','triage','waiting_customer','quoted','approved','scheduled','in_progress','completed','declined','cancelled')),
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('submitted','triage','quoted')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  acknowledged_at timestamptz,
  acknowledged_by text REFERENCES operators(id) ON DELETE SET NULL,
  target_date date,
  assigned_operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS work_notes (
  id text PRIMARY KEY DEFAULT ('note_' || replace(gen_random_uuid()::text, '-', '')),
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE RESTRICT,
  operator_id text REFERENCES operators(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_item_id text NOT NULL REFERENCES work_items(id) ON DELETE RESTRICT,
  request_id text NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 80),
  actor_type text NOT NULL CHECK (actor_type IN ('system','operator')),
  actor_id text REFERENCES operators(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id text PRIMARY KEY DEFAULT ('push_' || replace(gen_random_uuid()::text, '-', '')),
  operator_id text NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  expiration_time bigint,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES work_events(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('new_work','test')),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, kind)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  outbox_id bigint NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  subscription_id text NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','retrying','disabled','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error_category text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outbox_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS work_items_actionable_idx ON work_items (status, priority, created_at, id);
CREATE INDEX IF NOT EXISTS work_items_updated_idx ON work_items (updated_at DESC, id);
CREATE INDEX IF NOT EXISTS work_events_cursor_idx ON work_events (id, work_item_id);
CREATE INDEX IF NOT EXISTS work_notes_item_idx ON work_notes (work_item_id, created_at, id);
CREATE INDEX IF NOT EXISTS push_subscriptions_operator_idx ON push_subscriptions (operator_id, enabled);
CREATE INDEX IF NOT EXISTS notification_outbox_claim_idx ON notification_outbox (state, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS notification_deliveries_claim_idx ON notification_deliveries (state, next_attempt_at, outbox_id);
