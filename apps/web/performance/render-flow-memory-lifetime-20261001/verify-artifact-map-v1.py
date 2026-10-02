"""Independently verify the complete packet against an external SHA-256 pin."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
pin = Path(sys.argv[2]).read_text().split()[0]
artifact_map = root / 'artifact-map.json'
assert hashlib.sha256(artifact_map.read_bytes()).hexdigest() == pin
mapping = json.loads(artifact_map.read_text())
assert mapping['schemaVersion'] == 'render-flow-evidence-map.v1'
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p != artifact_map}
assert actual == set(mapping['artifacts']), 'missing or unexpected packet files'
for relative, expected in mapping['artifacts'].items():
    target = root / relative
    assert not target.is_symlink()
    assert target.resolve().is_relative_to(root)
    data = target.read_bytes()
    assert len(data) == expected['size']
    assert hashlib.sha256(data).hexdigest() == expected['sha256']
print(json.dumps({'verifiedFiles':len(actual),'artifactMapExternalPinMatches':True}))
