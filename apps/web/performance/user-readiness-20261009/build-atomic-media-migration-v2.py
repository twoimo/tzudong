"""Bind three unapplied canonical units into one outer transaction.

Only their exact top-level BEGIN;/COMMIT; lines are removed. Function/DO bodies
remain byte-for-byte unchanged. This is a hosted preparation artifact, not an
additional canonical replay unit or proof of operating application.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
SOURCES = [
    '20261008192455_review_media_commit_cleanup.sql',
    '20261008200719_review_verification_private.sql',
    '20261008201635_review_media_catalog_integration.sql',
]
parts = ['BEGIN;\n']
binding = []
for name in SOURCES:
    path = ROOT / 'backend/supabase/migrations' / name
    raw = path.read_bytes()
    lines = raw.decode().splitlines(keepends=True)
    if sum(line.strip('\r\n') == 'BEGIN;' for line in lines) != 1 or sum(line.strip('\r\n') == 'COMMIT;' for line in lines) != 1:
        raise SystemExit('CANONICAL_TRANSACTION_ENVELOPE_MISMATCH')
    parts.append(f'-- Canonical source: {name}\n')
    parts.extend(line for line in lines if line.strip('\r\n') not in ['BEGIN;', 'COMMIT;'])
    parts.append('\n')
    binding.append({'source': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
parts.append('COMMIT;\n')
sql = ''.join(parts).encode()
with (HERE / 'atomic-media-migration-v2.sql').open('xb') as file:
    file.write(sql)
with (HERE / 'atomic-media-migration-v2-binding.json').open('x') as file:
    json.dump({'sources': binding, 'sha256': hashlib.sha256(sql).hexdigest(),
               'transform': 'exact top-level transaction envelope only', 'operatingApplied': False}, file, indent=2)
    file.write('\n')
print(json.dumps({'sha256': hashlib.sha256(sql).hexdigest(), 'sources': len(binding)}))
