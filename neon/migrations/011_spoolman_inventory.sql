-- Imported source state is separate from local overrides. Manual contracts remain strict.
ALTER TABLE filament_inventory ADD COLUMN IF NOT EXISTS source jsonb CHECK (source IS NULL OR jsonb_typeof(source) = 'object');
ALTER TABLE filament_inventory ADD COLUMN IF NOT EXISTS cost_override_cents integer CHECK (cost_override_cents BETWEEN 0 AND 10000000);
ALTER TABLE filament_inventory ALTER COLUMN spool_nominal_grams DROP NOT NULL;
ALTER TABLE filament_inventory ALTER COLUMN purchase_cost_cents DROP NOT NULL;
ALTER TABLE filament_inventory ALTER COLUMN on_hand_grams DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='filament_inventory'::regclass AND conname='filament_manual_values') THEN
    ALTER TABLE filament_inventory ADD CONSTRAINT filament_manual_values CHECK (source IS NOT NULL OR (spool_nominal_grams IS NOT NULL AND purchase_cost_cents IS NOT NULL AND on_hand_grams IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS filament_spoolman_identity ON filament_inventory ((source->>'instanceId'), (source->>'spoolId')) WHERE source IS NOT NULL;
CREATE TABLE IF NOT EXISTS spoolman_sync_state (
  id integer PRIMARY KEY CHECK (id=1),
  instance_id text NOT NULL CHECK (instance_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  enabled boolean NOT NULL DEFAULT true,
  token text,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code='spoolman_unavailable'),
  spool_count integer CHECK (spool_count BETWEEN 0 AND 5000),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  requested_at timestamptz,
  requested_by text
);
ALTER TABLE spoolman_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spoolman_sync_state FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
    GRANT SELECT,INSERT,UPDATE ON spoolman_sync_state TO platform_backend;
    DROP POLICY IF EXISTS platform_backend_access ON spoolman_sync_state;
    CREATE POLICY platform_backend_access ON spoolman_sync_state TO platform_backend USING (true) WITH CHECK (true);
  END IF;
END $$;
