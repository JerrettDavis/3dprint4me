-- Add the same private backend RLS boundary as the other partner tables.
-- API authorization continues to scope statements to the authenticated partner.
ALTER TABLE partner_weekly_statements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_backend') THEN
  DROP POLICY IF EXISTS platform_backend_access ON partner_weekly_statements;
  CREATE POLICY platform_backend_access ON partner_weekly_statements
   TO platform_backend USING(true) WITH CHECK(true);
 END IF;
END $$;
