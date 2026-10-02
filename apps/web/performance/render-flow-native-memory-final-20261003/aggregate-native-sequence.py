"""Descriptive tab-level analysis; never treats cycles as independent users."""
import json
from pathlib import Path
import re
import statistics
import sys

root = Path(__file__).resolve().parent
label = sys.argv[1]
assert re.fullmatch(r'[a-z0-9-]+', label)
plan = json.loads((root / 'PLAN.json').read_text())
sequence = json.loads((root / ('sequence-' + label + '.json')).read_text())
assert sequence['allSixCompleted']
rows = []
for trial in plan['sequence']:
    trial_label = label + '-' + trial['role'] + '-' + trial['label']
    path = root / ('direct-' + trial['mode'] + '-memory-' + trial_label) / 'raw.json'
    data = json.loads(path.read_text())
    assert data['passed'] and len(data['cycles']) == 60 and data['fieldAdmitted'] == 0
    heaps = [x['heap']['usedSize'] / 1e6 for x in data['cycles']]
    rows.append({**trial, 'raw': str(path.relative_to(root)), 'tabMedianMB': statistics.median(heaps), 'peakMB': max(heaps), 'endpointMB': heaps[-1], 'initialMB': data['initialHeap']['usedSize'] / 1e6})

result = {'sourceSha': plan['sourceSha'], 'rows': rows, 'independentDevices': 1, 'independentBrowserProcesses': 0, 'fieldAdmitted': 0, 'forcedGC': False, 'confidenceIntervals': None, 'p95': None, 'improvementProven': False, 'limits': ['Existing browser process and natural GC phase; tab/cycle dependence remains', 'Aggregate passing does not erase an individual pair failure', 'JavaScript isolate heap only; not RSS/GPU or proof of no leak'], 'browsers': {}}
for browser in ['samsung', 'physical']:
    subset = [x for x in rows if x['mode'] == browser]
    before = [x for x in subset if x['role'] == 'before']
    after = [x for x in subset if x['role'] == 'after']
    pairs = []
    for a, b in zip(before, after):
        growth = (b['tabMedianMB'] - a['tabMedianMB']) / a['tabMedianMB'] * 100
        pairs.append({'before': a['label'], 'after': b['label'], 'growthPercent': growth, 'guardPassed': growth <= plan['heapRegressionTolerancePercent']})
    entry = {'tabsPerVariant': len(before), 'cyclesPerTab': 60, 'pairs': pairs, 'metrics': {}}
    for metric in ['tabMedianMB', 'peakMB', 'endpointMB']:
        a = statistics.median(x[metric] for x in before)
        b = statistics.median(x[metric] for x in after)
        entry['metrics'][metric] = {'before': a, 'after': b, 'absoluteReduction': a - b, 'relativeReductionPercent': (a - b) / a * 100, 'aggregateGuardPassed': b <= a * (1 + plan['heapRegressionTolerancePercent'] / 100)}
    result['browsers'][browser] = entry
with (root / ('summary-' + label + '.json')).open('x') as output:
    json.dump(result, output, indent=2)
    output.write('\n')
print(json.dumps({'summarized': True, 'improvementProven': False, 'allPairGuardsPassed': all(p['guardPassed'] for b in result['browsers'].values() for p in b['pairs'])}))
