"""Validate preserved complete/partial attempts without computing performance outcomes."""
from pathlib import Path
import hashlib
import json

repo = Path(__file__).resolve().parents[2]
root = repo / 'apps/web/performance/marker-category-rebind-20261015-v1/interruption-checkpoint-v1'
mp = root / 'artifact-map-v1.json'
pin = (repo / 'docs/evidence/marker-natural-interruption-20261015-map-v1.sha256').read_text().split()[0]
assert hashlib.sha256(mp.read_bytes()).hexdigest() == pin
seen = set()
for row in json.loads(mp.read_bytes())['entries']:
    path = root / row['path']
    assert path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve())
    assert row['path'] not in seen
    data = path.read_bytes()
    assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256']
    seen.add(row['path'])
assert seen == {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p != mp}
receipt = json.loads((root / 'reconciliation.json').read_bytes())
assert receipt['oldParentAbsent'] and receipt['originalStateFilePreserved']
assert not receipt['performanceOutcomeValuesInspected'] and len(receipt['completed']) == 16
for row in receipt['completed']:
    data = (root / 'completed' / ('ui-' + row['logicalLabel']) / 'raw.json').read_bytes()
    assert hashlib.sha256(data).hexdigest() == row['rawSha256']
    value = json.loads(data)
    assert value['passed'] and len(value['cycles']) == 256 and value['environment']['forcedGC'] is False
    assert value['sourceCommit'] == row['sourceCommit']
partial = root / 'partial' / ('ui-' + receipt['incompleteLabel'])
assert partial.is_dir() and not (partial / 'raw.json').exists()
plan = json.loads((root / 'recovery-plan-v1.json').read_bytes())
assert len(plan['runs']) == 40 and plan['ABPairs'] == 18 and plan['knownIncompleteAttemptsRetained'] == 1
assert plan['metricOutcomeBlinded'] and plan['scheduleOrderUnchanged']
assert plan['runs'][16]['storageLabel'] == 'pair-07-candidate-attempt-2'
print(json.dumps({'status': 'passed', 'mappedFiles': len(seen), 'completeRawRunsPreserved': 16,
                  'partialAttemptsPreserved': 1, 'outcomeStatisticsComputed': False, 'performanceAdmission': 0}))
