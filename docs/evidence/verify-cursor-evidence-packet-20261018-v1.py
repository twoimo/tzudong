"""Independently verify bytes and the complete file set against a detached pin."""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import re

parser = argparse.ArgumentParser()
parser.add_argument('root', type=Path)
parser.add_argument('pin', type=Path)
args = parser.parse_args()
root = args.root.resolve(strict=True)
map_path = root / 'artifact-map-v1.json'
expected = args.pin.read_text().strip()
if not re.fullmatch(r'[a-f0-9]{64}', expected):
    raise ValueError('INVALID_DETACHED_PIN')
digest = lambda data: hashlib.sha256(data).hexdigest()
if digest(map_path.read_bytes()) != expected:
    raise ValueError('MAP_PIN_MISMATCH')
manifest = json.loads(map_path.read_bytes())
if manifest['schemaVersion'] != 'tzudong-complete-set-artifact-map.v1':
    raise ValueError('UNSUPPORTED_COMPLETE_SET_SCHEMA')
listed = set()
for entry in manifest['entries']:
    relative = PurePosixPath(entry['path'])
    if relative.is_absolute() or '..' in relative.parts or str(relative) in listed:
        raise ValueError('INVALID_OR_DUPLICATE_PATH')
    listed.add(str(relative))
    source = root / relative
    if source.is_symlink() or not source.resolve(strict=True).is_relative_to(root):
        raise ValueError('UNTRUSTED_SOURCE_PATH')
    data = source.read_bytes()
    if len(data) != entry['bytes'] or digest(data) != entry['sha256']:
        raise ValueError('ARTIFACT_BYTES_MISMATCH')
actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p != map_path}
if actual != listed:
    raise ValueError('COMPLETE_FILE_SET_MISMATCH')
print(json.dumps({'passed': True, 'files': len(listed), 'mapSha256': expected}))
