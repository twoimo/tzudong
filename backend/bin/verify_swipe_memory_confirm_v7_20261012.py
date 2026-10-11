"""Verify retained failed admission evidence; passing this is not performance acceptance."""
from pathlib import Path
import argparse
import hashlib
import json

MAP_SHA256 = '82392f3e2896e2cef25423c479efe7f0a1cf738e704df509d70cd22e8594f41c'
DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'apps/web/performance/swipe-memory-confirm-v7-20261012'


def require(condition, code):
    if not condition:
        raise ValueError(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    manifest = root / 'artifact-map-v1.json'
    require(not manifest.is_symlink() and hashlib.sha256(manifest.read_bytes()).hexdigest() == MAP_SHA256, 'MAP_PIN_DENIED')
    m = json.loads(manifest.read_bytes())
    require(len(m['files']) == 188 and m['sourceBefore'] == 'da4c9be17e54733414cc7e1d2f8365d25bee4d87'
            and m['sourceAfter'] == '21a86dca974f9bbdeed52d19d2fde0e9cc1fcac6', 'IDENTITY_DENIED')
    observed = set()
    for p in root.rglob('*'):
        require(not p.is_symlink(), 'SYMLINK_DENIED')
        if p.is_file():
            observed.add(p.relative_to(root).as_posix())
    require(observed == set(m['files']) | {'artifact-map-v1.json'}, 'INVENTORY_DENIED')
    for relative, item in m['files'].items():
        p = Path(relative)
        require(not p.is_absolute() and '..' not in p.parts, 'PATH_DENIED')
        raw = (root / p).read_bytes()
        require(len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256'], 'BYTES_DENIED')
    final = json.loads((root / 'browser-series-final-v7.json').read_bytes())
    require(len(final['phases']) == 22 and all(r['matched'] and r['exit'] == 0 for r in final['phases']), 'SERIES_DENIED')
    summary = json.loads((root / 'browser-confirm-summary-v7.json').read_bytes())
    require(summary['primaryMedianGuardPass'] is True and summary['primaryPairedCIWithinGuard'] is False
            and summary['canonicalPerformanceAdmission'] == 0 and summary['goalComplete'] is False, 'ADMISSION_DENIED')
    scored = json.loads((root / 'canonical-zero-v4/backlog.scored.json').read_bytes())
    require(not scored['items'] and not scored['ranking']['admittedIds'] and scored['releaseBlocked'], 'SCORER_SCOPE_DENIED')
    print(json.dumps({'status': 'passed', 'files': 188, 'mapSha256': MAP_SHA256,
                      'performanceAccepted': False, 'goalComplete': False}))


if __name__ == '__main__':
    main()
