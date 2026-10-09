"""Independent byte and complete-tree verification of the frozen v1 package."""
from pathlib import Path, PurePosixPath
import hashlib,json
REPO=Path(__file__).resolve().parents[2]
ROOT=REPO/'apps/web/performance/user-readiness-20261009'
MAP=ROOT/'artifact-map-readiness-integrated-v1.json'
PIN=Path(__file__).with_name('user-readiness-integrated-20261009-map-v1.sha256')
sha=hashlib.sha256(MAP.read_bytes()).hexdigest()
if sha!=PIN.read_text().strip():raise SystemExit('READINESS_MAP_PIN_MISMATCH')
j=json.loads(MAP.read_text());seen=set()
for row in j['artifacts']:
 if set(row)!=set(['path','bytes','sha256']):raise SystemExit('READINESS_MAP_FIELDS')
 path=PurePosixPath(row['path'])
 if path.is_absolute() or '..' in path.parts or str(path)!=row['path'] or '\\' in row['path'] or row['path'] in seen:raise SystemExit('READINESS_MAP_PATH')
 seen.add(row['path']);target=ROOT.joinpath(*path.parts)
 if target.is_symlink() or ROOT.resolve() not in target.resolve().parents:raise SystemExit('READINESS_MAP_ESCAPE')
 raw=target.read_bytes()
 if type(row['bytes']) is not int or row['bytes']!=len(raw) or row['sha256']!=hashlib.sha256(raw).hexdigest():raise SystemExit('READINESS_MAP_BYTE_MISMATCH')
actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p!=MAP}
if actual!=seen:raise SystemExit('READINESS_MAP_COVERAGE_MISMATCH')
print(json.dumps({'status':'passed','sha256':sha,'files':len(seen),'byteEquality':True,'completeTree':True,'performanceAdmission':j['performanceAdmission']}))
