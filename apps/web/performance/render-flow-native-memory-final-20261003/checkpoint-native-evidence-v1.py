"""Append owned evidence without overwriting prior checkpoint bytes."""
from pathlib import Path
import hashlib,json,shutil,sys
source=Path(__file__).resolve().parent
destination=Path('/Users/twoimo/.codex/worktrees/render-memory-evidence-20261002/tzudong/apps/web/performance/render-flow-native-memory-final-20261003')
label=sys.argv[1]
assert label and all(c.islower() or c.isdigit() or c=='-' for c in label)
copied=[];same=0
for path in sorted(source.rglob('*')):
    if not path.is_file() or '__pycache__' in path.parts:
        continue
    relative=path.relative_to(source)
    target=destination/relative
    data=path.read_bytes()
    if target.exists():
        assert target.read_bytes()==data, f'existing evidence changed: {relative}'
        same+=1
    else:
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as f:
            f.write(data)
        copied.append({'path':str(relative),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
receipt={'sourceRoot':source.name,'destinationRoot':destination.name,'newFiles':copied,'unchangedExistingFiles':same,'overwrites':0}
receipt_path=source/f'evidence-copy-{label}.json'
with receipt_path.open('x') as f:
    json.dump(receipt,f,indent=2);f.write('\n')
with (destination/receipt_path.name).open('xb') as f:
    f.write(receipt_path.read_bytes())
print(json.dumps({'newFiles':len(copied),'bytes':sum(x['bytes'] for x in copied),'unchanged':same,'overwrites':0}))
