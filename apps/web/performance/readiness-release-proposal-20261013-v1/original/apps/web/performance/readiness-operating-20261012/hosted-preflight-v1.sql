SELECT jsonb_build_object(
  'engine', current_setting('server_version'),
  'actor', current_user,
  'sessionActor', session_user,
  'superuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
  'ownerMembership', pg_has_role(current_user,'privacy_workflow_owner','MEMBER'),
  'membershipSha256', (SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(m)::text,E'\n' ORDER BY m.roleid,m.member,m.grantor),''),'UTF8')),'hex') FROM pg_auth_members m),
  'ledgerCount', (SELECT count(*) FROM supabase_migrations.schema_migrations),
  'ledgerSha256', (SELECT encode(sha256(convert_to(coalesce(string_agg(row_to_json(m)::text,E'\n' ORDER BY m.version),''),'UTF8')),'hex') FROM supabase_migrations.schema_migrations m),
  'ownedVersionsPresent', (SELECT coalesce(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations WHERE version=ANY(ARRAY['20261008192455','20261008200719','20261008201635','20261011072824','20261011085342','20261011094346','20261011100730','20261011103501','20261011105114','20261011110108','20261011175912'])),
  'manifestCount', (SELECT count(*) FROM privacy_retention.g014_catalog_contract_manifest),
  'g041BodySha256', (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='privacy_retention.g041_current_claim_user_id()'::regprocedure),
  'adminBodySha256', (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure),
  'ownerCleanupPresent', to_regprocedure('public.finish_review_media_cleanup()') IS NOT NULL,
  'privateBucketPresent', EXISTS(SELECT 1 FROM storage.buckets WHERE id='review-verifications'),
  'privateFunctions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='privacy_retention'),
  'revisionSingletonCount', (SELECT count(*) FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton)
) AS readiness_preflight;
