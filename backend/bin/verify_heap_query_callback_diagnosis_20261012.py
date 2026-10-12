"""Verify fixed diagnostic evidence, not performance or release acceptance."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = 'ccfc13096504406f1a1803b5440d47b1efb844069502c19fbe55fdf95fabc12c'
DEFAULT = Path(__file__).resolve().parents[2] / 'apps/web/performance/swipe-heap-retainers-20261012-v1'

def require(ok, code):
    if not ok:
        raise ValueError(code)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    path = root / 'artifact-map-v1.json'
    require(hashlib.sha256(path.read_bytes()).hexdigest() == PIN, 'MAP_PIN_DENIED')
    manifest = json.loads(path.read_bytes())
    require(len(manifest['files']) == 207 and manifest['performanceAdmission'] == 0, 'SCOPE_DENIED')
    observed = set()
    for file in root.rglob('*'):
        require(not file.is_symlink(), 'SYMLINK_DENIED')
        if file.is_file():
            observed.add(file.relative_to(root).as_posix())
    require(observed == set(manifest['files']) | {'artifact-map-v1.json'}, 'INVENTORY_DENIED')
    for name, expected in manifest['files'].items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'PATH_DENIED')
        data = (root / relative).read_bytes()
        require(len(data) == expected['bytes'] and hashlib.sha256(data).hexdigest() == expected['sha256'], 'BYTES_DENIED')
    audit = json.loads((root / 'query-owner-stage4-v1/compiled-scope-audit-v1.json').read_bytes())
    require(audit['inlineFactoryRows'] == 0 and audit['opaqueLookupRows'] == 4 and not audit['rawCodePersisted'], 'AST_DENIED')
    raw = json.loads((root / 'query-owner-stage4-v1/ui-query-owner-stage4-after-v1/raw.json').read_bytes())
    require(raw['passed'] and len(raw['cycles']) == 256 and raw['primaryMeasurement'] is False, 'BROWSER_SCOPE_DENIED')
    require(raw['sourceCommit'] == '81d5aca4951e7cef5d67c1e910f31b3436597466', 'SOURCE_DENIED')
    require(raw['errors']['page'] == 0 and raw['errors']['console'] == 2, 'ERROR_ACCOUNTING_DENIED')
    require(raw['diagnosticHeap']['rawStringsPersisted'] is False and raw['snapshotMayTriggerGc'] is True, 'PRIVACY_SCOPE_DENIED')
    unit = json.loads((root / 'query-owner-stage4-v1/full-unit-summary-v1.json').read_bytes())
    require(unit['counts'] == {'pass': 3463, 'skip': 11, 'fail': 0}, 'UNIT_DENIED')
    print(json.dumps({'status': 'passed', 'files': 207, 'mapSha256': PIN, 'performanceAccepted': False, 'goalComplete': False}))

if __name__ == '__main__':
    main()
