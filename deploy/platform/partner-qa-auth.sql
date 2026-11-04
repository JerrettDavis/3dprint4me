-- Install only in the selected production authentication store, as an admin.
-- No business tables, credentials or session hashes are copied to QA.
BEGIN;
CREATE OR REPLACE FUNCTION public.partner_qa_authorize_owner(session_hash text, owner_subject text, owner_id text)
RETURNS TABLE(operator_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $body$
BEGIN
 RETURN QUERY SELECT s.operator_id::text
 FROM public.operator_sessions s
 JOIN public.operator_identity_bindings b ON b.operator_id=s.operator_id AND b.issuer=s.issuer AND b.subject=s.subject
 JOIN public.operators o ON o.id=s.operator_id
 WHERE s.token_hash=session_hash AND s.expires_at>clock_timestamp()
 AND s.issuer='https://github.com/' AND s.subject=owner_subject
 AND s.operator_id=owner_id AND o.role='owner' AND o.enabled=true
 FOR SHARE OF s,o,b;
END
$body$;
REVOKE ALL ON FUNCTION public.partner_qa_authorize_owner(text,text,text) FROM PUBLIC;
-- Login role partner_qa_auth is provisioned privately before this script.
GRANT USAGE ON SCHEMA public TO partner_qa_auth;
GRANT SELECT (token_hash,operator_id,issuer,subject,expires_at) ON public.operator_sessions TO partner_qa_auth;
GRANT SELECT (operator_id,issuer,subject) ON public.operator_identity_bindings TO partner_qa_auth;
GRANT SELECT (id,role,enabled) ON public.operators TO partner_qa_auth;
GRANT EXECUTE ON FUNCTION public.partner_qa_authorize_owner(text,text,text) TO partner_qa_auth;
DROP POLICY IF EXISTS partner_qa_auth_read ON public.operator_sessions;
CREATE POLICY partner_qa_auth_read ON public.operator_sessions FOR SELECT TO partner_qa_auth USING(true);
DROP POLICY IF EXISTS partner_qa_auth_read ON public.operator_identity_bindings;
CREATE POLICY partner_qa_auth_read ON public.operator_identity_bindings FOR SELECT TO partner_qa_auth USING(true);
DROP POLICY IF EXISTS partner_qa_auth_read ON public.operators;
CREATE POLICY partner_qa_auth_read ON public.operators FOR SELECT TO partner_qa_auth USING(true);
CREATE OR REPLACE FUNCTION public.partner_qa_auth_identity()
RETURNS TABLE(database_name text,cluster_identifier text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT current_database()::text,system_identifier::text FROM pg_control_system() $$;
REVOKE ALL ON FUNCTION public.partner_qa_auth_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_qa_auth_identity() TO partner_qa_auth,platform_backend;
COMMIT;
