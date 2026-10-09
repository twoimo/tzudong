#!/usr/bin/env python3
"""PG15 catalog-only disposition for the exact PG17 hosted final verifier.

This verifies the unchanged legacy owner contract. It neither executes the
hosted verifier nor substitutes a PG15 ledger for its required hosted 77 rows.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

SOURCE_SHA256 = 'a17af9470c5ce0816b673ff9f5ffd5332726875ac3924764547d8f2eb85f9545'
PREDECESSOR_SHA256 = '8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483'
LEGACY_ADAPTER_SHA256 = '8b8ac9857b5931d2e7609280f85a95264fb854ef374d969d25d1f7c3ead3b2c0'
LEGACY_SQL_SHA256 = '3a95ed40845582f62d8f404c509539eb35f2f82f841c6c91830a9c6a8921fb69'
RECEIPT = {
    'schema': 'g014-owner-final-pg15-replay-v1',
    'read_only': True,
    'disposition': 'legacy-contract-preserved',
    'source_sha256': SOURCE_SHA256,
    'predecessor_sha256': PREDECESSOR_SHA256,
    'hosted_final_verifier_executed': False,
    'hosted_ledger_admission_verified': False,
    'required_hosted_pg_major': 17,
    'required_hosted_ledger_count': 77,
}


def verification_sql(source: bytes, predecessor: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('g014_owner_final_replay_source_drift')
    if hashlib.sha256(predecessor).hexdigest() != PREDECESSOR_SHA256:
        raise ValueError('g014_owner_final_replay_predecessor_drift')
    path = Path(__file__).with_name('verify_g014_pg17_owner_replay.py')
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != LEGACY_ADAPTER_SHA256:
        raise ValueError('g014_owner_final_replay_dependency_drift')
    spec = importlib.util.spec_from_file_location('_g014_legacy_owner_replay', path)
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    sql = legacy.verification_sql(predecessor)
    if hashlib.sha256(sql).hexdigest() != LEGACY_SQL_SHA256:
        raise ValueError('g014_owner_final_replay_sql_drift')
    # Reuse the exact reviewed predicates and transaction. Only the final
    # receipt changes, explicitly recording the unexecuted hosted admission.
    prefix, separator, _ = sql.rpartition(b'\nSELECT ')
    if not separator:
        raise ValueError('g014_owner_final_replay_receipt_anchor')
    return prefix + ("\nSELECT '" + json.dumps(RECEIPT, sort_keys=True) + "'::jsonb AS receipt;\nCOMMIT;\n").encode()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--predecessor', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = verification_sql(args.source.read_bytes(), args.predecessor.read_bytes())
    with args.output.open('xb') as output:
        output.write(data)
