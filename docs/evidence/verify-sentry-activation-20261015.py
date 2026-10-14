#!/usr/bin/env python3
"""Verify the frozen functional packet independently; no service requests or credentials."""
from pathlib import Path
import hashlib,json,sys
repo=Path(__file__).resolve().parents[2]
root=repo/'apps/web/performance/sentry-activation-20261015-v1'
pin=(repo/'docs/evidence/sentry-activation-20261015-map-v1.sha256').read_text().split()[0]
m=root/'artifact-map-v1.json'
assert hashlib.sha256(m.read_bytes()).hexdigest()==pin,'MAP_PIN_MISMATCH'
data=json.loads(m.read_text());listed=set()
for row in data['entries']:
 p=root/row['path'];assert p.is_file() and not p.is_symlink(),'UNSAFE_ARTIFACT'
 assert p.resolve().is_relative_to(root.resolve()),'PATH_ESCAPE'
 b=p.read_bytes();assert len(b)==row['bytes'] and hashlib.sha256(b).hexdigest()==row['sha256'],'ARTIFACT_MISMATCH'
 listed.add(row['path'])
actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name!=m.name}
assert listed==actual,'ARTIFACT_SET_MISMATCH'
browser=json.loads((root/'browser-smoke-v5.json').read_text());assert len(browser['rows'])==3
for row in browser['rows']:
 assert row['received']['idMatches'] and row['received']['status']==200
 assert not row['received']['userPresent'] and not row['received']['syntheticPrivatePresent']
 assert row['pageErrorsBeforeInjection']==0 and row['cspBlocked']==0
node=json.loads((root/'node-live-smoke-v2.json').read_text());assert node['readback']['idMatches'] and not node['readback']['sensitivePresent']
settings=json.loads((root/'project-settings-readback-v1.json').read_text());assert settings['scrubIPAddresses'] and settings['verifySSL'] and not settings['scrapeJavaScript']
assert settings['keys'][0]['rateLimit']=={'window':86400,'count':100}
print(json.dumps({'status':'passed','mappedFiles':len(listed),'browserExactReceipts':3,'nodeExactReceipts':1,'performanceClaim':False,'physicalOrFieldClaim':False}))
