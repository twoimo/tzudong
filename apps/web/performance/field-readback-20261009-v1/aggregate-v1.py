"""Reproduce descriptive interval-censored field summaries; no causal claims."""
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
raw = (root / 'hosted-histogram-v1.json').read_bytes()
source = json.loads(raw)
groups = {}
widths = {'CLS': (0.01, 100), 'INP': (16, 200), 'LCP': (100, 120)}
for row in source['rows']:
    key = (row['release_sha'], row['device'], row['metric'], row['navigation'])
    entry = groups.setdefault(key, {'histogram': {}, 'days': set()})
    count, bucket = row['sample_count'], row['bucket']
    width, overflow = widths[row['metric']]
    if type(count) is not int or count <= 0 or type(bucket) is not int or not 0 <= bucket <= overflow:
        raise SystemExit('FIELD_HISTOGRAM_BOUND_DENIED')
    entry['histogram'][bucket] = entry['histogram'].get(bucket, 0) + count
    entry['days'].add(row['observed_day'])

cohorts = []
for (release, device, metric, navigation), entry in sorted(groups.items()):
    n = sum(entry['histogram'].values())
    target, cumulative = (n + 1) // 2, 0
    width, overflow = widths[metric]
    for bucket, count in sorted(entry['histogram'].items()):
        cumulative += count
        if cumulative >= target:
            median = {'lower': round(bucket * width, 8),
                      'upperExclusive': None if bucket == overflow else round((bucket + 1) * width, 8)}
            break
    cohorts.append({'releaseSha': release, 'device': device, 'metric': metric,
                    'navigation': navigation, 'metricInstances': n,
                    'observedDays': len(entry['days']), 'firstDay': min(entry['days']),
                    'lastDay': max(entry['days']), 'descriptiveP50Interval': median,
                    'unit': 'unitless' if metric == 'CLS' else 'ms', 'p95': None,
                    'confidenceInterval': None, 'independentUsers': None,
                    'performanceImprovementProven': False})

result = {'snapshotSha256': hashlib.sha256(raw).hexdigest(),
          'observedAtUtc': source['observedAtUtc'], 'histogramRows': len(source['rows']),
          'metricInstances': sum(c['metricInstances'] for c in cohorts), 'cohorts': cohorts,
          'sampleUnit': 'anonymous client metric instance; not unique user',
          'histogramMedianMethod': 'nearest-rank ceil(n*0.5), returned as bucket bounds',
          'p95AndCIUnavailableReason': 'few days per release, unknown user independence and reporter denominator',
          'beforeAfterImprovement': None, 'candidatePerformanceAdmission': 0,
          'operatingWrites': 0}
text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
if len(sys.argv) > 1 and sys.argv[1] == '--stdout':
    print(text, end='')
else:
    with (root / 'field-summary-v1.json').open('x') as f:
        f.write(text)
    print(json.dumps({k: result[k] for k in ['histogramRows', 'metricInstances', 'candidatePerformanceAdmission']}))
