#!/usr/bin/env python3
"""Prepare a fresh CLI workspace from a sanitized ledger, without DB access.

Canonical original migrations stay intact. Only proven, already-applied receipts
are included; their represented predecessors become explicit no-op history aliases.
Never use an unverified receipt to suppress SQL or alter the operational ledger.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RECEIPTS = 'backend/supabase/applied-receipts/storyboard-20261003'


def prepare(root: Path, ledger: dict, destination: Path) -> dict:
    if destination.exists():
        raise ValueError('migration_workspace_destination_exists')
    rows=ledger.get('migrations')
    if not isinstance(rows,list) or len(rows)>10000:
        raise ValueError('migration_workspace_ledger_invalid')
    by_version={}
    for row in rows:
        if not isinstance(row,dict) or not re.fullmatch(r'\d{14}',str(row.get('version',''))) or not re.fullmatch(r'[a-z0-9_]+',str(row.get('name',''))):
            raise ValueError('migration_workspace_ledger_invalid')
        if row['version'] in by_version:
            raise ValueError('migration_workspace_ledger_duplicate')
        by_version[row['version']]=row
    plan={p.name:p.read_bytes() for p in (root/'backend/supabase/migrations').glob('*.sql')}
    dependencies=[]
    registry='20261003065736_g014_current_service_rpc_registry.sql'
    restoration='20261003095444_restore_service_identity_helpers.sql'
    if registry[:14] not in by_version:
        original=plan[registry]
        # The later restoration is idempotent. Run its exact bytes before the
        # registry prerequisite, preserving both immutable canonical SQL files.
        plan[registry]=plan[restoration]+b'\n'+original
        dependencies.append({'target':registry,'predecessor':restoration,
            'canonicalSha256':hashlib.sha256(original).hexdigest(),
            'predecessorSha256':hashlib.sha256(plan[restoration]).hexdigest(),
            'workspaceSha256':hashlib.sha256(plan[registry]).hexdigest()})
    invoker='20261003113923_g014_service_invoker_contract.sql'
    storyboard_bridge='20261003182338_storyboard_service_role_bridge.sql'
    if invoker[:14] not in by_version:
        original=plan[invoker]
        plan[invoker]=plan[storyboard_bridge]+b'\n'+original
        dependencies.append({'target':invoker,'predecessor':storyboard_bridge,
            'canonicalSha256':hashlib.sha256(original).hexdigest(),
            'predecessorSha256':hashlib.sha256(plan[storyboard_bridge]).hexdigest(),
            'workspaceSha256':hashlib.sha256(plan[invoker]).hexdigest()})
    manifest=json.loads((root/RECEIPTS/'manifest.json').read_text())
    aliases=[]
    for item in manifest['receipts']:
        archived=Path(item['archivedReceipt']); original=Path(item['originalMigration'])
        if archived.parent != Path(RECEIPTS) or original.parent != Path('backend/supabase/migrations'):
            raise ValueError('migration_workspace_source_path_invalid')
        body=(root/archived).read_bytes(); original_body=(root/original).read_bytes()
        if hashlib.sha256(body).hexdigest()!=item['sha256'] or hashlib.sha256(original_body).hexdigest()!=item['originalSha256']:
            raise ValueError('migration_workspace_source_drift')
        version=archived.name[:14]; name=archived.stem[15:]
        row=by_version.get(version)
        if row is None:
            continue
        if row['name']!=name or row.get('statement_count')!=1 or row.get('statements_sha256')!=item['sha256']:
            raise ValueError('migration_workspace_receipt_unverified')
        plan[archived.name]=body
        original_version=original.name[:14]
        if original_version not in by_version:
            alias=('-- History alias only; the original DDL is not executed by this workspace.\n'
                   f'-- Represented by verified receipt {version}_{name}, SHA256 {item["sha256"]}.\n'
                   '-- Canonical original SQL is preserved in the repository.\n').encode()
            plan[original.name]=alias
            aliases.append({'version':original_version,'representedBy':version,'originalSqlExecuted':False,
                            'canonicalSha256':item['originalSha256'],'workspaceSha256':hashlib.sha256(alias).hexdigest()})
    directory=destination/'supabase/migrations'
    directory.mkdir(parents=True)
    for name,body in sorted(plan.items()):
        (directory/name).write_bytes(body)
    report={'kind':'read-only-migration-workspace-plan','databaseMutations':False,
            'aliases':aliases,'dependencyAdapters':dependencies,'fileCount':len(plan),'files':[{'name':name,'sha256':hashlib.sha256(body).hexdigest()} for name,body in sorted(plan.items())]}
    (destination/'migration-workspace-plan.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger',type=Path,required=True)
    parser.add_argument('--destination',type=Path,required=True)
    args=parser.parse_args()
    report=prepare(ROOT,json.loads(args.ledger.read_text()),args.destination)
    print(json.dumps({'databaseMutations':False,'fileCount':report['fileCount'],'aliases':report['aliases']}))
