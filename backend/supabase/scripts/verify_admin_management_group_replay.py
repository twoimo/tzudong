#!/usr/bin/env python3
"""Read-only PG15 accepted-source overlap verifier; never a hosted apply adapter."""
import argparse
from pathlib import Path
import admin_management_group_plan as contract


def verification_sql(source: bytes, predecessor: bytes) -> bytes:
    if contract.sha(source)!=contract.SOURCE_SHA or contract.sha(predecessor)!=contract.PREDECESSOR_SHA:
        raise ValueError('admin_group_replay_source_binding_denied')
    contract.source()
    return f'''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
DO $verify$ DECLARE {contract.DECLARATIONS} BEGIN
 IF current_setting('server_version_num')::int/10000<>15 THEN RAISE EXCEPTION 'admin_group_replay_pg15_required'; END IF;
 {contract.section('DEPENDENCY')}
 {contract.section('TARGET')}
END $verify$;
SELECT jsonb_build_object('schema','admin-management-group-source-overlap-v1',
 'source_sha256','{contract.SOURCE_SHA}','predecessor_sha256','{contract.PREDECESSOR_SHA}',
 'already_present_contract_verified',true,'read_only',current_setting('transaction_read_only')='on');
ROLLBACK;
'''.encode()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,type=Path); p.add_argument('--predecessor',required=True,type=Path); p.add_argument('--output',required=True,type=Path)
    a=p.parse_args()
    sql=verification_sql(a.source.read_bytes(),a.predecessor.read_bytes())
    with a.output.open('xb') as f: f.write(sql)

if __name__=='__main__': main()
