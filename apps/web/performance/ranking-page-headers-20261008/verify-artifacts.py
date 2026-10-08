#!/usr/bin/env python3
"""Independent byte verifier; it does not score performance or claim admission."""
from pathlib import Path
import argparse
import hashlib
import json

parser = argparse.ArgumentParser()
parser.add_argument('--map', required=True)
parser.add_argument('--pin', required=True)
args = parser.parse_args()
mapping = Path(args.map).resolve(strict=True)
pin = json.loads(Path(args.pin).read_text())
raw = mapping.read_bytes()
assert hashlib.sha256(raw).hexdigest() == pin['artifactMapSha256'], 'detached_pin_mismatch'
data = json.loads(raw)
root = mapping.parent
actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
assert actual == set(data['artifacts']) | {mapping.name}, 'artifact_file_set_mismatch'
total = 0
for name, expected in data['artifacts'].items():
    p = root / name
    assert not p.is_symlink() and p.resolve().is_relative_to(root), 'artifact_alias_denied'
    value = p.read_bytes()
    assert len(value) == expected['size'], 'artifact_size_mismatch'
    assert hashlib.sha256(value).hexdigest() == expected['sha256'], 'artifact_hash_mismatch'
    total += len(value)
print(json.dumps({'status':'passed','mappedArtifacts':len(data['artifacts']),
                  'mappedBytes':total,'admissionClaim':False,'goalComplete':False}))
