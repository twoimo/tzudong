from pathlib import Path
import argparse,hashlib,json,re
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--map',required=True);p.add_argument('--map-sha256',required=True);a=p.parse_args();root=Path(a.root).resolve();assert re.fullmatch(r'[a-f0-9]{64}',a.map_sha256)
path=root/a.map;assert path.is_file() and not path.is_symlink();raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==a.map_sha256;data=json.loads(raw)
expected=set(data['artifacts']);actual=set()
for file in root.rglob('*'):
    assert not file.is_symlink()
    if file.is_file() and file!=path:actual.add(str(file.relative_to(root)))
assert actual==expected
for name,entry in data['artifacts'].items():
    relative=Path(name);assert not relative.is_absolute() and '..' not in relative.parts
    file=root/relative;blob=file.read_bytes();assert len(blob)==entry['size'] and hashlib.sha256(blob).hexdigest()==entry['sha256']
print(json.dumps({'verified':True,'files':len(expected),'mapSha256':a.map_sha256,'scope':data['scope'],'notGoalCompletion':True}))
