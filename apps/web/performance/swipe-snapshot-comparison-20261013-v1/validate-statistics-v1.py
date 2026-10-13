"""Independent Python reconstruction from all retained natural browser samples."""
import hashlib
import json
import math
from pathlib import Path
import statistics

root = Path(__file__).parent
stored_bytes = (root / 'statistics-v1.json').read_bytes()
stored = json.loads(stored_bytes)
schedule = json.loads((root / 'series-plan-v1.json').read_bytes())['schedule']
runs = []
for entry in schedule:
    raw = (root / ('ui-' + entry['label']) / 'raw.json').read_bytes()
    row = json.loads(raw)
    if not row['passed'] or len(row['cycles']) != 256:
        raise ValueError('INCOMPLETE_RAW_EXECUTION')
    latencies = [x['state']['inputToObservedMs'] for x in row['cycles']]
    runs.append({**entry, 'rawSha256': hashlib.sha256(raw).hexdigest(),
                 'endHeapBytes': row['endHeap']['usedSize'],
                 'idleHeapBytes': row['idleHeap']['usedSize'],
                 'selectionLatencyMedianMs': statistics.median(latencies)})
seed = 20261014


def random_index():
    global seed
    seed = (seed * 1664525 + 1013904223) & 0xffffffff
    return int(seed / 4294967296 * 9)


def interval(values):
    values.sort()
    return [values[int(len(values) * .025)], values[int(len(values) * .975)]]


def equal(actual, expected):
    if isinstance(actual, list):
        return len(actual) == len(expected) and all(equal(a, b) for a, b in zip(actual, expected))
    return math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-8)


verified = []
for metric, guard in [('endHeapBytes', 20), ('idleHeapBytes', 20), ('selectionLatencyMedianMs', 15)]:
    pairs = [(next(x for x in runs if x.get('pair') == i and x['kind'] == 'baseline')[metric],
              next(x for x in runs if x.get('pair') == i and x['kind'] == 'candidate')[metric]) for i in range(1, 10)]
    before = statistics.median([x[0] for x in pairs])
    after = statistics.median([x[1] for x in pairs])
    absolute, relative, regression = [], [], []
    for _ in range(20000):
        sample = [pairs[random_index()] for _ in range(9)]
        b = statistics.median([x[0] for x in sample])
        a = statistics.median([x[1] for x in sample])
        absolute.append(b - a)
        relative.append((b - a) / b * 100)
        regression.append(statistics.median([(y / x - 1) * 100 for x, y in sample]))
    values = {'beforeMedian': before, 'afterMedian': after, 'absoluteDecrease': before - after,
              'relativeImprovementPercent': (before - after) / before * 100,
              'absoluteDecrease95CI': interval(absolute), 'relativeImprovement95CI': interval(relative),
              'pairedRegression95CI': interval(regression)}
    expected = next(x for x in stored['metrics'] if x['metric'] == metric)
    if any(not equal(value, expected[key]) for key, value in values.items()):
        raise ValueError('STATISTICS_RECONSTRUCTION_MISMATCH')
    if expected['guardPass'] != (values['pairedRegression95CI'][1] <= guard):
        raise ValueError('GUARD_RECONSTRUCTION_MISMATCH')
    verified.append({'metric': metric, 'reconstructed': True, 'guardPass': expected['guardPass']})
if [x['rawSha256'] for x in runs] != [x['rawSha256'] for x in stored['runs']]:
    raise ValueError('RAW_IDENTITY_MISMATCH')
receipt = {'statisticsSha256': hashlib.sha256(stored_bytes).hexdigest(), 'rawExecutions': len(runs),
           'dependentActions': len(runs) * 256, 'bootstrapRepeatsPerMetric': 20000,
           'allReconstructed': True, 'metrics': verified, 'performanceAdmission': 0,
           'rawDiagnosticOnlyFlagsPreserved': True}
with (root / 'independent-validation-v1.json').open('x') as f:
    json.dump(receipt, f, indent=2)
    f.write('\n')
print(json.dumps(receipt))
