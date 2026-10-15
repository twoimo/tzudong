"""Independent, credential-free validation of the immutable causal pilot checkpoint."""
from pathlib import Path
import hashlib
import json
import math
import subprocess

repo = Path(__file__).resolve().parents[2]
root = repo / 'apps/web/performance/marker-category-rebind-20261015-v1/pilot-checkpoint-v1'
map_path = root / 'artifact-map-v1.json'
pin = (repo / 'docs/evidence/marker-category-pilot-20261015-map-v1.sha256').read_text().split()[0]
assert hashlib.sha256(map_path.read_bytes()).hexdigest() == pin, 'DETACHED_MAP_PIN_MISMATCH'
manifest = json.loads(map_path.read_bytes())
seen = set()
for entry in manifest['entries']:
    name = entry['path']
    path = root / name
    assert name not in seen and not path.is_symlink() and path.is_file(), 'UNSAFE_ARTIFACT'
    assert path.resolve().is_relative_to(root.resolve()), 'PATH_ESCAPE'
    data = path.read_bytes()
    assert len(data) == entry['bytes'] and hashlib.sha256(data).hexdigest() == entry['sha256'], 'ARTIFACT_BYTES_MISMATCH'
    seen.add(name)
actual = {str(path.relative_to(root)) for path in root.rglob('*') if path.is_file() and path != map_path}
assert seen == actual, 'ARTIFACT_COMPLETE_SET_MISMATCH'
load = lambda name: json.loads((root / name).read_bytes())
summary = load('pilot-summary-v1.json')
before = load('ui-pilot-before-64/raw.json')
after = load('ui-pilot-after-64/raw.json')
for row in [before, after]:
    assert row['passed'] and row['diagnosticOnly'] and row['diagnosticForcedGC'], 'DIAGNOSTIC_BOUNDARY_LOST'
    assert len(row['cycles']) == 64 and row['sdkScript']['sha256'] == summary['actualSdkHash'], 'SDK_OR_FLOW_MISMATCH'
    assert row['sdk']['loaded'] and row['sdk']['remoteScript'] and not row['sdk']['stub'], 'STUB_NOT_ALLOWED'
    assert row['actualSdkIdentityCheck']['mismatches'] == 0, 'SDK_DOM_ID_MISMATCH'
    for cycle in row['cycles']:
        state = cycle['state']
        assert cycle['relatedDeletedReviewObserved'] and state['panelMatches'] and state['selectedMarkerPresent'], 'FLOW_MISMATCH'
        assert state['duplicateMarkers'] == 0 and state['mapCreates'] == 1, 'DUPLICATE_OR_REMOUNT'
a, b = before['markerCalls']['setIcon'], after['markerCalls']['setIcon']
metric = summary['sdkSetIcon']
assert (a, b, a - b) == (2207, 1143, metric['absoluteDecrease']), 'COUNTER_MISMATCH'
assert math.isclose(metric['relativeImprovementPercent'], (a - b) / a * 100), 'RATIO_MISMATCH'
assert metric['confidenceInterval'] is None and summary['performanceAdmission'] == summary['fieldAdmission'] == 0, 'OVERCLAIM'
assert before['markerCalls']['created'] == after['markerCalls']['created'] == 164
dom = load('real-dom-check-v4.json')
assert dom['passed'] and len(dom['cases']) == 18 and all(case['passed'] for case in dom['cases'])
assert dom['listeners']['added'] == dom['listeners']['removed'] == 18
assert not load('real-dom-check-v1.json')['passed'] and not load('real-dom-check-v2.json')['passed']
assert load('ui-pilot-before-4/raw.json')['markerCalls']['setIcon'] == load('ui-pilot-after-4/raw.json')['markerCalls']['setIcon'] == 40
validation = load('validation-v3.json')
assert validation['unit'] == {'pass': 34, 'fail': 0, 'assertions': 1231, 'files': 3}
assert validation['parity']['status'] == 'passed' and validation['parity']['diagnostics'] == 0
receipts = load('build-receipts-v2.json')
for receipt in receipts:
    assert receipt['build']['exit'] == receipt['cssGate']['exit'] == 0
    source = subprocess.check_output(['git', 'show', receipt['sourceCommit'] + ':apps/web/lib/marker-pool.ts'], cwd=repo)
    assert hashlib.sha256(source).hexdigest() == receipt['markerPoolSourceSha256'], 'SOURCE_BINDING_MISMATCH'
assert validation['markerPoolSha256'] == receipts[1]['markerPoolSourceSha256'] == load('dom-v4-source-binding.json')['markerPoolSha256']
scored = load('canonical-zero-v1/backlog.scored.json')
assert not scored['items'] and not scored['ranking']['admittedIds'] and scored['releaseBlocked'], 'CANONICAL_ADMISSION_DRIFT'
assert load('canonical-zero-v1/basis.json')['admissions'] == 0
print(json.dumps({'status': 'passed', 'mappedFiles': len(seen), 'actualSdkPilotProcesses': 2,
                  'dependentActionsPerProcess': 64, 'domCases': 18, 'admitted': 0,
                  'memoryOrLatencyImprovementClaim': False, 'productionPhysicalOrFieldClaim': False}))
