-- Print estimation, private model assets, and filament cost basis.
-- Additive only: no existing table or column is altered. Apply after 001-003:
--   node --env-file=.env.production.local scripts/migrate-neon.mjs 004_print_estimation.sql

-- Private filament cost basis. Landed cost per kg is derived, never entered twice.
CREATE TABLE IF NOT EXISTS filament_inventory (
  id text PRIMARY KEY DEFAULT ('fil_' || replace(gen_random_uuid()::text, '-', '')),
  material text NOT NULL CHECK (material ~ '^[a-z0-9-]{2,40}$'),
  brand_line text CHECK (brand_line IS NULL OR char_length(brand_line) <= 120),
  color text CHECK (color IS NULL OR char_length(color) <= 80),
  spool_nominal_grams integer NOT NULL CHECK (spool_nominal_grams BETWEEN 1 AND 100000),
  purchase_cost_cents integer NOT NULL CHECK (purchase_cost_cents BETWEEN 0 AND 10000000),
  freight_fee_cents integer NOT NULL DEFAULT 0 CHECK (freight_fee_cents BETWEEN 0 AND 10000000),
  landed_cents_per_kg numeric GENERATED ALWAYS AS (((purchase_cost_cents + freight_fee_cents)::numeric * 1000) / spool_nominal_grams) STORED,
  on_hand_grams integer NOT NULL DEFAULT 0 CHECK (on_hand_grams BETWEEN 0 AND 10000000),
  active boolean NOT NULL DEFAULT true,
  estimate_default boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS filament_inventory_material_idx
  ON filament_inventory (material, active, estimate_default, updated_at DESC);
ALTER TABLE filament_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON filament_inventory FROM PUBLIC;
