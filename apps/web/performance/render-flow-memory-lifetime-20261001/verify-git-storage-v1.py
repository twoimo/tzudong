"""Read every mapped Git blob, without relying on checkout bytes or Git index."""
from pathlib import Path
import hashlib,json,subprocess,sys
repo,sha,prefix,pin_path=sys.argv[1:]
assert len(sha)==40
assert prefix=='apps/web/performance/render-flow-memory-lifetime-20261001'
def blob(p):
 return subprocess.run(['git','show',sha+':'+p],cwd=repo,capture_output=True,check=True).stdout
b=blob(prefix+'/artifact-map.json');pin=Path(pin_path).read_text().split()[0];assert hashlib.sha256(b).hexdigest()==pin
mapping=json.loads(b)
actual=set(subprocess.run(['git','ls-tree','-r','--name-only',sha,'--',prefix],cwd=repo,capture_output=True,text=True,check=True).stdout.splitlines())
expected={prefix+'/'+p for p in mapping['artifacts']}|{prefix+'/artifact-map.json'};assert actual==expected
for name,e in mapping['artifacts'].items():
 b=blob(prefix+'/'+name);assert len(b)==e['size'] and hashlib.sha256(b).hexdigest()==e['sha256']
remote=subprocess.run(['git','ls-remote','origin','refs/heads/codex/render-memory-evidence-20261002'],cwd=repo,capture_output=True,text=True,check=True).stdout.split()
assert remote and remote[0]==sha
print(json.dumps({'storageCommit':sha,'remoteHeadMatches':True,'gitBlobsVerified':len(mapping['artifacts']),'artifactMapPinMatches':True}))
