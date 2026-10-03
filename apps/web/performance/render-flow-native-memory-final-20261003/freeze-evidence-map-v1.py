"""Create a one-time complete evidence map and detached pin; never overwrite."""
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1]).resolve()
assert root.name=='render-flow-native-memory-final-20261003'
mapping=root/'artifact-map.json';pin=root.parent/(root.name+'-artifact-map.sha256')
assert not mapping.exists() and not pin.exists()
items={}
for path in sorted(root.rglob('*')):
    if not path.is_file():
        continue
    assert not path.is_symlink() and path.resolve().is_relative_to(root)
    data=path.read_bytes()
    items[str(path.relative_to(root))]={'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
index={'schemaVersion':'render-flow-evidence-map.v1','releaseId':root.name,
       'sourceCommit':'d24f8d633a628518f072c24d76166d388d33c398',
       'protectedMainCommit':'ca235e250957c4360ad713ffd29e118c11cc5b7c',
       'fieldImprovementAdmitted':False,'physicalFinalSourceVerified':False,
       'artifacts':items}
data=(json.dumps(index,indent=2,ensure_ascii=False)+'\n').encode()
with mapping.open('xb') as f:
    f.write(data)
digest=hashlib.sha256(data).hexdigest()
with pin.open('x') as f:
    f.write(digest+'\n')
print(json.dumps({'artifacts':len(items),'bytes':sum(x['size'] for x in items.values()),'mapSha256':digest,'externalPin':pin.name}))
