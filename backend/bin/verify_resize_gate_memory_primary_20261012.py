"""Verify frozen primary failure and byte integrity, never release acceptance."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = '1e7daaa57ab42d1acb63ea40c9b709abe9fc704d322bd2cadbbb5df854b7a491'
SUMMARY = 'bcaffb2cf5a48cffb7067e37d7a0e07a1e6d6b6529f1adf352a891f2be89aa2d'
DEFAULT = Path(__file__).resolve().parents[2]/'apps/web/performance/resize-gate-memory-primary-20261012-v1'

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
    require(len(manifest['files']) == 163 and manifest['performanceAdmission'] == 0 and not manifest['candidateAccepted'], 'SCOPE_DENIED')
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
    require(hashlib.sha256((root/'browser-confirm-summary-v7.json').read_bytes()).hexdigest() == SUMMARY, 'SUMMARY_DENIED')
    plan = json.loads((root/'browser-confirm-plan-v7.json').read_bytes())
    require(plan['guardUnchanged'] == {'heapRegressionPercent': 20, 'inputLatencyRegressionPercent': 15}, 'GUARD_DENIED')
    final = json.loads((root/'browser-series-final-v7.json').read_bytes())
    require(len(final['phases']) == 22 and all(r['matched'] and r['exit'] == 0 for r in final['phases']), 'SERIES_DENIED')
    for row in final['phases']:
        run = json.loads((root/f"ui-{row['label']}/raw.json").read_bytes())
        expected = plan['sourceBefore'] if row['kind'] == 'baseline' else plan['sourceAfter']
        require(run['passed'] and len(run['cycles']) == 256 and run['sourceCommit'] == expected, 'PROCESS_DENIED')
        require(not run['sdk']['stub'] and run['sdkScript']['sha256'] == plan['sdkScriptSha256'], 'SDK_DENIED')
        require(not run['physicalDevice'] and run['fieldAdmission'] == 0 and run['performanceAdmission'] == 0, 'RAW_SCOPE_DENIED')
    summary = json.loads((root/'browser-confirm-summary-v7.json').read_bytes())
    require(summary['primaryMedianGuardPass'] and not summary['primaryPairedCIWithinGuard'], 'CONCLUSION_DENIED')
    idle = next(m for m in summary['metrics'] if m['metric'] == 'idle_heap_MB')
    require(not idle['pairedRelative95CiWithinGuard'] and idle['pairsAboveGuard'] == 2 and idle['paired95CiRelativeReductionPercent'][0] < -20, 'IDLE_LIMIT_DENIED')
    rerun = json.loads((root/'independent-statistics-rerun-v1.json').read_bytes())
    require(rerun['sameBytes'] and rerun['summarySha256'] == SUMMARY and rerun['originalDataUnchanged'], 'RERUN_DENIED')
    scored = json.loads((root/'canonical-zero-v1/backlog.scored.json').read_bytes())
    require(not scored['items'] and not scored['ranking']['admittedIds'] and scored['releaseBlocked'], 'ADMISSION_DENIED')
    print(json.dumps({'status': 'passed', 'files': 163, 'candidateAccepted': False, 'goalComplete': False}))

if __name__ == '__main__': main()
