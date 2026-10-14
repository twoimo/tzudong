"""Reconstruct frozen statistics in a fresh directory without overwriting evidence."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[2]
root = repo / 'apps/web/performance/review-candidate-union-20261014-v1'
node = sys.argv[1] if len(sys.argv) > 1 else '/opt/homebrew/opt/node@24/bin/node'
schedule = json.loads((root / 'series-plan-v1.json').read_bytes())['schedule']
with tempfile.TemporaryDirectory(prefix='review-union-statistics-') as folder:
    destination = Path(folder)
    for name in ['PLAN-v4.json', 'series-plan-v1.json', 'series-complete-v1.json',
                 'analyze-series-v1.mjs', 'validate-statistics-v1.py']:
        shutil.copyfile(root / name, destination / name)
    for run in schedule:
        target = destination / ('ui-' + run['label'])
        target.mkdir()
        shutil.copyfile(root / ('ui-' + run['label']) / 'raw.json', target / 'raw.json')
    for command in [[node, str(destination / 'analyze-series-v1.mjs')],
                    [sys.executable, str(destination / 'validate-statistics-v1.py')]]:
        result = subprocess.run(command, capture_output=True, timeout=60)
        if result.returncode:
            raise ValueError('FROZEN_STATISTICS_RECONSTRUCTION_FAILED')
    before = (root / 'statistics-v1.json').read_bytes()
    after = (destination / 'statistics-v1.json').read_bytes()
    if before != after:
        raise ValueError('STATISTICS_BYTES_CHANGED')
    print(json.dumps({'statisticsByteIdentical': True, 'independentPythonPassed': True,
                      'statisticsSha256': hashlib.sha256(after).hexdigest(),
                      'originalEvidenceChanged': False, 'fieldAdmission': 0}))
