"""Freeze diagnostic inputs and completed pilot outputs; exclude the live natural series."""
from pathlib import Path
import datetime
import json
import shutil
import subprocess

root = Path(__file__).resolve().parent
repo = root.parents[3]
out = root / 'pilot-checkpoint-v1'
out.mkdir()
for path in root.iterdir():
    if path.is_file() and not path.name.startswith('natural-'):
        shutil.copyfile(path, out / path.name)
labels = ['pilot-before-4', 'pilot-after-4', 'boundary-after-4', 'cursor-after-4',
          'pilot-before-64', 'pilot-after-64']
for label in labels:
    shutil.copytree(root / ('ui-' + label), out / ('ui-' + label))
rows = {label: json.loads((out / ('ui-' + label) / 'raw.json').read_bytes()) for label in labels}
before = rows['pilot-before-64']['markerCalls']['setIcon']
after = rows['pilot-after-64']['markerCalls']['setIcon']
summary = {
    'sourceBefore': '275fb4bedcaabfe151658acebeaf4611d9db9115',
    'sourceAfter': '1ec703840670c922dbccc661c1efdd10ad257cdb',
    'independent64ActionPilotProcesses': 2, 'withinProcessActions': 64,
    'sdkSetIcon': {'before': before, 'after': after, 'absoluteDecrease': before - after,
                   'relativeImprovementPercent': (before - after) / before * 100,
                   'confidenceInterval': None,
                   'classification': 'single-pair causal diagnostic; not memory/latency proof'},
    'markerCreates': {'before': 164, 'after': 164},
    'actualSdkIdMismatches': {key: rows['pilot-' + key + '-64']['actualSdkIdentityCheck']['mismatches']
                              for key in ['before', 'after']},
    'allPilotFlowsPassed': all(row['passed'] for row in rows.values()),
    'consoleIncidents': sum(row['errors']['console'] for row in rows.values()),
    'actualSdkHash': rows['pilot-after-64']['sdkScript']['sha256'],
    'physicalDevice': False, 'performanceAdmission': 0, 'fieldAdmission': 0,
    'operatingDeployment': False,
    'primaryNaturalSeries': '40 processes started separately; live state excluded from this checkpoint',
    'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with (out / 'pilot-summary-v1.json').open('x') as handle:
    json.dump(summary, handle, indent=2)
    handle.write('\n')
todo = repo / 'docs/evidence/GOAL-TODOS-20261015-v9.md'
original = subprocess.check_output(['git', 'show', 'a312320b:docs/evidence/GOAL-TODOS-20261015-v8.md'], cwd=repo)
todo.write_bytes(todo.read_bytes() + original)
print(json.dumps(summary))
