"""Independent byte and complete-tree verification of the current v2 package."""
from pathlib import Path, PurePosixPath
import hashlib,json
REPO=Path(__file__).resolve().parents[2]
ROOT=REPO/'apps/web/performance/user-readiness-20261009'
MAP=ROOT/'artifact-map-readiness-integrated-v2.json'
PIN=REPO/'docs/evidence/user-readiness-integrated-20261009-map-v2.sha256'
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
recovery_binding=j.get('historicalSourceRecovery')
if not isinstance(recovery_binding,dict) or recovery_binding.get('path')!='docs/evidence/user-readiness-browser-source-recovery-v1.json':raise SystemExit('READINESS_RECOVERY_BINDING')
recovery_path=REPO/recovery_binding['path']
recovery_raw=recovery_path.read_bytes()
if hashlib.sha256(recovery_raw).hexdigest()!=recovery_binding['sha256']:raise SystemExit('READINESS_RECOVERY_HASH')
old_map=json.loads((ROOT/'artifact-map-readiness-integrated-v1.json').read_text())
old_rows={str(Path('apps/web/performance/user-readiness-20261009')/r['path']):r for r in old_map['artifacts']}
for row in json.loads(recovery_raw)['recovery']:
 preserved=REPO/row['preservedPath']
 if preserved.is_symlink() or REPO.resolve() not in preserved.resolve().parents:raise SystemExit('READINESS_RECOVERY_ESCAPE')
 raw=preserved.read_bytes()
 if len(raw)!=row['bytes'] or hashlib.sha256(raw).hexdigest()!=row['sha256']:raise SystemExit('READINESS_RECOVERY_BYTES')
 if row['originalPath'] in old_rows and any(row[k]!=old_rows[row['originalPath']][k] for k in ['sha256','bytes']):raise SystemExit('READINESS_RECOVERY_ORIGINAL_DRIFT')
actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p!=MAP}
if actual!=seen:raise SystemExit('READINESS_MAP_COVERAGE_MISMATCH')
print(json.dumps({'status':'passed','sha256':sha,'files':len(seen),'byteEquality':True,'completeTree':True,'performanceAdmission':j['performanceAdmission']}))
