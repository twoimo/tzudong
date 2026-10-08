from pathlib import Path
import argparse
import hashlib
import json

parser=argparse.ArgumentParser()
parser.add_argument('--root',required=True,type=Path)
parser.add_argument('--map',required=True,type=Path)
parser.add_argument('--expected-map-sha256',required=True)
args=parser.parse_args()
digest=lambda b:hashlib.sha256(b).hexdigest()
raw=args.map.read_bytes()
if digest(raw)!=args.expected_map_sha256:raise SystemExit('ARTIFACT_MAP_PIN_MISMATCH')
mapping=json.loads(raw)
for item in mapping['artifacts']:
    rel=Path(item['path'])
    if rel.is_absolute() or '..' in rel.parts:raise SystemExit('ARTIFACT_PATH_DENIED')
    file=args.root/rel
    if file.is_symlink() or not file.is_file():raise SystemExit('ARTIFACT_TYPE_DENIED')
    b=file.read_bytes()
    if len(b)!=item['bytes'] or digest(b)!=item['sha256']:raise SystemExit('ARTIFACT_BYTES_MISMATCH')
series=json.loads((args.root/'browser-series-final-v6.json').read_text())
if len(series['phases'])!=22 or not all(row['matched'] for row in series['phases']):raise SystemExit('SERIES_EQUIVALENCE_FAILED')
for row in series['phases']:
    data=json.loads((args.root/('ui-'+row['label'])/'raw.json').read_text())
    if not data['passed'] or len(data['cycles'])!=256:raise SystemExit('PROCESS_FLOW_INCOMPLETE')
stats=json.loads((args.root/'browser-confirm-summary-v6.json').read_text())
scored=json.loads((args.root/'canonical-zero-v1/backlog.scored.json').read_text())
if stats['canonicalPerformanceAdmission']!=0 or scored['ranking']['admittedIds'] or stats['primaryPairedCIWithinGuard']:
    raise SystemExit('CURRENT_REJECTION_STATE_DRIFT')
print(json.dumps({'artifactIntegrityPassed':True,'artifacts':len(mapping['artifacts']),
                 'matchedIndependentProcesses':22,'dependentActionsPerProcess':256,
                 'performanceAdmission':0,'memoryRegressionResolved':False,'goalComplete':False}))
