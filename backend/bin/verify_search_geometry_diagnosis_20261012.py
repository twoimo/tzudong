"""Integrity and scope checks for diagnostic attempts, not UI speed acceptance."""
from pathlib import Path
import argparse
import hashlib
import json

PINS = {
    'search-selection-trace-20261012-v1': '1ad7c1d30c00c0ae4aecbb1a46a97080b507403a3453405416d1f026817a55be',
    'mobile-nav-read-20261012-v1': '8b311acaa7570144551b7660b298befeb0b37c2dcc36614848880a78552e8a06',
}

def require(ok, code):
    if not ok:
        raise ValueError(code)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--performance-root', type=Path, default=Path(__file__).resolve().parents[2]/'apps/web/performance')
    base = parser.parse_args().performance_root
    for name, pin in PINS.items():
        root = base/name
        require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
        data = (root/'artifact-map-v1.json').read_bytes()
        require(hashlib.sha256(data).hexdigest() == pin, 'PIN_DENIED')
        manifest = json.loads(data)
        require(len(manifest['files']) == 22 and manifest['performanceAdmission'] == 0 and manifest['fieldAdmission'] == 0, 'SCOPE_DENIED')
        files = set()
        for file in root.rglob('*'):
            require(not file.is_symlink(), 'SYMLINK_DENIED')
            if file.is_file():
                files.add(file.relative_to(root).as_posix())
        require(files == set(manifest['files']) | {'artifact-map-v1.json'}, 'INVENTORY_DENIED')
        for path, expected in manifest['files'].items():
            relative = Path(path)
            require(not relative.is_absolute() and '..' not in relative.parts, 'PATH_DENIED')
            actual = (root/relative).read_bytes()
            require(len(actual) == expected['bytes'] and hashlib.sha256(actual).hexdigest() == expected['sha256'], 'BYTES_DENIED')
    trace = base/'search-selection-trace-20261012-v1'
    failure = json.loads((trace/'diagnostic-candidate-v2.json').read_bytes())
    require(failure['passed'] is False and failure['failureStage'] == 'trace-stream-read' and failure['failureKind'] == 'bounded_assertion', 'FAILURE_RETENTION_DENIED')
    for kind in ['baseline', 'candidate']:
        run = json.loads((trace/f'diagnostic-{kind}-v4.json').read_bytes())
        require(run['passed'] and len(run['cycles']) == 16 and run['diagnosticOnly'] and not run['physicalDevice'], 'DIAGNOSTIC_DENIED')
        require(run['rawTraceArgumentsPersisted'] is False and run['rawProfileUrlsPersisted'] is False, 'PRIVACY_SCOPE_DENIED')
    nav = json.loads((base/'mobile-nav-read-20261012-v1/geometry-outcome-v1.json').read_bytes())
    require(nav['metrics']['inlineNavHeight']['count'] == 50 and nav['metrics']['computedNavHeight']['count'] == 0 and nav['metrics']['visualViewportHeight']['count'] == 218, 'GEOMETRY_DENIED')
    require(nav['improvementProven'] is False and nav['performanceAdmission'] == 0, 'ACCEPTANCE_DENIED')
    print(json.dumps({'status': 'passed', 'mappedFiles': 44, 'diagnosticOnly': True, 'performanceAccepted': False, 'goalComplete': False}))

if __name__ == '__main__':
    main()
