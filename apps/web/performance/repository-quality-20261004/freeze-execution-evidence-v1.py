from pathlib import Path
import argparse,hashlib,json,datetime,re
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--map-name',required=True);p.add_argument('--external-pin',required=True);a=p.parse_args();root=Path(a.root).resolve();pin=Path(a.external_pin).resolve();assert root not in pin.parents and pin!=root and re.fullmatch(r'[a-z0-9.-]+\.json',a.map_name);output=root/a.map_name;assert not output.exists() and not pin.exists()
artifacts={}
for file in sorted(root.rglob('*')):
    assert not file.is_symlink()
    if not file.is_file():continue
    blob=file.read_bytes();artifacts[str(file.relative_to(root))]={'sha256':hashlib.sha256(blob).hexdigest(),'size':len(blob)}
obj={'schemaVersion':'render-flow-evidence-map.v1','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'complete current execution snapshot; not whole-goal completion, field gain or canonical admission','sourceMain':'ae1771af10df0ffe96ed09817d902e7aab9e8053','sourceTree':'485efd73556420c7f604db4afdd126a33bf45644','performanceExperimentsHaveSeparateSourceBindings':True,'artifacts':artifacts}
blob=(json.dumps(obj,sort_keys=True,separators=(',',':'))+'\n').encode()
with output.open('xb') as f:f.write(blob)
digest=hashlib.sha256(blob).hexdigest()
with pin.open('x') as f:f.write(digest+'\n')
print(json.dumps({'map':a.map_name,'sha256':digest,'files':len(artifacts),'bytes':sum(x['size'] for x in artifacts.values()),'externalPin':str(pin),'notGoalComplete':True}))
