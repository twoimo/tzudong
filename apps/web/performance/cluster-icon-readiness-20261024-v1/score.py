"""Score only the retained, controlled Chromium mechanism experiment."""
import hashlib
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT.parent.parent
raw = json.loads((ROOT / 'raw.json').read_text())
assert len(raw['trials']) == 36
assert hashlib.sha256((ROOT / 'baseline-cluster-marker.ts.txt').read_bytes()).hexdigest() == raw['baselineSourceSha256']
for name, digest in raw['sourceHashes'].items():
    assert hashlib.sha256((APP / name).read_bytes()).hexdigest() == digest, name


def median(values):
    return statistics.median(values)


def mad(values):
    middle = median(values)
    return median([abs(value - middle) for value in values])


results = []
for width in [1440, 390, 820]:
    arms = []
    for candidate in [False, True]:
        trials = [trial for trial in raw['trials'] if trial['width'] == width and trial['candidate'] == candidate]
        assert sorted(trial['pair'] for trial in trials) == list(range(6))
        delays, gaps, decode, initial, pre_expansion, late_resources = [], [], [], [], [], []
        for trial in trials:
            assert not trial['errors'] and not trial['unexpected']
            assert trial['primerPictures'] == (18 if candidate else 0)
            assert trial['primerAfterDispose'] == 0
            assert len(trial['requests']) == len(set(trial['requests'])) == 18
            assert all(path.endswith('.webp') for path in trial['requests'])
            assert len(trial['selectedSources']) == 18
            samples = trial['samples']
            assert samples and all(sample['visible'] == 76 for sample in samples)
            ready = next(sample['at'] for sample in samples if sample['notReady'] == 0)
            assert ready <= 250
            delays.append(ready)
            gaps.append(max([samples[0]['at']] + [right['at'] - left['at'] for left, right in zip(samples, samples[1:])]))
            decode += [item['decodePromiseMs'] for item in trial['decodeAfterReady']]
            initial.append(trial['initialReadyMs'])
            pre_expansion.append(sum(resource['relativeResponseEnd'] <= 0 for resource in trial['resources']))
            late_resources.append(sum(resource['relativeResponseEnd'] > 0 for resource in trial['resources']))
        arms.append({'arm': 'candidate' if candidate else 'baseline', 'samples': len(trials),
                     'firstAllVisibleReadyMs': {'median': median(delays), 'min': min(delays), 'max': max(delays), 'mad': mad(delays)},
                     'maxRafGapMs': max(gaps), 'initialImageReadyMsMedian': median(initial),
                     'explicitDecodeAfterAlreadyReadyMsMedian': median(decode),
                     'resourcesCompletedBeforeExpansionMedian': median(pre_expansion),
                     'resourcesCompletedAfterExpansionMedian': median(late_resources)})
    before, after = [arm['firstAllVisibleReadyMs']['median'] for arm in arms]
    delta = before - after
    noise = max(16.7, 2 * max(arm['firstAllVisibleReadyMs']['mad'] for arm in arms))
    results.append({'width': width, 'arms': arms, 'absoluteReductionMs': delta,
                    'relativeReductionPercent': 100 * delta / before, 'noiseBudgetMs': noise,
                    'localBudgetPassed': delta >= 30 and delta / before >= 0.25 and delta > noise})

scored = {'scope': raw['scope'], 'rawSha256': hashlib.sha256((ROOT / 'raw.json').read_bytes()).hexdigest(),
          'budgets': {'allVisibleReadyMs': 250, 'absoluteReductionMs': 30, 'relativeReductionPercent': 25,
                      'noiseFloorMs': 16.7, 'noiseMadMultiplier': 2, 'maxPrimerPictures': 18},
          'results': results, 'localBudgetAllViewportsPassed': all(item['localBudgetPassed'] for item in results),
          'productionImprovementAdmittedSlices': 0, 'externalReviewComplete': False, 'deployed': False,
          'limits': ['Controlled 80 ms response delay is an experimental condition, not measured production RTT.',
                     'All images are ready before explicit decode timing; that timing cannot isolate decoder CPU work.',
                     'Readiness is complete plus naturalWidth sampled on rAF, not a pixel or compositor oracle.',
                     'Playwright routed responses do not establish production wire-byte or startup contention cost.',
                     'No real SDK, matched hosted preview, production, field or physical-device improvement established.']}
(ROOT / 'scored.json').write_text(json.dumps(scored, indent=2) + '\n')
print(json.dumps(scored, indent=2))
