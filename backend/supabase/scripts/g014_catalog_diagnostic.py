"""Offline read-only G014 diagnostic SQL and strict receipt admission. No transport.

A receipt is evidence supplied by a trusted operator, not a signature or execution
credential. The caller must retain transport/project readback separately. SQL
uses only transaction-local settings for its result channel; no leases or objects.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess

import advisor_successor_plan as baseline

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'g014-catalog-diagnostic-v1'
PROJECT = baseline.PROJECT
MAX_AGE_SECONDS = 300
# Host/DB clocks can differ slightly; this is not an extension of receipt TTL.
MAX_FUTURE_SKEW_SECONDS = 1
ASSERTIONS = ('public_rpc_allowlist', 'definer_contract', 'catalog_contract')
CODES = {'passed', 'permission_denied', 'function_missing', 'query_timeout',
         'read_only_violation', 'contract_failed', 'assertion_identity_denied'}
COUNTS = ('allowlist_missing', 'public_functions', 'role_pairs',
          'unexpected_execute_pairs', 'owner_memberships')
ASSERTION_CATALOG_SQL = """SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb)::text,'UTF8')),'hex')
FROM pg_proc p WHERE p.oid IN (to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()'),
to_regprocedure('privacy_retention.assert_g014_definer_contract()'),to_regprocedure('privacy_retention.assert_g014_catalog_contract()'))"""
canonical = baseline.canonical
literal = baseline.literal
sha = baseline.sha


def binding(preview):
    """Bind the checked-out revision AND governing bytes, including dirty edits."""
    result = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                            capture_output=True, text=True, timeout=10)
    commit = result.stdout.strip()
    if result.returncode or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('diagnostic_source_denied')
    files = ('g014_catalog_diagnostic.py', 'admin_user_ids_slice_plan.py',
             'advisor_successor_plan.py')
    return {'projectId': PROJECT, 'sourceCommit': commit,
            'governingSourceSha256': sha(canonical({n: sha((Path(__file__).parent/n).read_bytes()) for n in files}).encode()),
            'migrationSourceSha256': preview['source_sha256'],
            'previewSha256': sha(canonical(preview).encode()),
            'snapshotSha256': sha(canonical(preview['snapshot']).encode()),
            'executorRole': 'postgres', 'sessionRole': 'postgres'}


def diagnostic_sql(preview):
    bound = binding(preview)
    prior = literal(canonical(preview['snapshot'])) + '::jsonb'
    blocks = []
    for name in ASSERTIONS:
        blocks.append(f"""
 BEGIN
   IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('privacy_retention.assert_g014_{name}()')
     AND prosecdef AND proowner='privacy_workflow_owner'::regrole AND proconfig=ARRAY['search_path=""']::text[]) THEN
     PERFORM privacy_retention.assert_g014_{name}();
     code := 'passed';
   ELSE code := 'assertion_identity_denied'; END IF;
 EXCEPTION
   WHEN insufficient_privilege THEN code := 'permission_denied';
   WHEN undefined_function THEN code := 'function_missing';
   WHEN query_canceled THEN code := 'query_timeout';
   WHEN read_only_sql_transaction THEN code := 'read_only_violation';
   WHEN assert_failure OR OTHERS THEN code := 'contract_failed';
 END;
 results := results || jsonb_build_object('{name}', code);
""")
    return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL client_min_messages='error';
DO $g014_diagnostic$
DECLARE
 results jsonb := '{{}}'::jsonb; code text; snapshot_matches boolean := false;
 counts jsonb := NULL; counts_code text := 'unavailable'; actual jsonb; assertion_hash text;
BEGIN
 BEGIN
   SELECT ({baseline.snapshot_sql()}) INTO actual;
   snapshot_matches := actual IS NOT DISTINCT FROM {prior};
 EXCEPTION WHEN query_canceled OR OTHERS THEN snapshot_matches := false;
 END;
 BEGIN
   SELECT ({ASSERTION_CATALOG_SQL}) INTO assertion_hash;
 EXCEPTION WHEN query_canceled OR OTHERS THEN assertion_hash := NULL;
 END;
 {''.join(blocks)}
 BEGIN
   SELECT jsonb_build_object(
     'allowlist_missing',(SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE to_regprocedure(source_signature) IS NULL),
     'public_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
     'role_pairs',(SELECT count(*)*3 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
     'unexpected_execute_pairs',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) r(role_name)
       WHERE n.nspname='public' AND has_function_privilege(r.role_name,p.oid,'EXECUTE')
       AND NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
         WHERE to_regprocedure(a.source_signature)=p.oid AND a.grantee=r.role_name)),
     'owner_memberships',(SELECT count(*) FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole OR member='privacy_workflow_owner'::regrole)
   ) INTO counts;
   counts_code := 'available';
 EXCEPTION WHEN query_canceled OR OTHERS THEN counts := NULL;
 END;
 PERFORM set_config('tzudong.g014_diagnostic', jsonb_build_object(
   'schema','{SCHEMA}', 'binding',{literal(canonical(bound))}::jsonb,
   'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'readOnly',current_setting('transaction_read_only')='on',
   'roleMatches',current_user='postgres' AND session_user='postgres',
   'snapshotMatches',snapshot_matches,'assertions',results,'assertionCatalogSha256',assertion_hash,
   'countsCode',counts_code,'counts',counts)::text, true);
END $g014_diagnostic$;
SELECT current_setting('tzudong.g014_diagnostic')::jsonb AS g014_diagnostic;
ROLLBACK;
"""


def parse_receipt(raw):
    """Accept a bounded standalone JSON receipt, never provider text/envelopes."""
    def unique(pairs):
        value = {}
        for k, v in pairs:
            if k in value:
                raise ValueError('diagnostic_receipt_denied')
            value[k] = v
        return value
    try:
        if not isinstance(raw, bytes) or len(raw) > 8192:
            raise ValueError
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        raise ValueError('diagnostic_receipt_denied') from None


def load_receipt(path):
    with Path(path).open('rb') as source:
        return parse_receipt(source.read(8193))


def require_passed(receipt, preview, *, now=None):
    """Reject stale/foreign/partial evidence before any mutation SQL is generated."""
    denied = 'fresh_passed_g014_diagnostic_required'
    keys = {'schema','binding','observedAt','readOnly','roleMatches','snapshotMatches',
            'assertions','countsCode','counts','assertionCatalogSha256'}
    if not isinstance(receipt, dict) or set(receipt) != keys:
        raise ValueError(denied)
    if (receipt['schema'] != SCHEMA or receipt['binding'] != binding(preview)
            or any(receipt[k] is not True for k in ('readOnly','roleMatches','snapshotMatches'))
            or receipt['assertions'] != {a: 'passed' for a in ASSERTIONS}
            or receipt['countsCode'] != 'available'
            or not isinstance(receipt['assertionCatalogSha256'],str)
            or not re.fullmatch(r'[0-9a-f]{64}',receipt['assertionCatalogSha256'])):
        raise ValueError(denied)
    counts = receipt['counts']
    if (not isinstance(counts,dict) or set(counts) != set(COUNTS)
            or any(type(v) is not int or not 0 <= v <= 2147483647 for v in counts.values())
            or counts['allowlist_missing'] != 0 or counts['unexpected_execute_pairs'] != 0
            or counts['role_pairs'] != 3*counts['public_functions']):
        raise ValueError(denied)
    stamp = receipt['observedAt']
    try:
        if not isinstance(stamp,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z',stamp):
            raise ValueError
        observed = datetime.fromisoformat(stamp.replace('Z','+00:00'))
        current = now if now is not None else datetime.now(timezone.utc)
        age = (current-observed).total_seconds()
        if not -MAX_FUTURE_SKEW_SECONDS <= age <= MAX_AGE_SECONDS:
            raise ValueError
    except (ValueError, TypeError, OverflowError):
        raise ValueError(denied) from None
    return stamp


def execution_guard(stamp, assertion_hash):
    """Recheck role/freshness at execution, before the preserved mutation block."""
    # stamp was parsed and bounded by require_passed; quote anyway.
    return f"""IF current_user<>'postgres' OR session_user<>'postgres'
 OR clock_timestamp() < {literal(stamp)}::timestamptz
 OR clock_timestamp() > {literal(stamp)}::timestamptz + interval '{MAX_AGE_SECONDS} seconds'
 THEN RAISE EXCEPTION 'g014_diagnostic_execution_binding_denied'; END IF;
 IF ({ASSERTION_CATALOG_SQL}) IS DISTINCT FROM {literal(assertion_hash)} THEN
   RAISE EXCEPTION 'g014_diagnostic_assertion_drift'; END IF;
 PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
 PERFORM privacy_retention.assert_g014_definer_contract();
 PERFORM privacy_retention.assert_g014_catalog_contract();"""
