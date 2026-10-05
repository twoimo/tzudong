"""Re-run retained canonical scoring with external pins and no overwrites."""
from pathlib import Path
import argparse,hashlib,json,re,subprocess
p=argparse.ArgumentParser();p.add_argument('--node',required=True);p.add_argument('--source-checkout',required=True);p.add_argument('--score-map-pin-file',required=True);p.add_argument('--validator-map-pin-file',required=True);p.add_argument('--label',required=True);a=p.parse_args();assert re.fullmatch(r'[a-z0-9-]+',a.label)
root=Path(__file__).resolve().parent/'canonical-main-zero-admitted-v1'
d=json.loads((root/'score-artifact-map.json').read_text())
def pin(file,map_name):
    path=Path(file).resolve();assert root not in path.parents and path!=root
    digest=path.read_text().strip();assert re.fullmatch(r'[a-f0-9]{64}',digest)
    assert digest==hashlib.sha256((root/map_name).read_bytes()).hexdigest();return digest
sp=pin(a.score_map_pin_file,'score-artifact-map.json');vp=pin(a.validator_map_pin_file,'validator-artifact-map-v3.json')
common=['--artifact-root',str(root),'--release-id',d['releaseId'],'--candidate-sha',d['candidate']['sha'],'--candidate-tree',d['candidate']['tree'],'--config-sha256',d['configSha256'],'--data-profile-sha256',d['dataProfileSha256'],'--frozen-as-of',d['frozenAsOf'],'--input','backlog.raw.json']
source=Path(a.source_checkout).resolve()/'apps/web/scripts'
output='backlog.scored.replay-'+a.label+'.json';assert not (root/output).exists()
results=[]
for script,extra in [('score-performance-backlog.mjs',['--artifact-map','score-artifact-map.json','--artifact-map-sha256',sp,'--output',output]),('validate-performance-backlog.mjs',['--artifact-map','validator-artifact-map-v3.json','--artifact-map-sha256',vp,'--scored','backlog.scored.json'])]:
    row=subprocess.run([a.node,str(source/script),*common,*extra],capture_output=True,text=True)
    results.append({'script':script,'exitCode':row.returncode,'stdoutBytes':len(row.stdout),'stderrBytes':len(row.stderr)})
    assert row.returncode==0
assert (root/output).read_bytes()==(root/'backlog.scored.json').read_bytes()
print(json.dumps({'passed':True,'results':results,'byteEquivalentReplay':True,'admittedCount':0,'performanceHealthBlocked':True,'notDeploymentFieldOrLegalCertification':True}))
