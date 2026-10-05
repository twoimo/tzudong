#!/usr/bin/env python3
"""Verify an accepted-source overlap in a disposable clean replay, without DDL.

The hosted successor repairs a missing RPC on an exact PG17/current51 catalog.
The PG15 source replay already created it in August. Never run the successor's
hosted membership/absence admission on that different starting state.
"""
import argparse
import hashlib
from pathlib import Path

SOURCE_SHA256 = 'f1b5a6878752c3004f74e057cf230bf26acca432271415f609c103b2bd1cb492'
PREDECESSOR_SHA256 = 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf'
BODY_SHA256 = 'be57e320d7a79e6e7382bce9e942b3e684fc50246beb44deaa67c408cb553acd'


def verification_sql(source: bytes, predecessor: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('admin_ids_replay_source_drift')
    if hashlib.sha256(predecessor).hexdigest() != PREDECESSOR_SHA256:
        raise ValueError('admin_ids_replay_predecessor_drift')
    return f'''-- Source-only overlap verification; no hosted application claim.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
DO $verify$
DECLARE
  target oid := pg_catalog.to_regprocedure('public.read_admin_user_ids_for_management()');
  owner_id oid := pg_catalog.to_regrole('privacy_workflow_owner');
BEGIN
  IF target IS NULL OR owner_id IS NULL
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='read_admin_user_ids_for_management') <> 1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target
       AND p.proowner=owner_id AND p.prosecdef AND p.provolatile='s' AND p.prokind='f'
       AND p.proretset AND p.prorettype='uuid'::regtype AND p.pronargs=0
       AND p.proallargtypes=ARRAY['uuid'::regtype::oid] AND p.proargmodes=ARRAY['t']::"char"[]
       AND p.proargnames=ARRAY['user_id']::text[] AND p.proconfig=ARRAY['search_path=""']::text[]
       AND (SELECT lanname FROM pg_catalog.pg_language WHERE oid=p.prolang)='plpgsql'
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='{BODY_SHA256}') THEN
    RAISE EXCEPTION 'admin_ids_replay_rpc_mismatch';
  END IF;
  -- The exact function body is insufficient if its owner can see only some rows.
  -- Check effective SELECT visibility in the same read-only snapshot as the receipt.
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=owner_id
       AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
     OR NOT pg_catalog.has_schema_privilege(owner_id,'public','USAGE')
     OR NOT pg_catalog.has_column_privilege(owner_id,'public.user_roles','user_id','SELECT')
     OR NOT pg_catalog.has_column_privilege(owner_id,'public.user_roles','role','SELECT')
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.user_roles'::regclass
       AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND relowner<>owner_id)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE polrelid='public.user_roles'::regclass
       AND polcmd IN ('r','*') AND polpermissive
       AND pg_catalog.pg_get_expr(polqual,polrelid) IN ('true','(true)')
       AND EXISTS(SELECT 1 FROM pg_catalog.unnest(polroles) r WHERE r=0 OR pg_catalog.pg_has_role(owner_id,r,'USAGE')))
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE polrelid='public.user_roles'::regclass
       AND polcmd IN ('r','*') AND NOT polpermissive
       AND pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'
       AND pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM '(true)'
       AND EXISTS(SELECT 1 FROM pg_catalog.unnest(polroles) r WHERE r=0 OR pg_catalog.pg_has_role(owner_id,r,'USAGE'))) THEN
    RAISE EXCEPTION 'admin_ids_replay_visibility_denied';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',target,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',target,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE p.oid=target AND (a.grantee NOT IN (owner_id,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'admin_ids_replay_acl_mismatch';
  END IF;
  IF (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
        WHERE source_signature='public.read_admin_user_ids_for_management()'
          OR (function_schema='public' AND function_name='read_admin_user_ids_for_management')) <> 1
     OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
        WHERE function_schema='public' AND function_name='read_admin_user_ids_for_management'
          AND identity_arguments='' AND grantee='service_role'
          AND source_signature='public.read_admin_user_ids_for_management()') THEN
    RAISE EXCEPTION 'admin_ids_replay_allowlist_mismatch';
  END IF;
END $verify$;
SELECT pg_catalog.jsonb_build_object(
  'schema','admin-ids-source-replay-overlap-v1',
  'source_sha256','{SOURCE_SHA256}',
  'predecessor_sha256','{PREDECESSOR_SHA256}',
  'body_sha256','{BODY_SHA256}',
  'disposition','already-present-contract-verified',
  'read_only',pg_catalog.current_setting('transaction_read_only')='on');
COMMIT;
'''.encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--predecessor', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sql = verification_sql(args.source.read_bytes(), args.predecessor.read_bytes())
    with args.output.open('xb') as handle:
        handle.write(sql)


if __name__ == '__main__':
    main()
