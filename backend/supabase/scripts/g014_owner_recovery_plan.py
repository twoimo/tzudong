#!/usr/bin/env python3
"""Offline, separate PG17 owner recovery and final-verifier sources. No DB I/O."""
import argparse
import hashlib
import json
from pathlib import Path

from backend.supabase.scripts.materialize_migration_workspace import FORWARD_FILES, ROOT

ORIGINAL = '20260906064252_g014_pg17_workflow_owner_contract.sql'
ORIGINAL_SHA256 = '8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483'
# Observed after actual CLI 2.119.0 application in the private PG17.6 fixture.
# The CLI omits outer whitespace and the final statement delimiter in history.
ORIGINAL_CLI_STATEMENT_SHA256 = '92e475c2ca55bb82ad8132ced6b0ecda473508f2b035f59d3d6140b2e2481f8d'
ORIGINAL_CLI_ARRAY_SHA256 = '42af1eec6543319af14934859b15cbb3c77e6a6ceea80cdc1d9432783491b0aa'
VERIFIER = '20261004115554_g014_pg17_owner_final_verifier.sql'
CORRECTION = '20261004123034_g016_onboarding_allowlist_identity_correction.sql'
OLD_OWNER_BODY = '5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40'
NEW_OWNER_BODY = '345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d'
PRE_CORRECTION_CATALOG_BODY = '9c96bfdf0c80af38fcfe61b4f36bbc22df99aca76be56ce2758e950a7a5e4d28'
# Hosted branch of the exact manual -> page invoker contract chain. The warning
# RPC branch is deliberately not admitted by this 13-file rollout plan.
ASSERTION_BODIES = {
    'assert_g014_public_rpc_allowlist': 'f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',
    'assert_g014_definer_contract': 'a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964',
    'assert_g014_catalog_contract': '8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab',
}


def admission(recovered: bool, corrected: bool = True) -> str:
    names = [(name[:14], Path(name).stem[15:]) for name in FORWARD_FILES]
    if recovered:
        names.append((ORIGINAL[:14], Path(ORIGINAL).stem[15:]))
        if corrected:
            names.append((CORRECTION[:14], Path(CORRECTION).stem[15:]))
    values = ',\n      '.join(f"('{version}','{name}')" for version, name in names)
    members = """('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
      ('privacy_auth_bridge','postgres','supabase_admin',true,false,false),
      ('privacy_workflow_owner','privacy_auth_bridge','postgres',false,true,true)"""
    if not recovered:
        members += ",\n      ('privacy_workflow_owner','postgres','postgres',false,true,false)"
    functions = dict(ASSERTION_BODIES)
    if not recovered or not corrected:
        functions['assert_g014_catalog_contract'] = PRE_CORRECTION_CATALOG_BODY
    functions['assert_g014_workflow_owner_contract'] = NEW_OWNER_BODY if recovered else OLD_OWNER_BODY
    function_values = ',\n      '.join(f"('{name}','{digest}',{'false' if name.endswith('workflow_owner_contract') else 'true'})" for name, digest in functions.items())
    owner_usage = 'false' if recovered else 'true'
    checks = f"""  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('server_version_num')::integer/10000 <> 17 THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_EXECUTOR_DENIED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit
         AND rolcreaterole AND rolcreatedb AND rolcanlogin AND rolreplication AND rolbypassrls)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit
         AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_auth_bridge' AND NOT rolsuper AND rolinherit
         AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_ROLE_DRIFT';
  END IF;
  IF EXISTS(
    WITH expected(role_name,member_name,grantor_name,admin_option,inherit_option,set_option) AS (VALUES
      {members}),
    actual AS (SELECT r.rolname::text,m.rolname::text,g.rolname::text,a.admin_option,a.inherit_option,a.set_option
      FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid=a.roleid
      JOIN pg_catalog.pg_roles m ON m.oid=a.member JOIN pg_catalog.pg_roles g ON g.oid=a.grantor
      WHERE r.rolname IN ('privacy_workflow_owner','privacy_auth_bridge') OR m.rolname IN ('privacy_workflow_owner','privacy_auth_bridge'))
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual))
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE') IS DISTINCT FROM {owner_usage}
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
    OR pg_catalog.pg_has_role('postgres','privacy_auth_bridge','USAGE')
    OR pg_catalog.pg_has_role('postgres','privacy_auth_bridge','SET')
    OR NOT pg_catalog.pg_has_role('privacy_auth_bridge','privacy_workflow_owner','USAGE') THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_MEMBERSHIP_DRIFT';
  END IF;
  IF EXISTS(
    WITH expected(name,body_sha256,definer) AS (VALUES
      {function_values})
    SELECT 1 FROM expected e WHERE
      (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='privacy_retention' AND p.proname=e.name)<>1
      OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='privacy_retention' AND p.proname=e.name AND p.pronargs=0
          AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef=e.definer
          AND p.prokind='f' AND NOT p.proretset AND p.provolatile='v' AND p.prorettype='void'::regtype
          AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
          AND p.proconfig=ARRAY['search_path=""']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=e.body_sha256
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
            WHERE a.grantee<>p.proowner OR a.is_grantable))) THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_FUNCTION_DRIFT';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>{62 + len(names)}
     OR EXISTS(SELECT 1 FROM (VALUES
      {values}) expected(version,name)
       LEFT JOIN supabase_migrations.schema_migrations m USING(version)
       WHERE m.name IS DISTINCT FROM expected.name OR coalesce(cardinality(m.statements),0)<1)
     OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='{VERIFIER[:14]}')
     {'' if recovered else "OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='" + ORIGINAL[:14] + "')"} THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_LEDGER_DRIFT';
  END IF;
"""
    if recovered:
        checks += f"""  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='{ORIGINAL[:14]}' AND name='{Path(ORIGINAL).stem[15:]}' AND cardinality(statements)=1
      AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='{ORIGINAL_CLI_STATEMENT_SHA256}'
      AND encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')='{ORIGINAL_CLI_ARRAY_SHA256}') THEN
    RAISE EXCEPTION 'G014_OWNER_RECOVERY_RECEIPT_DRIFT';
  END IF;
"""
        if corrected:
            from backend.supabase.scripts.g016_onboarding_identity_correction import source
            statement = source().strip().removesuffix(';')
            statement_sha = hashlib.sha256(statement.encode()).hexdigest()
            checks += f"""  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='{CORRECTION[:14]}' AND name='{Path(CORRECTION).stem[15:]}' AND cardinality(statements)=1
      AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='{statement_sha}') THEN
    RAISE EXCEPTION 'G016_IDENTITY_RECEIPT_DRIFT';
  END IF;
"""
    return checks


SNAPSHOT = """SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations))"""


def verifier_source() -> str:
    return """-- Separate final verification AFTER the 13-file chain AND recorded original
-- 20260906064252 owner recovery AND 20261004123034 identity correction.
-- Requires 77 recorded migrations. Never aliases or re-executes those sources.
-- Reuses the catalog-slice transaction-local definer checker pattern.
-- One atomic DO statement; caller must include its ledger receipt in the same
-- transaction. On any error/disconnect PostgreSQL rolls back helper and grants.
DO $g014_owner_final$
DECLARE before_state jsonb; after_state jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_EXECUTOR_DENIED';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:g014-pg17-owner-recovery:v1',0));
""" + admission(True) + """  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
     AND proname='g014_pg17_owner_final_check') THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_CONFLICT';
  END IF;
""" + '  ' + SNAPSHOT + " INTO before_state;\n" + """  -- A new self-grant is temporary, carries no ADMIN or INHERIT, and is removed
  -- BEFORE assertions run. Provider bootstrap membership is never altered.
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.g014_pg17_owner_final_check() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $private_check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G014_OWNER_FINAL_CALLER_DENIED';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.g014_pg17_owner_final_check();
  END $private_check$;
  REVOKE ALL ON FUNCTION pg_temp.g014_pg17_owner_final_check() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.g014_pg17_owner_final_check() TO postgres;
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT oid INTO checker FROM pg_catalog.pg_proc
    WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='g014_pg17_owner_final_check' AND pronargs=0;
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE oid=checker
      AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
        WHERE p.oid=checker AND (a.grantee NOT IN ('postgres'::regrole,'privacy_workflow_owner'::regrole) OR a.is_grantable))
      OR pg_catalog.has_function_privilege('anon',checker,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',checker,'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role',checker,'EXECUTE') THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_ACL_DRIFT';
  END IF;
""" + '  ' + SNAPSHOT + " INTO after_state;\n" + """  IF after_state IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_RESTORE_DRIFT';
  END IF;
  PERFORM pg_temp.g014_pg17_owner_final_check();
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker) THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_REMAINING';
  END IF;
""" + '  ' + SNAPSHOT + " INTO after_state;\n" + """  IF after_state IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_POST_DRIFT';
  END IF;
END $g014_owner_final$;
"""


def preflight_source() -> str:
    return ('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nDO $owner_stage_admission$\nBEGIN\n'
            + admission(False) + 'END $owner_stage_admission$;\n'
            + "SELECT jsonb_build_object('stage','owner-recovery-admitted','serverMajor',17,'ledgerCount',75,"
              "'ownerBodySha256','" + OLD_OWNER_BODY + "','readOnly',true) AS receipt;\nCOMMIT;\n")


def final_preflight_source() -> str:
    return ('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nDO $owner_final_admission$\nBEGIN\n'
            + admission(True) + 'END $owner_final_admission$;\n'
            + "SELECT jsonb_build_object('stage','owner-final-admitted','serverMajor',17,'ledgerCount',77,"
              "'ownerBodySha256','" + NEW_OWNER_BODY + "','readOnly',true) AS receipt;\nCOMMIT;\n")


def prepare(destination: Path) -> dict:
    if destination.exists():
        raise ValueError('g014_owner_plan_destination_exists')
    original = (ROOT / 'backend/supabase/migrations' / ORIGINAL).read_bytes()
    final = (ROOT / 'backend/supabase/migrations' / VERIFIER).read_bytes()
    correction = (ROOT / 'backend/supabase/migrations' / CORRECTION).read_bytes()
    from backend.supabase.scripts.g016_onboarding_identity_correction import source
    if correction != source().encode():
        raise ValueError('g014_owner_plan_correction_unready')
    if hashlib.sha256(original).hexdigest() != ORIGINAL_SHA256 or final != verifier_source().encode():
        raise ValueError('g014_owner_plan_source_drift')
    destination.mkdir(parents=True)
    (destination / 'before-recovery-read-only.sql').write_text(preflight_source())
    (destination / 'before-final-read-only.sql').write_text(final_preflight_source())
    for phase, name, body in [('2-original-recovery', ORIGINAL, original),
                              ('3-identity-correction', CORRECTION, correction),
                              ('4-final-verifier', VERIFIER, final)]:
        directory = destination / phase
        directory.mkdir()
        (directory / name).write_bytes(body)
    plan = {'kind': 'separate-pg17-owner-recovery-plan', 'databaseMutations': False,
            'requiresRecordedForwardVersions': [name[:14] for name in FORWARD_FILES],
            'phases': [{'stage': 2, 'file': ORIGINAL, 'sourceSha256': ORIGINAL_SHA256, 'expectedLedgerCountBefore': 75,
                        'expectedCliLedgerReceipt': {'statement_count': 1, 'statements_sha256': ORIGINAL_CLI_STATEMENT_SHA256,
                                                     'statements_array_sha256': ORIGINAL_CLI_ARRAY_SHA256}},
                       {'stage': 3, 'file': CORRECTION, 'sourceSha256': hashlib.sha256(correction).hexdigest(), 'expectedLedgerCountBefore': 76},
                       {'stage': 4, 'file': VERIFIER, 'sourceSha256': hashlib.sha256(final).hexdigest(), 'expectedLedgerCountBefore': 77,
                        'requiredRecordedCorrectionVersion': CORRECTION[:14]}],
            'hostedPostChainAdmissionVerified': False, 'ledgerReceiptsSynthesized': False,
            'requiresPostChainLedgerHashReadback': True,
            'note': 'Separate source versions. Original recovery is already applied in hosted state and must not be replayed. Build only the next phase from its fresh exact ledger; never reuse the base62/base75 pack or glob phases together. Final verifier timestamp precedes the correction, so explicitly selected --include-all is required.'}
    (destination / 'owner-recovery-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.destination), indent=2))
