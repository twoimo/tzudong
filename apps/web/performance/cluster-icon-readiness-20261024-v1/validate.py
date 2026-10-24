"""Independent integrity and selected scoring checks; no browser/release actions."""
import hashlib
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
sha = lambda value: hashlib.sha256(value).hexdigest()
manifest = json.loads((ROOT / 'artifact-map.json').read_text())
assert (ROOT / 'artifact-map.sha256').read_text().split()[0] == sha((ROOT / 'artifact-map.json').read_bytes())
for item in manifest['artifacts']:
    data = (REPO / item['path']).read_bytes()
    assert len(data) == item['bytes'] and sha(data) == item['sha256'], item['path']
raw = json.loads((ROOT / 'raw.json').read_text())
scored = json.loads((ROOT / 'scored.json').read_text())
assert sha((ROOT / 'raw.json').read_bytes()) == scored['rawSha256']
for name, digest in raw['sourceHashes'].items():
    assert sha((REPO / 'apps/web' / name).read_bytes()) == digest, name
assert len(raw['trials']) == 36 and scored['productionImprovementAdmittedSlices'] == 0
for row in scored['results']:
    for candidate, arm in zip([False, True], row['arms']):
        trials = [trial for trial in raw['trials'] if trial['width'] == row['width'] and trial['candidate'] == candidate]
        values = [next(sample['at'] for sample in trial['samples'] if sample['notReady'] == 0) for trial in trials]
        assert len(values) == 6
        assert arm['firstAllVisibleReadyMs']['median'] == statistics.median(values)
        assert max(values) <= 250
        assert all(trial['primerAfterDispose'] == 0 and not trial['errors'] for trial in trials)
    before, after = [arm['firstAllVisibleReadyMs']['median'] for arm in row['arms']]
    assert row['absoluteReductionMs'] == before - after
    assert row['localBudgetPassed'] and before - after > row['noiseBudgetMs']
trace = json.loads((ROOT / 'decode-trace-summary.json').read_text())
assert len(trace['results']) == 6
assert all(row['expandMarkObserved'] and any(event['name'] == 'Decode Image' for event in row['imageEvents']) for row in trace['results'])
print(json.dumps({'integrity': 'passed', 'artifacts': len(manifest['artifacts']), 'localTrials': 36,
                  'diagnosticTraces': 6, 'productionImprovementAdmittedSlices': 0, 'deployed': False}))
