"""Pinned read-only replay contracts; never an application or execution receipt.

The executor must independently run the pinned verifier against its admitted
local database. This module validates bytes and result shape only; a matching
JSON object alone does not establish that any database operation occurred.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'local-replay-proof-v1'
# Changes to these pins require review alongside immutable source/verifier tests.
_CONTRACTS = {'backend/supabase/migrations/20260906040116_admin_user_ids_catalog_slice.sql': {'bindings': {'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql': 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf',
                                                                                              'backend/supabase/migrations/20260906040116_admin_user_ids_catalog_slice.sql': 'f1b5a6878752c3004f74e057cf230bf26acca432271415f609c103b2bd1cb492',
                                                                                              'backend/supabase/scripts/verify_admin_user_ids_replay.py': '8e8168b6b13a4310b158cf13dc8e19f00b77a3ac45f2fd64555ed4f68bc8d739'},
                                                                                 'disposition': 'verified-existing',
                                                                                 'receipt': {'body_sha256': 'be57e320d7a79e6e7382bce9e942b3e684fc50246beb44deaa67c408cb553acd',
                                                                                             'disposition': 'already-present-contract-verified',
                                                                                             'predecessor_sha256': 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf',
                                                                                             'read_only': True,
                                                                                             'schema': 'admin-ids-source-replay-overlap-v1',
                                                                                             'source_sha256': 'f1b5a6878752c3004f74e057cf230bf26acca432271415f609c103b2bd1cb492'},
                                                                                 'source': 'backend/supabase/migrations/20260906040116_admin_user_ids_catalog_slice.sql',
                                                                                 'sql_sha256': '2f9b182877b730fcb1b0624a76ce837312a378d274864ccaf7518a861b56655a'},
 'backend/supabase/migrations/20260906053936_admin_management_group_catalog_slice.sql': {'bindings': {'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql': 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf',
                                                                                                      'backend/supabase/migrations/20260906053936_admin_management_group_catalog_slice.sql': '4fea6a4912536cf1c1531b092d309f8206a7c6d28edd0558a9fceae940757b00',
                                                                                                      'backend/supabase/scripts/admin_management_group_plan.py': 'c640778e56ed2e2399fe5c26b35e8fe96a2ee3a02418eb371ac634a5199a5bf9',
                                                                                                      'backend/supabase/scripts/advisor_successor_plan.py': 'cb5d84b85d09b8c89a1d88abdd142551930b33445bfda178b30f982015d83813',
                                                                                                      'backend/supabase/scripts/g037_supabase_statement_vector.mjs': '398e3945c0d0fb656daef0d0a42409dbdeb45a9bb1f6f8c03445e4436d4db0bd',
                                                                                                      'backend/supabase/scripts/verify_admin_management_group_replay.py': 'ececc15a04ba14a6799af9026df4374cb9acdc5efb571b4b58e0ead9f49ab161'},
                                                                                         'disposition': 'verified-existing',
                                                                                         'receipt': {'already_present_contract_verified': True,
                                                                                                     'predecessor_sha256': 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf',
                                                                                                     'read_only': True,
                                                                                                     'schema': 'admin-management-group-source-overlap-v1',
                                                                                                     'source_sha256': '4fea6a4912536cf1c1531b092d309f8206a7c6d28edd0558a9fceae940757b00'},
                                                                                         'source': 'backend/supabase/migrations/20260906053936_admin_management_group_catalog_slice.sql',
                                                                                         'sql_sha256': '0481649aff11e7342313adad2490201231493c57fc67b2f4ce77bd17294a6743'},
 'backend/supabase/migrations/20260906064252_g014_pg17_workflow_owner_contract.sql': {'bindings': {'backend/supabase/migrations/20260906064252_g014_pg17_workflow_owner_contract.sql': '8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483',
                                                                                                   'backend/supabase/scripts/verify_g014_pg17_owner_replay.py': '8b8ac9857b5931d2e7609280f85a95264fb854ef374d969d25d1f7c3ead3b2c0'},
                                                                                      'disposition': 'legacy-contract-preserved',
                                                                                      'receipt': {'disposition': 'legacy-contract-preserved',
                                                                                                  'read_only': True,
                                                                                                  'schema': 'g014-owner-pg15-replay-v1',
                                                                                                  'source_sha256': '8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483'},
                                                                                      'source': 'backend/supabase/migrations/20260906064252_g014_pg17_workflow_owner_contract.sql',
                                                                                      'sql_sha256': '3a95ed40845582f62d8f404c509539eb35f2f82f841c6c91830a9c6a8921fb69'}}


class ReplayContractError(ValueError):
    """Bounded code, without raw SQL, provider output or arbitrary input."""


def canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode()
    except (ValueError, TypeError, RecursionError) as error:
        raise ReplayContractError('replay_json_invalid') from error


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def supported_sources() -> tuple[str, ...]:
    return tuple(sorted(_CONTRACTS))


def _read_bound(root: Path, relative: str, expected: str) -> None:
    path = root
    if root.is_symlink():
        raise ReplayContractError('replay_source_custody')
    try:
        for component in Path(relative).parts:
            path = path / component
            if path.is_symlink():
                raise ReplayContractError('replay_source_custody')
        metadata = path.stat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_size > 2_000_000:
            raise ReplayContractError('replay_source_custody')
        if digest(path.read_bytes()) != expected:
            raise ReplayContractError('replay_source_drift')
    except OSError as error:
        raise ReplayContractError('replay_source_custody') from error


def plan(migration_path: str, *, root: Path = ROOT) -> dict[str, Any]:
    if migration_path not in _CONTRACTS:
        raise ReplayContractError('replay_source_unsupported')
    contract = _CONTRACTS[migration_path]
    for path, expected in contract['bindings'].items():
        _read_bound(root, path, expected)
    return {
        'schema': SCHEMA,
        'migration_path': migration_path,
        'source_sha256': contract['bindings'][migration_path],
        'disposition': contract['disposition'],
        'bindings': dict(contract['bindings']),
        'bindings_sha256': digest(canonical(contract['bindings'])),
        'verification_sql_sha256': contract['sql_sha256'],
    }


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ReplayContractError('replay_receipt_duplicate_key')
        result[key] = value
    return result


def assemble_proof(migration_path: str, verification_sql: bytes, receipt_json: bytes, *, root: Path = ROOT) -> dict[str, Any]:
    result = plan(migration_path, root=root)
    if digest(verification_sql) != result['verification_sql_sha256']:
        raise ReplayContractError('replay_sql_drift')
    if len(receipt_json) > 16_384:
        raise ReplayContractError('replay_receipt_invalid')
    try:
        receipt = json.loads(receipt_json, object_pairs_hook=_unique_object)
    except ReplayContractError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise ReplayContractError('replay_receipt_invalid') from error
    # Canonical bytes distinguish JSON true from the number 1; no extra keys.
    if canonical(receipt) != canonical(_CONTRACTS[migration_path]['receipt']):
        raise ReplayContractError('replay_receipt_mismatch')
    return {**result, 'receipt': receipt, 'receipt_sha256': digest(canonical(receipt))}


def validate_proof(proof: dict[str, Any], verification_sql: bytes, *, root: Path = ROOT) -> None:
    if not isinstance(proof, dict) or not isinstance(proof.get('migration_path'), str) or 'receipt' not in proof:
        raise ReplayContractError('replay_proof_invalid')
    expected = assemble_proof(proof['migration_path'], verification_sql, canonical(proof['receipt']), root=root)
    if canonical(proof) != canonical(expected):
        raise ReplayContractError('replay_proof_mismatch')


def expected_proof_shape(migration_path: str, *, root: Path = ROOT) -> dict[str, Any]:
    """Expected comparison value only, never evidence of database execution."""
    binding = plan(migration_path, root=root)
    receipt = dict(_CONTRACTS[migration_path]['receipt'])
    return {**binding, 'receipt': receipt, 'receipt_sha256': digest(canonical(receipt))}


def generate_verification_sql(migration_path: str, *, root: Path = ROOT) -> bytes:
    """Run the pinned offline generator, then recheck inputs and exact SQL bytes."""
    import subprocess
    import sys
    import tempfile
    binding = plan(migration_path, root=root)
    verifier = next(path for path in binding['bindings'] if '/verify_' in path)
    predecessors = [path for path in binding['bindings'] if '/migrations/' in path and path != migration_path]
    with tempfile.TemporaryDirectory(prefix='tzudong-replay-') as directory:
        output = Path(directory) / 'verification.sql'
        args = [sys.executable, str(root / verifier), '--source', str(root / migration_path), '--output', str(output)]
        if predecessors:
            args += ['--predecessor', str(root / predecessors[0])]
        try:
            result = subprocess.run(args, capture_output=True, timeout=30, env={'PATH': os.defpath})
            if result.returncode != 0:
                raise ReplayContractError('replay_generator_failed')
            sql = output.read_bytes()
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ReplayContractError('replay_generator_failed') from error
    if plan(migration_path, root=root) != binding or digest(sql) != binding['verification_sql_sha256']:
        raise ReplayContractError('replay_sql_drift')
    return sql


def main() -> int:
    import argparse
    parser = argparse.ArgumentParser(description='Inspect pinned local replay bindings; does not execute SQL or admit a runtime.')
    parser.add_argument('--migration', required=True)
    args = parser.parse_args()
    try:
        print(canonical(plan(args.migration)).decode())
        return 0
    except ReplayContractError as error:
        print(str(error))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
