"""Verify a complete packet against its external pin without modifying it."""
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve();pin=Path(sys.argv[2]).read_text().split()[0]
mapping=root/'artifact-map.json'
assert hashlib.sha256(mapping.read_bytes()).hexdigest()==pin
index=json.loads(mapping.read_text());assert index['schemaVersion']=='render-flow-evidence-map.v1'
actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p!=mapping}
assert actual==set(index['artifacts'])
for relative,want in index['artifacts'].items():
    path=root/relative;assert not path.is_symlink() and path.resolve().is_relative_to(root)
    data=path.read_bytes();assert len(data)==want['size'] and hashlib.sha256(data).hexdigest()==want['sha256']
print(json.dumps({'verifiedFiles':len(actual),'artifactMapExternalPinMatches':True}))
