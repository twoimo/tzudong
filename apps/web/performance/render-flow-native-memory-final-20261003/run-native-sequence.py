"""Run the planned six owned-tab trials only after the phone is unlocked."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parent
label = sys.argv[1]
if not re.fullmatch(r'[a-z0-9-]+', label):
    raise SystemExit('fresh run label required')
plan = json.loads((root / 'PLAN.json').read_text())
ready = [row.split()[0] for row in subprocess.check_output(['adb', 'devices', '-l'], text=True).splitlines()[1:] if re.search(r'\sdevice\s', row)]
models = []
identities = []
for serial in ready:
    assert subprocess.check_output(['adb', '-s', serial, 'get-state'], text=True, timeout=5).strip() == 'device'
    models.append(subprocess.check_output(['adb', '-s', serial, 'shell', 'getprop', 'ro.product.model'], text=True, timeout=5).strip())
    identities.append(subprocess.check_output(['adb', '-s', serial, 'shell', 'getprop', 'ro.serialno'], text=True, timeout=5).strip())
assert ready and all(x == 'SM-S928N' for x in models) and all(identities) and len(set(identities)) == 1
serial = ready[0]
policy = subprocess.check_output(['adb', '-s', serial, 'shell', 'dumpsys', 'window', 'policy'], text=True, timeout=5)
power = subprocess.check_output(['adb', '-s', serial, 'shell', 'dumpsys', 'power'], text=True, timeout=5)
preflight = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'deviceConfirmed': True, 'authKeyguardShowing': bool(re.search(r'\bshowing[:=]\s*true', policy)), 'awake': 'mWakefulness=Awake' in power, 'identifiersRetained': False, 'parentFrozenPacketModified': False}
with (root / ('preflight-' + label + '.json')).open('x') as output:
    json.dump(preflight, output, indent=2)
    output.write('\n')
if preflight['authKeyguardShowing'] or not preflight['awake']:
    print(json.dumps({'started': False, 'fixedBlocker': 'physical_auth_unlock_required', 'samples': 0}))
    raise SystemExit(2)

completed = []
for trial in plan['sequence']:
    env = dict(os.environ)
    env['DIRECT_MEMORY_PLAN'] = 'direct-final-nav-before-plan-v2.json' if trial['role'] == 'before' else 'direct-final-nav-after-plan-v1.json'
    trial_label = label + '-' + trial['role'] + '-' + trial['label']
    result = subprocess.run(['python3', str(root / 'run-sanitized-measure.py'), 'direct-mobile-memory-frame-ready.mjs', trial['mode'], trial_label], env=env)
    completed.append({'mode': trial['mode'], 'role': trial['role'], 'label': trial_label, 'exit': result.returncode})
    if result.returncode:
        break
with (root / ('sequence-' + label + '.json')).open('x') as output:
    json.dump({'sourceSha': plan['sourceSha'], 'trials': completed, 'allSixCompleted': len(completed) == 6 and all(x['exit'] == 0 for x in completed), 'forcedGc': False}, output, indent=2)
    output.write('\n')
