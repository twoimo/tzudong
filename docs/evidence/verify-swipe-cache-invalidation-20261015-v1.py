"""Verify the fixed synthetic cases and exact source blobs without accessing services."""
from pathlib import Path
import hashlib
import json
import subprocess

repo = Path(__file__).resolve().parents[2]
root = repo / 'apps/web/performance/cache-invalidation-audit-20261015-v1'
map_path = root / 'artifact-map-v1.json'
pin = (repo / 'docs/evidence/swipe-cache-invalidation-20261015-map-v1.sha256').read_text().split()[0]
assert hashlib.sha256(map_path.read_bytes()).hexdigest() == pin
manifest = json.loads(map_path.read_bytes())
seen = set()
for entry in manifest['entries']:
    path = root / entry['path']
    assert path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve())
    assert entry['path'] not in seen
    data = path.read_bytes()
    assert len(data) == entry['bytes'] and hashlib.sha256(data).hexdigest() == entry['sha256']
    seen.add(entry['path'])
assert seen == {path.name for path in root.iterdir() if path.is_file() and path != map_path}
load = lambda name: json.loads((root / name).read_bytes())
before, after = load('baseline-reproduction-v1.json'), load('candidate-reproduction-v1.json')
assert before['failures'] == 5 and not before['passed'] and after['failures'] == 0 and after['passed']
assert len(before['cases']) == len(after['cases']) == 5
for a, b in zip(before['cases'], after['cases']):
    assert a['name'] == b['name'] and a['expected'] == b['expected']
    assert a['afterMutationFresh'] == a['expected'] and a['afterMutationCached'] != a['expected']
    assert b['afterMutationFresh'] == b['afterMutationCached'] == b['expected']
validation = load('validation-v1.json')
for sha, expected in [(validation['sourceBefore'], before['helperSourceSha256']), (validation['sourceAfter'], after['helperSourceSha256'])]:
    blob = subprocess.check_output(['git', 'show', sha + ':apps/web/lib/mobile-home-search-selection.ts'], cwd=repo)
    assert hashlib.sha256(blob).hexdigest() == expected
assert validation['unit'] == {'pass': 31, 'fail': 0, 'assertions': 2067, 'files': 2, 'newRegressionCases': 8}
assert validation['performanceAdmission'] == validation['fieldAdmission'] == 0
assert validation['browserUiEquivalence'] == 'pending' and validation['finalCandidateBlobMatchesReceipt']
print(json.dumps({'status': 'passed', 'mappedFiles': len(seen), 'fixedSyntheticCases': 5,
                  'browserOrPerformanceProof': False, 'productionDeployment': False, 'fieldAdmission': 0}))
