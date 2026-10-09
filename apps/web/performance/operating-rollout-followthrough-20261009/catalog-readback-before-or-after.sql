-- Prepared catalog readback only. Not executed against any hosted or local DB.
-- Run before migration one or after migration three; G014 failure in the two→three gap is expected.
-- Use the already-authorized exact PG17 project/principal; no new credentials.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT current_setting('server_version_num') AS server_version_num,
       current_user AS catalog_reader, session_user AS session_reader;
SELECT count(*) AS ledger_count FROM supabase_migrations.schema_migrations;
SELECT version, name, cardinality(statements) AS statement_count,
       encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex') AS statement_array_sha256
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261004190259','20261004192657','20261004194715') ORDER BY version;
WITH wanted(signature) AS (VALUES
 ('public.approve_submission_item(uuid,uuid,jsonb)'),
 ('public.approve_edit_submission_item(uuid,uuid,jsonb)'),
 ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)'),
 ('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'),
 ('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'))
SELECT w.signature, p.oid IS NOT NULL AS present,
 pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
 CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
 CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS auth_execute,
 CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_execute,
 encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,
 encode(sha256(convert_to((to_jsonb(p)-'proacl'-'prosrc')::text,'UTF8')),'hex') AS non_acl_body_metadata_sha256,
 (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist a WHERE a.source_signature=w.signature AND a.grantee='authenticated') AS auth_allowlist_rows,
 (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist a WHERE a.source_signature=w.signature AND a.grantee='service_role') AS service_allowlist_rows
FROM wanted w LEFT JOIN pg_proc p ON p.oid=to_regprocedure(w.signature) ORDER BY w.signature;
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
 encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,
 encode(sha256(convert_to((to_jsonb(p)-'prosrc')::text,'UTF8')),'hex') AS metadata_sha256
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='privacy_retention' AND p.proname IN
 ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract') ORDER BY p.proname;
SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)::text,'UTF8')),'hex') AS membership_sha256
FROM pg_auth_members m;
SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key::text),'[]'::jsonb)::text,'UTF8')),'hex') AS immutable_catalog_manifest_sha256
FROM privacy_retention.g014_catalog_contract_manifest m;
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='pipeline_control' AND c.relname IN
 ('admin_record_operations','admin_record_audit','admin_record_media_cleanup','admin_evaluation_read_index','admin_evaluation_catalog_revision') ORDER BY c.relname;
SELECT p.enabled,p.version, (SELECT count(*) FROM pipeline_control.restaurant_review_runs) AS runs,
 (SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='running') AS running_items,
 (SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='queued') AS queued_items
FROM pipeline_control.restaurant_review_policy p WHERE singleton;
SELECT c.relname AS table_name,t.tgname,t.tgenabled,
 encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex') AS trigger_definition_sha256
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE NOT t.tgisinternal AND t.tgname IN ('admin_record_reference_fence','admin_record_object_fence') ORDER BY t.tgname;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='admin_evaluation_warning_source_order';
-- These four assertion calls are catalog checks, not admin_record_action calls.
SELECT privacy_retention.assert_g014_workflow_owner_contract();
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
SELECT privacy_retention.assert_g014_catalog_contract();
ROLLBACK;
