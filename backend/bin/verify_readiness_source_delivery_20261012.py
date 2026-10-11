"""Verify a source-only delivery checkpoint, preserving uncompleted operating gates."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = 'aac314312b5a0379722041732ab4d5d017b116097333c881ab5236f805669e90'
DEFAULT = Path(__file__).resolve().parents[2] / 'apps/web/performance/readiness-operating-20261012'


def require(condition, code):
    if not condition:
        raise ValueError(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    path = root / 'artifact-map-source-delivery-v1.json'
    require(not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == PIN, 'MAP_DENIED')
    manifest = json.loads(path.read_bytes())
    require(len(manifest['files']) == 53 and manifest['operatingWrites'] == 0
            and not manifest['newSourceServing'] and not manifest['goalComplete'], 'SCOPE_DENIED')
    observed = set()
    for p in root.rglob('*'):
        require(not p.is_symlink(), 'SYMLINK_DENIED')
        if p.is_file():
            observed.add(p.relative_to(root).as_posix())
    require(observed == set(manifest['files']) | {path.name}, 'INVENTORY_DENIED')
    for name, item in manifest['files'].items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'PATH_DENIED')
        raw = (root / relative).read_bytes()
        require(len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256'], 'BYTES_DENIED')
    read = lambda name: json.loads((root / name).read_bytes())
    identity = read('serving-identity-readback-v2.json')
    require(identity['gitSha'] == '1884f87e53c4567ead7c9a0fb394b09b91a70396'
            and identity['sourceMain'] == '056a86600f412eb42df4304e3206841679012f3e'
            and not identity['newSourceServing'], 'SERVING_SCOPE_DENIED')
    bundle = read('atomic-readiness-binding-v1.json')
    require(len(bundle['sources']) == 11 and hashlib.sha256((root / 'atomic-readiness-v1.sql').read_bytes()).hexdigest()
            == '77b34753c68047d3b479484f156e44044d015c53b8e5d459da4b8d1d97f0d1d3', 'BUNDLE_DENIED')
    atomic = read('atomic-11-pg17-v4.json')
    require(atomic['status'] == 'passed' and atomic['units'] == 11 and atomic['operatingWrites'] == 0, 'LOCAL_SCOPE_DENIED')
    protocol = read('legacy-gif-browser-protocol-v1.json')
    require(protocol['status'] == 'passed' and protocol['fixtureOnly']
            and not protocol['actualAdminAuthentication'] and not protocol['actualAdminUi'], 'PROTOCOL_SCOPE_DENIED')
    print(json.dumps({'status': 'passed', 'files': 53, 'mapSha256': PIN,
                      'newSourceServing': False, 'operatingWrites': 0, 'goalComplete': False}))


if __name__ == '__main__':
    main()
