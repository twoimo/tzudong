"""Exact hosted G016 identity correction; generates SQL offline, never connects."""
from backend.supabase.scripts import g014_owner_recovery_plan as owner

NONCE_BODY_SHA256 = 'b6a478e40bbb98fbd0d2e4a7993295000d33792093dcf0688b05b33f6363bf4e'
OLD = 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
NEW = 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'


def source() -> str:
    return """-- Correct the retired G016 five-argument allowlist identity only.
-- The nonce-bound function, ACL and user data stay intact. The catalog assertion
-- changes exactly the same retired identity; all its other checks remain intact.
-- Exact PG17/ledger76 admission. Every assertion and cleanup is in one transaction.
DO $g016_identity_correction$
DECLARE before_state jsonb; after_state jsonb; expected_state jsonb; checker oid;
 catalog_oid oid; catalog_source text; expected_catalog_source text;
BEGIN
  IF pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'G016_IDENTITY_EXECUTOR_DENIED';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:g014-pg17-owner-recovery:v1',0));
""" + owner.admission(True, corrected=False) + f"""  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='{owner.CORRECTION[:14]}') THEN
    RAISE EXCEPTION 'G016_IDENTITY_ALREADY_RECORDED';
  END IF;
  IF pg_catalog.to_regprocedure('{OLD}') IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid=pg_catalog.to_regprocedure('{NEW}')
         AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef
         AND p.proconfig=ARRAY['search_path=""']::text[] AND p.pronargs=6
         AND p.pronargdefaults=0 AND p.prokind='f' AND NOT p.proretset
         AND p.prorettype='jsonb'::regtype AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
         AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='{NONCE_BODY_SHA256}'
         AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=2
         AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
           WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'service_role'::regrole)
             OR a.grantor<>'privacy_workflow_owner'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'G016_NONCE_FUNCTION_DRIFT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
      AND proname='g016_identity_correction') THEN RAISE EXCEPTION 'G016_IDENTITY_HELPER_CONFLICT'; END IF;
""" + '  ' + owner.SNAPSHOT + " INTO before_state;\n" + f"""  SELECT p.oid,p.prosrc INTO catalog_oid,catalog_source FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_catalog_contract' AND p.pronargs=0;
  expected_catalog_source:=replace(catalog_source,'{OLD}','{NEW}');
  SELECT jsonb_set(before_state,'{{functions}}',jsonb_agg(
    CASE WHEN (p->>'oid')::oid=catalog_oid THEN jsonb_set(p,'{{prosrc}}',to_jsonb(expected_catalog_source)) ELSE p END
    ORDER BY (p->>'oid')::oid)) INTO expected_state FROM jsonb_array_elements(before_state->'functions') p;
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.g016_identity_correction() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $private_correction$
  DECLARE changed integer; before_allowlist jsonb; expected_allowlist jsonb; after_allowlist jsonb;
    definition text; catalog_source text; rewritten text; before_metadata jsonb; after_metadata jsonb; target oid;
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G016_IDENTITY_CALLER_DENIED';
    END IF;
  IF EXISTS(
    WITH expected(function_schema,function_name,identity_arguments,grantee,source_signature) AS (VALUES
      ('public','confirm_privacy_onboarding','2950 25 2950 25 2950','service_role','{OLD}'),
      ('public','confirm_privacy_onboarding','2950 25 2950 25 2950 25','service_role','{NEW}')),
    actual AS (SELECT function_schema::text,function_name::text,identity_arguments::text,grantee::text,source_signature::text
      FROM privacy_retention.g014_public_rpc_allowlist WHERE function_schema='public' AND function_name='confirm_privacy_onboarding')
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)) THEN
    RAISE EXCEPTION 'G016_IDENTITY_ALLOWLIST_DRIFT';
  END IF;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO before_allowlist
    FROM privacy_retention.g014_public_rpc_allowlist a;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO expected_allowlist
    FROM privacy_retention.g014_public_rpc_allowlist a
    WHERE NOT(source_signature='{OLD}' AND grantee='service_role');
    DELETE FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature='{OLD}' AND grantee='service_role'
        AND function_schema='public' AND function_name='confirm_privacy_onboarding'
        AND identity_arguments='2950 25 2950 25 2950';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'G016_IDENTITY_ROW_COUNT_DRIFT'; END IF;
    SELECT p.oid,pg_catalog.pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
      INTO target,definition,catalog_source,before_metadata FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_catalog_contract' AND p.pronargs=0;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(catalog_source,'UTF8')),'hex')<>'{owner.PRE_CORRECTION_CATALOG_BODY}'
      OR (length(catalog_source)-length(replace(catalog_source,'{OLD}','')))/length('{OLD}')<>1 THEN
      RAISE EXCEPTION 'G016_CATALOG_IDENTITY_SOURCE_DRIFT';
    END IF;
    rewritten:=replace(catalog_source,'{OLD}','{NEW}');
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(rewritten,'UTF8')),'hex')<>'{owner.ASSERTION_BODIES['assert_g014_catalog_contract']}' THEN
      RAISE EXCEPTION 'G016_CATALOG_IDENTITY_REWRITE_DRIFT';
    END IF;
    EXECUTE replace(definition,catalog_source,rewritten);
    SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE oid=target;
    IF after_metadata IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'G016_CATALOG_METADATA_DRIFT'; END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO after_allowlist
      FROM privacy_retention.g014_public_rpc_allowlist a;
    IF after_allowlist IS DISTINCT FROM expected_allowlist OR before_allowlist IS NOT DISTINCT FROM after_allowlist THEN
      RAISE EXCEPTION 'G016_IDENTITY_READBACK_DRIFT';
    END IF;
    DROP FUNCTION pg_temp.g016_identity_correction();
  END $private_correction$;
  REVOKE ALL ON FUNCTION pg_temp.g016_identity_correction() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.g016_identity_correction() TO postgres;
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT oid INTO checker FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
    AND proname='g016_identity_correction' AND pronargs=0;
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker
     AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid=checker AND(a.grantee NOT IN ('postgres'::regrole,'privacy_workflow_owner'::regrole) OR a.is_grantable)) THEN
    RAISE EXCEPTION 'G016_IDENTITY_HELPER_ACL_DRIFT';
  END IF;
""" + '  ' + owner.SNAPSHOT + " INTO after_state;\n" + """  IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'G016_IDENTITY_RESTORE_DRIFT'; END IF;
  PERFORM pg_temp.g016_identity_correction();
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker) THEN
    RAISE EXCEPTION 'G016_IDENTITY_HELPER_REMAINING';
  END IF;
""" + '  ' + owner.SNAPSHOT + " INTO after_state;\n" + """  IF after_state IS DISTINCT FROM expected_state THEN RAISE EXCEPTION 'G016_IDENTITY_POST_DRIFT'; END IF;
END $g016_identity_correction$;
"""
