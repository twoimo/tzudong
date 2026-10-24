"""Rebuild only this candidate's finite artifact map; excludes itself/detached hash."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[3]
files = [path for path in ROOT.rglob('*') if path.is_file() and path.name not in
         {'artifact-map.json', 'artifact-map.sha256'} and '__pycache__' not in path.parts]
files += [REPO / name for name in [
    'apps/web/lib/cluster-marker.ts', 'apps/web/lib/category-marker-image-primer.ts',
    'apps/web/components/map/NaverMapView.tsx', 'apps/web/lib/marker-pool.ts',
    'apps/web/tests-unit/category-marker-image-primer-browser.test.ts']]
items = []
for path in sorted(set(files)):
    data = path.read_bytes()
    items.append({'path': str(path.relative_to(REPO)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
manifest = {'schemaVersion': 'cluster-icon-readiness.artifacts.v1',
            'baselineProductionSha': '1b5230ac93021c72499f4950bff6cda24e2515e5',
            'scope': 'New local candidate; no external review or new deployment completion', 'artifacts': items}
data = (json.dumps(manifest, indent=2) + '\n').encode()
(ROOT / 'artifact-map.json').write_bytes(data)
(ROOT / 'artifact-map.sha256').write_text(hashlib.sha256(data).hexdigest() + '  artifact-map.json\n')
print(json.dumps({'artifacts': len(items), 'sha256': hashlib.sha256(data).hexdigest()}))
