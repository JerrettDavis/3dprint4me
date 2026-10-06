-- ZIP model packs: a ZIP asset owns extracted child assets (one per STL/3MF entry).
ALTER TABLE print_assets DROP CONSTRAINT IF EXISTS print_assets_format_check;
ALTER TABLE print_assets ADD CONSTRAINT print_assets_format_check CHECK (format IN ('stl','3mf','zip'));
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS parent_asset_id text REFERENCES print_assets(id);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS archive_entry text CHECK (archive_entry IS NULL OR char_length(archive_entry) <= 255);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE print_assets ADD CONSTRAINT print_assets_no_self_parent CHECK (parent_asset_id IS NULL OR parent_asset_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS print_assets_parent_idx ON print_assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;
