"""Validate exact retained bytes using an externally supplied artifact-map SHA."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
repository = root.parents[3]
expected = sys.argv[1]
assert len(expected) == 64
manifest_bytes = (root / 'artifact-map.json').read_bytes()
assert hashlib.sha256(manifest_bytes).hexdigest() == expected
manifest = json.loads(manifest_bytes)
for item in manifest['artifacts']:
    target = (root / item['path']).resolve()
    assert target.is_relative_to(root)
    value = target.read_bytes()
    assert len(value) == item['bytes']
    assert hashlib.sha256(value).hexdigest() == item['sha256'], item['path']
bindings = json.loads((root / 'source-bindings.json').read_text())
for item in bindings['sources']:
    value = (repository / item['path']).read_bytes()
    assert len(value) == item['bytes']
    assert hashlib.sha256(value).hexdigest() == item['sha256'], item['path']
assert json.loads((root / 'scored.json').read_text())['absoluteBudgetAllTenSamplesPassed']
print(json.dumps({'verified': True, 'artifacts': len(manifest['artifacts']), 'sources': len(bindings['sources']), 'artifactMapSha256': expected}))
