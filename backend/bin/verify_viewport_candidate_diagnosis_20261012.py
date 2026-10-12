"""Check the frozen unsuccessful geometry-cache attempt, preserving failures."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = '6a6d43212016823168c54eaf6835a189214a1f6fa00a9f171eea21a24ccdbb74'
DEFAULT = Path(__file__).resolve().parents[2]/'apps/web/performance/mobile-viewport-height-20261012-v1'

def require(ok, code):
    if not ok:
        raise ValueError(code)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    data = (root/'artifact-map-v1.json').read_bytes()
    require(hashlib.sha256(data).hexdigest() == PIN, 'MAP_PIN_DENIED')
    manifest = json.loads(data)
    require(len(manifest['files']) == 50 and not manifest['candidateAccepted'] and manifest['performanceAdmission'] == 0, 'SCOPE_DENIED')
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
    require(unit['exit'] == 0 and unit['counts'] == {'pass': 3459, 'skip': 11, 'fail': 0}, 'UNIT_DENIED')
    failure = json.loads((root/'unit-v2.json').read_bytes())
    require(failure['exit'] == 1 and failure['counts']['fail'] == 1, 'FAILURE_RETENTION_DENIED')
    outcome = json.loads((root/'pilot-outcome-v1.json').read_bytes())
    require(outcome['processes'] == 2 and outcome['confidenceInterval'] is None and not outcome['candidateAccepted'], 'PILOT_SCOPE_DENIED')
    require(outcome['values']['after']['inputMedianMs'] > outcome['values']['before']['inputMedianMs'], 'LIMIT_DENIED')
    print(json.dumps({'status': 'passed', 'files': 50, 'candidateAccepted': False, 'goalComplete': False}))

if __name__ == '__main__':
    main()
