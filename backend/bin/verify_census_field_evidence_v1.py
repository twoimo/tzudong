"""Independently verify detached pins, exact bytes and sealed-tree coverage."""
from pathlib import Path, PurePosixPath
import hashlib
import json

repo = Path(__file__).resolve().parents[2]
packages = [
    ('apps/web/performance/tzuyang-review-census-20261009/checkpoint-v1',
     'docs/evidence/tzuyang-census-checkpoint-v1.sha256'),
    ('apps/web/performance/field-readback-20261009-v1',
     'docs/evidence/field-readback-20261009-map-v1.sha256'),
]
results = []
for relative, pin_path in packages:
    root = repo / relative
    mapping = root / 'artifact-map-v1.json'
    digest = hashlib.sha256(mapping.read_bytes()).hexdigest()
    if digest != (repo / pin_path).read_text().strip():
        raise SystemExit('EVIDENCE_PIN_DENIED')
    data = json.loads(mapping.read_text())
    if data['performanceAdmission'] != 0:
        raise SystemExit('UNPROVEN_PERFORMANCE_ADMISSION')
    seen = set()
    for row in data['artifacts']:
        if set(row) != {'path', 'sha256', 'bytes'}:
            raise SystemExit('EVIDENCE_FIELDS_DENIED')
        p = PurePosixPath(row['path'])
        if p.is_absolute() or '..' in p.parts or '\\' in row['path'] or str(p) != row['path'] or row['path'] in seen:
            raise SystemExit('EVIDENCE_PATH_DENIED')
        seen.add(row['path'])
        target = root.joinpath(*p.parts)
        if target.is_symlink() or root.resolve() not in target.resolve().parents:
            raise SystemExit('EVIDENCE_ESCAPE_DENIED')
        raw = target.read_bytes()
        if type(row['bytes']) is not int or len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise SystemExit('EVIDENCE_BYTES_DENIED')
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p != mapping}
    if actual != seen:
        raise SystemExit('EVIDENCE_COVERAGE_DENIED')
    results.append({'root': relative, 'files': len(seen), 'mapSha256': digest,
                    'status': 'passed', 'completeTree': True, 'byteEquality': True,
                    'performanceAdmission': 0})
print(json.dumps({'packages': results}))
