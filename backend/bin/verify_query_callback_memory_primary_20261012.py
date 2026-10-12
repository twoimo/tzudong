"""Verify fixed primary evidence bytes and its unaccepted scope."""
from pathlib import Path
import argparse
import hashlib
import json

PIN = '5b6e202830b5a92229faa490f81be12d92fec47618942101ffd2a469affcfff6'
SUMMARY_PIN = '9b68f7cb61ea92c4c307c5a049b42f8a1f766a2d15be787ae8376ac3ad8f6e37'
DEFAULT = Path(__file__).resolve().parents[2] / 'apps/web/performance/query-callback-memory-primary-20261012-v2'

def require(ok, code):
    if not ok:
        raise ValueError(code)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=DEFAULT)
    root = parser.parse_args().root
    require(root.is_dir() and not root.is_symlink(), 'ROOT_DENIED')
    path = root/'artifact-map-v1.json'
    require(sha(path) == PIN, 'MAP_PIN_DENIED')
    manifest = json.loads(path.read_bytes())
    require(len(manifest['files']) == 164 and not manifest['candidateAccepted'] and
            manifest['performanceAdmission'] == 0 and manifest['fieldAdmission'] == 0, 'SCOPE_DENIED')
    observed = set()
    for file in root.rglob('*'):
        require(not file.is_symlink(), 'SYMLINK_DENIED')
        if file.is_file():
            observed.add(file.relative_to(root).as_posix())
    require(observed == set(manifest['files']) | {'artifact-map-v1.json'}, 'INVENTORY_DENIED')
    for name, expected in manifest['files'].items():
        relative = Path(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'PATH_DENIED')
        data = (root/relative).read_bytes()
        require(len(data) == expected['bytes'] and hashlib.sha256(data).hexdigest() == expected['sha256'], 'BYTES_DENIED')
    require(sha(root/'browser-confirm-summary-v7.json') == SUMMARY_PIN, 'SUMMARY_DENIED')
    plan = json.loads((root/'browser-confirm-plan-v7.json').read_bytes())
    require(plan['guardUnchanged'] == {'heapRegressionPercent': 20, 'inputLatencyRegressionPercent': 15}, 'GUARD_DENIED')
    final = json.loads((root/'browser-series-final-v7.json').read_bytes())
    require(len(final['phases']) == 22 and 'endedAtUtc' in final, 'SERIES_INCOMPLETE')
    for run in final['phases']:
        require(run['exit'] == 0 and run['matched'], 'PROCESS_DENIED')
        raw = json.loads((root/f"ui-{run['label']}/raw.json").read_bytes())
        expected = plan['sourceBefore'] if run['kind'] == 'baseline' else plan['sourceAfter']
        require(raw['sourceCommit'] == expected and raw['passed'] and len(raw['cycles']) == 256, 'FLOW_DENIED')
        require(raw['sdkScript']['sha256'] == plan['sdkScriptSha256'] and not raw['sdk']['stub'], 'SDK_DENIED')
        require(raw['physicalDevice'] is False and raw['fieldAdmission'] == 0 and raw['performanceAdmission'] == 0, 'RAW_SCOPE_DENIED')
        require(raw['requests'].get('unsupportedFixtureQueries', 0) == 0 and raw['errors']['page'] == 0 and raw['errors']['console'] == 2, 'ERROR_ACCOUNTING_DENIED')
    summary = json.loads((root/'browser-confirm-summary-v7.json').read_bytes())
    require(summary['primaryMedianGuardPass'] is True and summary['primaryPairedCIWithinGuard'] is False, 'GUARD_CONCLUSION_DENIED')
    for metric in summary['metrics']:
        if metric['metric'] in ['initial_heap_MB', 'end_heap_MB', 'idle_heap_MB', 'sampled_peak_heap_MB']:
            require(metric['pairedRelative95CiWithinGuard'] is True, 'MEMORY_GUARD_DENIED')
        if metric['metric'] == 'input_revisit_process_median_ms':
            require(metric['pairedRelative95CiWithinGuard'] is False and metric['pairsAboveGuard'] == 2, 'LATENCY_LIMIT_DENIED')
    rerun = json.loads((root/'independent-statistics-rerun-v1.json').read_bytes())
    require(rerun['sameBytes'] and rerun['summarySha256'] == SUMMARY_PIN and rerun['originalDataUnchanged'], 'RERUN_DENIED')
    scored = json.loads((root/'canonical-zero-v1/backlog.scored.json').read_bytes())
    require(scored['items'] == [] and scored['ranking']['admittedIds'] == [] and scored['releaseBlocked'], 'ADMISSION_DENIED')
    print(json.dumps({'status': 'passed', 'files': 164, 'mapSha256': PIN,
                      'memoryCIWithin20PercentGuard': True, 'revisitLatencyCIWithin15PercentGuard': False,
                      'performanceAccepted': False, 'goalComplete': False}))

if __name__ == '__main__':
    main()
