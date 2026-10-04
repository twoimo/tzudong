#!/usr/bin/env python3
"""Prepare an offline, selected CLI rollout pack from a sanitized hosted ledger.

The CLI defaults to the hash-admitted admin-20261004 forward set. Already-applied
history is represented by throwing mirrors, never guessed SQL or new aliases.
The old broad reconstruction API remains available as prepare()/--mode legacy;
it is not a hosted deployment pack. This script never connects to a database.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RECEIPTS = 'backend/supabase/applied-receipts/storyboard-20261003'
RECEIPT_MANIFEST_SHA256 = 'ae47837a19de173c3233235a1e42f17f879d4baf17ddf38e9245ccc518c72ba3'
PROJECT_REF = 'aqlcofblfxdrjhhdmarw'
FORWARD_SET = 'admin-20261004'
BASE_LEDGER_SHA256 = 'e456fc3ac8d39fa467c5c4e6d50d0e9f62e345cf4959e1deb384d262596b54f6'
FORWARD_FILES = {
    '20261003171449_restaurant_review_manual_guards.sql': 'e988b188bef59dead799b0de45713833b6d913af2a5b1ab27e4a27b1d8f98271',
    '20261003172126_restaurant_review_manual_invoker_contract.sql': '8ce3a87564b8b5bb2c4caffd1b62bc2f50c3055f11fc7dc3e2fa9700cffa1af3',
    '20261003182338_storyboard_service_role_bridge.sql': 'd45da517fb2efd94da50c0dc1b78312965f7177a6829b9fb197a0b9d5f144436',
    '20261003193717_restaurant_review_claim_progress.sql': 'a4e98f4c406fc6207468917bcc2ae8ffb958ec2303b314c04ab25705261fc79c',
    '20261003205335_storyboard_uncertain_lease_recovery.sql': '8ff385edd91aced61c6384c28cee78c2b00f6c7a573c0ac24d4d7a4e7ed4a7c0',
    '20261003212017_admin_evaluation_read_helpers.sql': '404331acabd4c3d570e21b0fc1a3d1e2c34dd9525eea7bdbc944bc7c087f261c',
    '20261003215116_admin_evaluation_keyset_queries.sql': 'ed293b5bf50c4dabb58518640ffba0de50c5f6edf18acadb9bae7430a88606f3',
    '20261003220841_admin_evaluation_page_invoker_contract.sql': '4471f02096c0c7ee73d074ea7a3c4c0c36674edbaacbf998f4059d7b48d1f095',
    '20261004003503_admin_evaluation_display_revision.sql': '777f7fb596006864569d8f418f35bbe0a9e2adf9161833eeee612a6196a92781',
    '20261004010334_restaurant_review_identity_evidence.sql': '27f4fd99e909c9d19e7160c79b0a0cfe5ee3e5f7d137e4d3f53de7819f94af63',
    '20261004023841_storyboard_claim_capability_order.sql': 'ac20f93c7feb4febb91a3d4ba187e38feba55427da131e011d730505e3dad8a0',
    '20261004045404_restaurant_review_category_contract.sql': '5f16d4f5b50d4a343a737d96be6465c7bef3a51fd89789deff141f928f5ee600',
    '20261004120000_restaurant_review_gemini_decision.sql': '76c323a3f563a8ef4f20cc35aea9bf495a8f035cad3ed59391f40ed4f1d8fcfc',
}
ROW_KEYS = {'version', 'name', 'statement_count', 'statements_sha256', 'statements_array_sha256'}


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def _selected_rows(ledger: dict) -> list[dict]:
    if not isinstance(ledger, dict) or ledger.get('schemaVersion') != 1 or ledger.get('projectRef') != PROJECT_REF:
        raise ValueError('migration_workspace_ledger_invalid')
    rows = ledger.get('migrations')
    if not isinstance(rows, list) or not rows or len(rows) > 10000 or ledger.get('rowCount') != len(rows):
        raise ValueError('migration_workspace_ledger_invalid')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != ROW_KEYS:
            raise ValueError('migration_workspace_ledger_invalid')
        version, name, count = row['version'], row['name'], row['statement_count']
        if (not isinstance(version, str) or not re.fullmatch(r'(?:\d{8}|\d{14})', version)
                or not isinstance(name, str) or not re.fullmatch(r'[a-z0-9_]{1,128}', name)
                or type(count) is not int or count < 0 or count > 100000):
            raise ValueError('migration_workspace_ledger_invalid')
        if version in seen:
            raise ValueError('migration_workspace_ledger_duplicate')
        seen.add(version)
        if not isinstance(row['statements_array_sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['statements_array_sha256']):
            raise ValueError('migration_workspace_ledger_invalid')
        body_hash = row['statements_sha256']
        if (count == 1 and (not isinstance(body_hash, str) or not re.fullmatch(r'[0-9a-f]{64}', body_hash))) or (count != 1 and body_hash is not None):
            raise ValueError('migration_workspace_ledger_invalid')
    rows = sorted(rows, key=lambda row: row['version'])
    if hashlib.sha256(_canonical(rows)).hexdigest() != BASE_LEDGER_SHA256:
        # No guessed aliases, partial-resume admission or automatic baseline refresh.
        raise ValueError('migration_workspace_base_ledger_drift')
    return rows


def _verified_receipts(root: Path, by_version: dict) -> list[dict]:
    result = []
    manifest_body = (root / RECEIPTS / 'manifest.json').read_bytes()
    if hashlib.sha256(manifest_body).hexdigest() != RECEIPT_MANIFEST_SHA256:
        raise ValueError('migration_workspace_source_drift')
    manifest = json.loads(manifest_body)
    for item in manifest['receipts']:
        archived, original = Path(item['archivedReceipt']), Path(item['originalMigration'])
        if archived.parent != Path(RECEIPTS) or original.parent != Path('backend/supabase/migrations'):
            raise ValueError('migration_workspace_source_path_invalid')
        if (hashlib.sha256((root / archived).read_bytes()).hexdigest() != item['sha256']
                or hashlib.sha256((root / original).read_bytes()).hexdigest() != item['originalSha256']):
            raise ValueError('migration_workspace_source_drift')
        version, name = archived.stem.split('_', 1)
        row = by_version.get(version)
        if row is None or row['name'] != name or row['statement_count'] != 1 or row['statements_sha256'] != item['sha256']:
            raise ValueError('migration_workspace_receipt_unverified')
        result.append({'version': version, 'sha256': item['sha256'],
                       'representedOriginal': original.name, 'newAliasCreated': False})
    return result


def _history_mirror(row: dict) -> bytes:
    # A CLI connected to a missing/mismatched history must fail, not mark a no-op
    # as applied. No original statements (including remote-only SQL) are copied.
    return ("-- Already-applied history mirror; NEVER execute.\n-- "
            + _canonical(row).decode() + "\n"
            "DO $history_mirror$ BEGIN\n"
            "  RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='MIGRATION_HISTORY_MIRROR_EXECUTION_DENIED';\n"
            "END $history_mirror$;\n").encode()


def _base_ledger_check_sql(rows: list[dict]) -> bytes:
    # JSON is generated only from validated identifiers/digests/integers. Run as
    # a separate read-only preflight, not as a new migration/history entry.
    expected = _canonical(rows).decode().replace("'", "''")
    return ("BEGIN READ ONLY;\nDO $ledger_check$\nDECLARE actual jsonb;\nBEGIN\n"
            "  IF current_user <> 'postgres' OR session_user <> 'postgres'\n"
            "     OR current_setting('server_version_num')::integer / 10000 <> 17 THEN\n"
            "    RAISE EXCEPTION 'MIGRATION_WORKSPACE_EXECUTOR_DENIED';\n  END IF;\n"
            "  SELECT coalesce(jsonb_agg(jsonb_build_object(\n"
            "    'version',version,'name',name,'statement_count',cardinality(statements),\n"
            "    'statements_sha256',CASE WHEN cardinality(statements)=1 THEN encode(sha256(convert_to(statements[1],'UTF8')),'hex') END,\n"
            "    'statements_array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')\n"
            "  ) ORDER BY version),'[]'::jsonb) INTO actual FROM supabase_migrations.schema_migrations;\n"
            f"  IF actual IS DISTINCT FROM '{expected}'::jsonb THEN\n"
            "    RAISE EXCEPTION 'MIGRATION_WORKSPACE_BASE_LEDGER_DRIFT';\n  END IF;\n"
            "END $ledger_check$;\nCOMMIT;\n").encode()


def prepare_selected(root: Path, ledger: dict, destination: Path, forward_set: str = FORWARD_SET) -> dict:
    if destination.exists():
        raise ValueError('migration_workspace_destination_exists')
    if forward_set != FORWARD_SET:
        raise ValueError('migration_workspace_forward_set_denied')
    rows = _selected_rows(ledger)
    by_version = {row['version']: row for row in rows}
    receipts = _verified_receipts(root, by_version)
    plan = {f"{row['version']}_{row['name']}.sql": _history_mirror(row) for row in rows}
    pending = []
    for name, expected_sha in FORWARD_FILES.items():
        version, migration_name = Path(name).stem.split('_', 1)
        if version in by_version:
            raise ValueError('migration_workspace_forward_history_collision')
        body = (root / 'backend/supabase/migrations' / name).read_bytes()
        if hashlib.sha256(body).hexdigest() != expected_sha:
            raise ValueError('migration_workspace_source_drift')
        plan[name] = body
        pending.append({'version': version, 'name': migration_name, 'file': name, 'sha256': expected_sha})
    preflight = _base_ledger_check_sql(rows)
    report = {'schemaVersion': 1, 'kind': 'selected-migration-workspace-plan', 'databaseMutations': False,
              'projectRef': PROJECT_REF, 'forwardSet': forward_set, 'baseLedgerSha256': BASE_LEDGER_SHA256,
              'historyMirrorCount': len(rows), 'pendingCount': len(pending), 'pending': pending,
              'aliases': [], 'dependencyAdapters': [], 'verifiedReceipts': receipts,
              'separateOwnerRecovery': '20260906064252_g014_pg17_workflow_owner_contract.sql',
              'ownerRecoveryIncluded': False, 'hostedFinalAssertionExecutorReady': False,
              'optionalWarningRpcIncluded': False, 'fileCount': len(plan),
              'baseLedgerCheckSha256': hashlib.sha256(preflight).hexdigest(),
              'files': [{'name': name, 'kind': 'forward' if name in FORWARD_FILES else 'history-mirror',
                         'sha256': hashlib.sha256(body).hexdigest()} for name, body in sorted(plan.items())]}
    directory = destination / 'supabase/migrations'
    # All admission checks complete before creating output; never overwrite.
    destination.mkdir(parents=True)
    directory.mkdir(parents=True)
    for name, body in sorted(plan.items()):
        (directory / name).write_bytes(body)
    (destination / 'supabase/config.toml').write_text('project_id = "tzudong-rollout-preflight"\n[db.seed]\nenabled = false\n')
    (destination / 'verify-base-ledger.sql').write_bytes(preflight)
    (destination / 'migration-workspace-plan.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def prepare(root: Path, ledger: dict, destination: Path) -> dict:
    """Legacy reconstruction API; broad history is unsuitable for hosted push."""
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
    parser.add_argument('--mode', choices=['selected', 'legacy'], default='selected')
    parser.add_argument('--forward-set', choices=[FORWARD_SET], default=FORWARD_SET)
    args=parser.parse_args()
    ledger = json.loads(args.ledger.read_text())
    report = (prepare_selected(ROOT, ledger, args.destination, args.forward_set) if args.mode == 'selected'
              else prepare(ROOT, ledger, args.destination))
    print(json.dumps({'databaseMutations': False, 'mode': args.mode, 'fileCount': report['fileCount'],
                      'pendingCount': report.get('pendingCount'), 'aliases': report['aliases']}))
