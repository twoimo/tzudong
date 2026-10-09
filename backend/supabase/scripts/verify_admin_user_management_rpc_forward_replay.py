#!/usr/bin/env python3
"""Read-only PG15 overlap verifier for the operating-only admin RPC forward."""
import argparse
import hashlib
from pathlib import Path

import admin_management_group_plan as accepted


SOURCE_SHA = 'b96126240399e580ed6b7198edbd3d0af44b26ec5cab66073c037b331ec8eb26'


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def section(source: str, kind: str) -> str:
    start = f'-- BEGIN {kind} GUARD'
    end = f'-- END {kind} GUARD'
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError('admin_user_rpc_forward_replay_guard_anchor_denied')
    return source.split(start, 1)[1].split('\n', 1)[1].split(end, 1)[0]


def verification_sql(source: bytes, accepted_source: bytes) -> bytes:
    if sha(source) != SOURCE_SHA or sha(accepted_source) != accepted.SOURCE_SHA:
        raise ValueError('admin_user_rpc_forward_replay_source_binding_denied')
    # This also verifies the accepted source, its canonical predecessor, planner,
    # and G037 parser pins before any SQL is emitted.
    accepted.source()
    forward = source.decode('utf-8')
    for kind in ('DEPENDENCY', 'TARGET'):
        if section(forward, kind) != accepted.section(kind):
            raise ValueError('admin_user_rpc_forward_replay_contract_drift')
    return f'''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
DO $verify$ DECLARE {accepted.DECLARATIONS} BEGIN
 IF current_setting('server_version_num')::int/10000<>15 THEN RAISE EXCEPTION 'admin_user_rpc_forward_replay_pg15_required'; END IF;
 {accepted.section('DEPENDENCY')}
 {accepted.section('TARGET')}
END $verify$;
SELECT jsonb_build_object('schema','admin-user-rpc-forward-source-replay-v1',
 'source_sha256','{SOURCE_SHA}','accepted_source_sha256','{accepted.SOURCE_SHA}',
 'predecessor_sha256','{accepted.PREDECESSOR_SHA}',
 'disposition','already-present-contract-verified','read_only',current_setting('transaction_read_only')='on',
 'operating_sql_executed',false,'required_operating_server_version_num',170006,
 'required_operating_ledger_count',85);
ROLLBACK;
'''.encode('utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--predecessor', required=True, type=Path,
                        help='accepted 202609 source immediately preceding this forward')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    sql = verification_sql(args.source.read_bytes(), args.predecessor.read_bytes())
    with args.output.open('xb') as output:
        output.write(sql)


if __name__ == '__main__':
    main()
