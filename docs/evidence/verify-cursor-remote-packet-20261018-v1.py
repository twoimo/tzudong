"""Read back the sealed packet from a fresh remote-only partial Git clone."""
import argparse,hashlib,io,json,re,subprocess,tarfile,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('branch');p.add_argument('commit');p.add_argument('root',type=Path);p.add_argument('pin',type=Path);p.add_argument('receipt',type=Path);a=p.parse_args()
if not re.fullmatch(r'codex/[a-z0-9-]+',a.branch) or not re.fullmatch(r'[a-f0-9]{40}',a.commit):raise ValueError('INVALID_REMOTE_IDENTITY')
if a.receipt.exists():raise ValueError('PRESERVE_EXISTING_RECEIPT')
pin=a.pin.read_text().strip()
if not re.fullmatch(r'[a-f0-9]{64}',pin):raise ValueError('INVALID_PIN')
digest=lambda b:hashlib.sha256(b).hexdigest()
map_bytes=(a.root/'artifact-map-v1.json').read_bytes()
if digest(map_bytes)!=pin:raise ValueError('LOCAL_MAP_PIN_MISMATCH')
m=json.loads(map_bytes);expected={x['path']:(x['bytes'],x['sha256']) for x in m['entries']};expected['artifact-map-v1.json']=(len(map_bytes),pin)
if len(expected)!=len(m['entries'])+1:raise ValueError('DUPLICATE_ARTIFACT')
clone=Path(tempfile.mkdtemp(prefix='tzudong-evidence-remote-20261018-'))
subprocess.run(['git','clone','--bare','--filter=blob:none','--depth=1','--single-branch','--branch',a.branch,'https://github.com/twoimo/tzudong.git',str(clone)],check=True,capture_output=True)
def git(*args):return subprocess.check_output(['git','-C',str(clone),*args])
remote=git('rev-parse','HEAD').decode().strip()
if remote!=a.commit:raise ValueError('REMOTE_BRANCH_CHANGED')
prefix='apps/web/performance/cursor-evidence-delivery-20261018-v1/'
archive=git('archive','--format=tar',remote,'--',prefix)
seen=set()
with tarfile.open(fileobj=io.BytesIO(archive)) as t:
 for member in t.getmembers():
  if member.isdir():continue
  if not member.isfile() or not member.name.startswith(prefix):raise ValueError('UNEXPECTED_REMOTE_ENTRY')
  rel=member.name[len(prefix):]
  if rel not in expected or rel in seen:raise ValueError('REMOTE_FILE_SET_MISMATCH')
  body=t.extractfile(member).read()
  if (len(body),digest(body))!=expected[rel]:raise ValueError('REMOTE_BYTES_MISMATCH')
  seen.add(rel)
if seen!=set(expected):raise ValueError('REMOTE_FILE_SET_INCOMPLETE')
o={'passed':True,'remote':'https://github.com/twoimo/tzudong.git','branch':a.branch,'commit':remote,'mapSha256':pin,'filesIncludingMap':len(seen),'method':'fresh bare partial clone, independent remote blob fetch via scoped git archive, SHA256/byte/complete-set comparison; no local repository object sharing','cloneRetainedForReadback':str(clone)}
with a.receipt.open('x') as f:json.dump(o,f,indent=2);f.write('\n')
print(json.dumps(o))
