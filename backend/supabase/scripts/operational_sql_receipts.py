#!/usr/bin/env python3
"""Verify archived SQL bytes against historical hosted readback; never execute SQL.

These two snapshot-specific operations are not fresh-schema migrations. Their
original identity and CLI statement receipts remain historical execution proof;
PG15 source verifiers produce separate, explicitly read-only dispositions.
"""
import hashlib
import json
from pathlib import Path
import stat

ROOT = Path(__file__).resolve().parents[3]
ARCHIVE = Path('backend/supabase/applied-receipts/owner-recovery-20261004')
MANIFEST_SHA256 = 'b3e4a93e82a9687dae70072cbd5f534e1e4bc60ae2d9ac2f1ac79b4234190b15'


def _read(root: Path, relative: str, expected_sha: str) -> bytes:
    path = root
    if path.is_symlink() or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('operational_receipt_custody')
    try:
        for part in Path(relative).parts:
            path = path / part
            if path.is_symlink(): raise ValueError('operational_receipt_custody')
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 2_000_000:
            raise ValueError('operational_receipt_custody')
        data = path.read_bytes()
    except OSError as error:
        raise ValueError('operational_receipt_custody') from error
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError('operational_receipt_source_drift')
    return data


def verify_archive(*, root: Path = ROOT) -> dict:
    manifest = json.loads(_read(root, (ARCHIVE / 'manifest.json').as_posix(), MANIFEST_SHA256))
    binding = manifest['readback']
    readback = json.loads(_read(root, binding['path'], binding['sha256']))
    rows = readback['ledger']
    if (readback['exitCode'] != 0 or readback['ledgerCount'] != 78 or len(rows) != 78
        or len({row['version'] for row in rows}) != 78
        or readback['projectRef'] != binding['projectRef']
        or readback['at'] != binding['observedAt']):
        raise ValueError('operational_receipt_readback_drift')
    for item in manifest['receipts']:
        if (root / item['originalPath']).exists() or (root / item['originalPath']).is_symlink():
            raise ValueError('operational_receipt_in_fresh_chain')
        data = _read(root, item['archivePath'], item['sourceSha256'])
        if len(data) != item['byteLength']:
            raise ValueError('operational_receipt_source_drift')
        row = next((row for row in rows if row['version'] == item['version']), None)
        expected = {'version': item['version'], 'name': item['name'], 'statement_count': 1,
                    'statements_sha256': item['actualStatementSha256'],
                    'statements_array_sha256': item['actualStatementsArraySha256']}
        if row != expected:
            raise ValueError('operational_receipt_ledger_drift')
        # CLI 2.119's observed single-statement normalization. This comparison
        # verifies an existing receipt; it never manufactures an applied ledger.
        statement = data.decode().strip().removesuffix(';')
        array = json.dumps([statement], ensure_ascii=False, separators=(',', ':')).encode()
        if (hashlib.sha256(statement.encode()).hexdigest() != item['actualStatementSha256']
            or hashlib.sha256(array).hexdigest() != item['actualStatementsArraySha256']):
            raise ValueError('operational_receipt_statement_drift')
    return manifest


def source_bytes(filename: str, *, root: Path = ROOT) -> bytes:
    manifest = verify_archive(root=root)
    item = next((row for row in manifest['receipts'] if Path(row['archivePath']).name == filename), None)
    if item is None: raise ValueError('operational_receipt_unknown')
    return _read(root, item['archivePath'], item['sourceSha256'])


if __name__ == '__main__':
    manifest = verify_archive()
    print(json.dumps({'kind': 'verified-operational-sql-archive', 'databaseMutations': False,
                      'hostedExecutionPerformed': False, 'historicalLedgerCount': 78,
                      'manifestSha256': MANIFEST_SHA256,
                      'receipts': manifest['receipts']}, sort_keys=True))
