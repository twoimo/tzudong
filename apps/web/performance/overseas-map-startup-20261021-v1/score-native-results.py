"""Independent scoring of retained local native evidence; no browser actions."""
import hashlib
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT.parent.parent


def read(name):
    return json.loads((ROOT / name).read_text())


raw = read('native-results.json')
followup = read('native-followup-results.json')
assert raw['sourceHashes'] == followup['sourceHashes']
for name, expected in raw['sourceHashes'].items():
    assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == expected, name
assert raw['failures'] == [{'id': 'baseline-497', 'message': 'Baseline did not reproduce the CSP/loading failure'}]
assert not followup['failures']
baseline = next(case for case in followup['results'] if case['input']['baseline'])
assert baseline['readiness'] == 'not_reached_with_observed_csp_failure'
assert 'csp_block' in baseline['errors'] and baseline['facts']['loadingCover']
assert not baseline['facts']['attributionVisible']
samples = [case for case in raw['results'] if 'mapReadyMs' in case]
assert len(samples) == 10
for case in samples:
    assert not case['errors'] and not case['blocked']
    assert case['facts']['state'] == 'ready' and case['facts']['attributionVisible']
    assert case['facts']['canvasCount'] == 1 and not case['facts']['loadingCover']
    assert not case['facts']['pageOverflow']
    assert case['mapVisibleWhilePinsPending'] and case['countryCanvasReused']
    assert case['startupResourceReloadsOnCountrySwitch'] == 0
    for filename in ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']:
        resource = next(item for item in case['resources'] if item['path'].endswith('/' + filename))
        assert resource['status'] == 200 and 'javascript' in resource['mime']
retry = next(case for case in followup['results'] if case['input']['id'] == 'style-error-retry')
assert retry['oldCanvasRemoved'] and retry['countryTilePath'].endswith('/11/1803/809.pbf')
slow = next(case for case in raw['results'] if case['input']['id'] == 'slow-style-late-success')
assert slow['slowNoticeObserved'] and slow['originalRequestCompletedWithoutRetry']
intent = next(case for case in raw['results'] if case['input']['id'] == 'intent-preload')
assert not intent['hiddenMapBeforeActivation'] and intent['providerResourcesBeforeActivation'] == 0
mobile = [case['mapReadyMs'] for case in samples if case['input']['id'].startswith('mobile-497-')]
median = statistics.median(mobile)
mad = statistics.median(abs(value - median) for value in mobile)
assert median == raw['mobile497']['medianMs'] and mad == raw['mobile497']['madMs']
home = read('home-results.json')
assert len(home['cases']) == 2
for case in home['cases']:
    assert not case['errors'] and case['facts']['attributionVisible']
    assert case['domesticSwitchRemovesOverseasCanvas'] and not case['facts']['pageOverflow']
assert read('app-build-receipt.json')['exitCode'] == 0
score = {
    'sourceHashesVerified': True,
    'initialRun': {'candidateCasesPassed': 13, 'baselineObserverFailures': 1},
    'focusedFollowupCasesPassed': 2,
    'fullApplicationHomeCasesPassed': 2,
    'absoluteBudgetMs': 5000,
    'absoluteBudgetAllTenSamplesPassed': all(case['mapReadyMs'] <= 5000 for case in samples),
    'absoluteNoiseFloorMs': 250,
    'mobile497': {'samples': len(mobile), 'medianMs': median, 'minMs': min(mobile), 'maxMs': max(mobile), 'madMs': mad},
    'allViewportRangeMs': [min(case['mapReadyMs'] for case in samples), max(case['mapReadyMs'] for case in samples)],
    'relativeImprovement': None,
    'reason': 'Baseline did not reach readiness; no percentage or production/field speedup claim is supported.',
    'externalCrossAuditComplete': False,
    'deployed': False,
}
assert score['absoluteBudgetAllTenSamplesPassed']
(ROOT / 'scored.json').write_text(json.dumps(score, indent=2) + '\n')
print(json.dumps(score))
