-- Private stock color and optimistic revisions; legacy rows remain valid.
ALTER TABLE filament_inventory ADD COLUMN IF NOT EXISTS color_hex text
  CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9a-f]{6}$');
ALTER TABLE filament_inventory ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE IF NOT EXISTS filament_matching_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_filament_matching (
  work_item_id text PRIMARY KEY REFERENCES work_items(id) ON DELETE RESTRICT,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE filament_matching_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_filament_matching ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON filament_matching_settings, work_filament_matching FROM PUBLIC;
