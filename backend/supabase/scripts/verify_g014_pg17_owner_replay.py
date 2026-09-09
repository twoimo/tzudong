#!/usr/bin/env python3
"""Read-only PG15 replay disposition for the explicitly PG17-only recovery."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCE_SHA256 = '8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483'
LEGACY_BODY_SHA256 = '5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40'


def verification_sql(source):
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('g014_owner_replay_source_drift')
    receipt = json.dumps({'schema': 'g014-owner-pg15-replay-v1', 'read_only': True,
                          'disposition': 'legacy-contract-preserved',
                          'source_sha256': SOURCE_SHA256}, sort_keys=True)
    return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $verify$ DECLARE owner_id oid:='privacy_workflow_owner'::regrole; bridge_id oid:='privacy_auth_bridge'::regrole; BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('server_version_num')::integer/10000<>15 THEN
   RAISE EXCEPTION 'g014_owner_replay_executor_denied';
 END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_workflow_owner_contract')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_workflow_owner_contract'
       AND p.pronargs=0 AND p.prorettype='void'::regtype AND NOT p.prosecdef
       AND p.proowner=owner_id AND p.proconfig=ARRAY['search_path=""']::text[]
       AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='{LEGACY_BODY_SHA256}'
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                      WHERE a.grantee<>owner_id OR a.is_grantable)) THEN
   RAISE EXCEPTION 'g014_owner_replay_function_denied';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=owner_id AND NOT rolsuper AND NOT rolinherit
       AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=bridge_id AND NOT rolsuper AND rolinherit
       AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
 OR (SELECT count(*) FROM pg_auth_members WHERE member=owner_id OR roleid=owner_id)<>1
 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=owner_id AND member=bridge_id AND NOT admin_option)
 OR NOT pg_has_role(bridge_id,owner_id,'USAGE') THEN
   RAISE EXCEPTION 'g014_owner_replay_membership_denied';
 END IF;
END $verify$;
SELECT '{receipt}'::jsonb AS receipt;
COMMIT;
""".encode()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = verification_sql(args.source.read_bytes())
    with args.output.open('xb') as output:
        output.write(data)
