CREATE OR REPLACE FUNCTION public.partner_qa_database_identity()
RETURNS TABLE(database_name text,cluster_identifier text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT current_database()::text,system_identifier::text FROM pg_control_system() $$;
REVOKE ALL ON FUNCTION public.partner_qa_database_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_qa_database_identity() TO platform_backend;
