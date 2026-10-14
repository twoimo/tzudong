"""Verify the frozen packet from immutable Git objects, not checkout files."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

repo = Path(__file__).resolve().parents[2]
sha = sys.argv[1]
if not re.fullmatch('[0-9a-f]{40}', sha):
    raise ValueError('EXACT_COMMIT_REQUIRED')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo)


def blob(path):
    return git('show', sha + ':' + path)


pin_path = 'docs/evidence/review-candidate-union-20261014-map-v1.sha256'
pin_bytes = blob(pin_path)
pin = json.loads(pin_bytes)
if pin_bytes != (repo / pin_path).read_bytes():
    raise ValueError('DETACHED_PIN_BYTES_MISMATCH')
map_bytes = blob(pin['map'])
if hashlib.sha256(map_bytes).hexdigest() != pin['sha256']:
    raise ValueError('MAP_HASH_MISMATCH')
mapping = json.loads(map_bytes)
root = mapping['root']
if not root.startswith('apps/web/performance/') or root != str(Path(pin['map']).parent):
    raise ValueError('ROOT_MISMATCH')
files = mapping['files']
entries = git('ls-tree', '-rz', sha, '--', root).split(b'\0')
actual = set()
for entry in filter(None, entries):
    header, path = entry.split(b'\t', 1)
    mode, kind, _ = header.decode().split()
    if mode not in ['100644', '100755'] or kind != 'blob':
        raise ValueError('UNSAFE_REMOTE_FILE')
    name = path.decode()
    if name != pin['map']:
        actual.add(str(Path(name).relative_to(root)))
if actual != set(files) or len(files) != pin['mappedFiles']:
    raise ValueError('REMOTE_COMPLETE_SET_MISMATCH')
for relative, expected in files.items():
    if Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('UNSAFE_RELATIVE_PATH')
    data = blob(root + '/' + relative)
    if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
        raise ValueError('REMOTE_BLOB_BYTES_MISMATCH')
remote = git('ls-remote', '--heads', 'origin', 'codex/goal-evidence-20261013-v1').decode().split()[0]
if remote != sha:
    raise ValueError('REMOTE_HEAD_CHANGED_RECONCILE_BEFORE_DELIVERY')
receipt = {'atUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'commit': sha, 'remoteHeadEqual': True, 'mappedFiles': len(files),
           'completeSet': True, 'detachedPinEqual': True,
           'mapSha256': pin['sha256'], 'allBlobBytesEqual': True,
           'sourceCandidateAdmitted': False, 'fieldAdmission': 0,
           'operatingDeploymentChanged': False}
output = repo / 'docs/evidence/review-candidate-union-remote-readback-v1.json'
with output.open('x') as stream:
    json.dump(receipt, stream, indent=2)
    stream.write('\n')
print(json.dumps(receipt))
