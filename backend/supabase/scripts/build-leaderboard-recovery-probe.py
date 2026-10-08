#!/usr/bin/env python3
"""Emit an atomic recovery probe for the admitted disposable nightly database.

No connection or credentials are accepted. The workflow supplies its already
admitted isolated container. Source and fixture wrappers are removed only in
this probe so dropping/restoring the RPC and synthetic rows all roll back.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'backend/supabase/migrations/20261008084856_public_profile_leaderboard_read_boundary.sql'
FIXTURE = ROOT / 'backend/supabase/tests/public_profile_leaderboard_hosted.sql'


def unwrap(text: str, terminal: str) -> str:
    if len(re.findall(r'^BEGIN;$', text, re.M)) != 1 or len(re.findall(r'^' + terminal + r';$', text, re.M)) != 1:
        raise ValueError('recovery_probe_transaction_shape')
    return re.sub(r'^' + terminal + r';$', '', re.sub(r'^BEGIN;$', '', text, flags=re.M), flags=re.M)


STATE = """(
  SELECT pg_catalog.md5(pg_catalog.jsonb_build_object(
    'rpc',(SELECT pg_catalog.to_jsonb(p) FROM pg_catalog.pg_proc p
           WHERE p.oid=pg_catalog.to_regprocedure('public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)')),
    'members',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
    'allowlist',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY grantee) FROM privacy_retention.g014_public_rpc_allowlist a
                 WHERE source_signature='public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)')
  )::text)
)"""


def build_probe() -> str:
    migration = unwrap(MIGRATION.read_text(), 'COMMIT')
    fixture = unwrap(FIXTURE.read_text(), 'ROLLBACK')
    return f"""\\set ON_ERROR_STOP on
SELECT pg_catalog.set_config('tzudong_recovery_probe.before', {STATE}, false);
BEGIN;
DELETE FROM privacy_retention.g014_public_rpc_allowlist
 WHERE source_signature='public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)';
DROP FUNCTION public.read_public_profile_leaderboard_page(text,integer,numeric,uuid);
{migration}
{fixture}
ROLLBACK;
DO $rollback_check$
BEGIN
  IF {STATE} IS DISTINCT FROM pg_catalog.current_setting('tzudong_recovery_probe.before') THEN
    RAISE EXCEPTION 'leaderboard_recovery_probe_rollback_drift';
  END IF;
END
$rollback_check$;
SELECT '{{"missing_rpc_recovery":"passed","synthetic_fixture":"passed","rollback":"exact"}}';
"""


if __name__ == '__main__':
    try:
        if len(sys.argv) != 1:
            raise ValueError('recovery_probe_arguments_denied')
        print(build_probe())
    except (OSError, ValueError):
        print('leaderboard_recovery_probe_invalid', file=sys.stderr)
        raise SystemExit(2)
