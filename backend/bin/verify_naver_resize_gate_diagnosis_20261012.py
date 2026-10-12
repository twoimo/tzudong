"""Check frozen diagnostic scope and bytes; primary admission is separate."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = '79b512a5c86367a5f78dd58230637fd032349f7243a1f99def649e0e8e184e7b'
DEFAULT = Path(__file__).resolve().parents[2]/'apps/web/performance/naver-resize-gate-20261012-v1'

def require(ok, code):
    if not ok: raise ValueError(code)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    data = (root/'artifact-map-v1.json').read_bytes()
    require(hashlib.sha256(data).hexdigest() == PIN, 'MAP_DENIED')
    manifest = json.loads(data)
    require(len(manifest['files']) == 54 and manifest['performanceAdmission'] == 0 and manifest['fieldAdmission'] == 0, 'SCOPE_DENIED')
    observed = set()
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'SYMLINK_DENIED')
        if path.is_file(): observed.add(path.relative_to(root).as_posix())
    require(observed == set(manifest['files']) | {'artifact-map-v1.json'}, 'INVENTORY_DENIED')
    for name, expected in manifest['files'].items():
        path = Path(name)
        require(not path.is_absolute() and '..' not in path.parts, 'PATH_DENIED')
        data = (root/path).read_bytes()
        require(len(data) == expected['bytes'] and hashlib.sha256(data).hexdigest() == expected['sha256'], 'BYTES_DENIED')
    unit = json.loads((root/'unit-v3.json').read_bytes())
    require(unit['exit'] == 0 and unit['counts'] == {'pass': 3456, 'skip': 11, 'fail': 0}, 'UNIT_DENIED')
    sdk_counts = []
    for kind in ['baseline', 'candidate']:
        run = json.loads((root/f'diagnostic-{kind}-v8.json').read_bytes())
        require(run['passed'] and len(run['cycles']) == 16 and run['diagnosticOnly'], 'FLOW_DENIED')
        sdk_counts.append(sum(row['state']['geometry'].get('SDKresize', {}).get('count', 0) for row in run['cycles']))
        viewports = json.loads((root/f'viewports-{kind}-v1/raw.json').read_bytes())
        require(viewports['passed'] and len(viewports['cases']) == 6 and not viewports['physicalDevice'], 'VIEWPORT_DENIED')
    require(sdk_counts == [75, 50], 'COUNTER_DENIED')
    comparison = json.loads((root/'viewport-comparison-v1.json').read_bytes())
    for row in comparison['rows']:
        require(row['zoomMatches'] and all(v == 0 for v in row['centerDelta'].values()) and all(v == 0 for v in row['selectedPointDeltaPx'].values()), 'GEOMETRY_DENIED')
    outcome = json.loads((root/'pilot-outcome-v1.json').read_bytes())
    require(outcome['independentProcessesEach'] == 1 and outcome['confidenceInterval'] is None and not outcome['candidateAccepted'], 'PILOT_SCOPE_DENIED')
    print(json.dumps({'status': 'passed', 'files': 54, 'performanceAccepted': False, 'goalComplete': False}))

if __name__ == '__main__': main()
