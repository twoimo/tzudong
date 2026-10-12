"""Bind zero admitted performance slices to the retained v7 browser observations."""
from pathlib import Path
import datetime
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
NODE = '/opt/homebrew/opt/node@24/bin/node'
PRIOR = ROOT.parent / 'swipe-memory-confirm-v7-20261012/canonical-zero-v4'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    with path.open('x') as f:
        f.write(json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n')


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def main():
    plan = json.loads((ROOT / 'browser-confirm-plan-v7.json').read_bytes())
    final = json.loads((ROOT / 'browser-series-final-v7.json').read_bytes())
    if len(final['phases']) != 22 or not all(r['matched'] and r['exit'] == 0 for r in final['phases']):
        raise ValueError('SERIES_INCOMPLETE')
    runs = [json.loads((ROOT / f"ui-{r['label']}/raw.json").read_bytes()) for r in final['phases']]
    if any(not r['passed'] or len(r['cycles']) != 256 for r in runs):
        raise ValueError('FLOW_INCOMPLETE')
    out = ROOT / 'canonical-zero-v1'
    out.mkdir()
    shutil.copytree(PRIOR / 'contracts', out / 'contracts')
    context = {'candidate': {'sha': plan['sourceAfter'], 'tree': 'ff220465f850ed8d0b9289b93d3dde1db8841a4b'},
               'configSha256': digest(ROOT / 'browser-confirm-plan-v7.json'),
               'dataProfileSha256': digest(ROOT / 'fixture-query-v7.mjs'),
               'frozenAsOf': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
               'releaseId': 'resize-gate-memory-primary-20261012-v1'}
    prior_health = json.loads((PRIOR / 'health.json').read_bytes())
    incidents = []
    for receipt, run in zip(final['phases'], runs):
        for kind, count in [('console', run['errors']['console']), ('page', run['errors']['page']),
                            ('network', run['requests']['failedRemoteProvider'] + run['requests']['failedAppAsset'])]:
            for i in range(count):
                incidents.append({'capturedAt': timestamp(run['endedAtUtc']),
                                  'gate': 'required_cell_console_page_network_errors',
                                  'id': f"{receipt['label']}-{kind}-{i}"})
    incidents.sort(key=lambda row: json.dumps([row['id']], separators=(',', ':')))
    coverage = sorted(prior_health['coverage'], key=lambda row: json.dumps([row['gate']], separators=(',', ':')))
    for row in coverage:
        row['count'] = len(incidents) if row['gate'] == 'required_cell_console_page_network_errors' else 0
    health = {k: v for k, v in context.items() if k != 'frozenAsOf'}
    health.update(schemaVersion='performance-health-source.v1', coverage=coverage, incidents=incidents,
                  window={'start': min(timestamp(r['startedAtUtc']) for r in runs),
                          'end': max(timestamp(r['endedAtUtc']) for r in runs)})
    save(out / 'health.json', health)
    raw = dict(context, schemaVersion='performance-backlog-raw.v2', items=[],
               healthReceipt={'path': 'health.json', 'sha256': digest(out / 'health.json')})
    save(out / 'backlog.raw.json', raw)
    artifact_map = dict(context, schemaVersion='performance-trusted-artifacts.v1',
                        artifacts={p: digest(out / p) for p in ['health.json', 'backlog.raw.json']},
                        pins=json.loads((PRIOR / 'score-artifact-map.json').read_bytes())['pins'])
    save(out / 'score-artifact-map.json', artifact_map)
    base = ['--artifact-root', str(out), '--release-id', context['releaseId'],
            '--candidate-sha', context['candidate']['sha'], '--candidate-tree', context['candidate']['tree'],
            '--config-sha256', context['configSha256'], '--data-profile-sha256', context['dataProfileSha256'],
            '--frozen-as-of', context['frozenAsOf'], '--input', 'backlog.raw.json']
    score_args = base + ['--artifact-map', 'score-artifact-map.json', '--artifact-map-sha256', digest(out / 'score-artifact-map.json'), '--output', 'backlog.scored.json']
    score = subprocess.run([NODE, str(REPO / 'apps/web/scripts/score-performance-backlog.mjs'), *score_args], capture_output=True, text=True)
    (out / 'score.log').write_text(score.stdout + score.stderr)
    if score.returncode:
        raise ValueError('SCORER_FAILED')
    artifact_map['artifacts']['backlog.scored.json'] = digest(out / 'backlog.scored.json')
    with (out / 'backlog.scored.json.sha256').open('x') as f:
        f.write(digest(out / 'backlog.scored.json') + '\n')
    artifact_map['artifacts']['backlog.scored.json.sha256'] = digest(out / 'backlog.scored.json.sha256')
    save(out / 'validate-artifact-map.json', artifact_map)
    validate_args = base + ['--artifact-map', 'validate-artifact-map.json', '--artifact-map-sha256', digest(out / 'validate-artifact-map.json'), '--scored', 'backlog.scored.json']
    validator = subprocess.run([NODE, str(REPO / 'apps/web/scripts/validate-performance-backlog.mjs'), *validate_args], capture_output=True, text=True)
    (out / 'validate.log').write_text(validator.stdout + validator.stderr)
    if validator.returncode:
        raise ValueError('VALIDATOR_FAILED')
    scored = json.loads((out / 'backlog.scored.json').read_bytes())
    if scored['items'] or scored['ranking']['admittedIds'] or not scored['releaseBlocked']:
        raise ValueError('ADMISSION_DRIFT')
    save(out / 'basis.json', {'scoreCommand': score_args, 'validatorCommand': validate_args,
                             'items': 0, 'admissions': 0, 'consoleObservations': sum(r['errors']['console'] for r in runs),
                             'networkObservations': sum(r['requests']['failedRemoteProvider'] + r['requests']['failedAppAsset'] for r in runs),
                             'observationOverlapPossible': True, 'noMemoryMetricInBudget': True,
                             'zeroOtherIncidentsNotCoverageProof': True, 'goalComplete': False})
    print(json.dumps({'scorer': 'pass', 'validator': 'pass', 'items': 0, 'admitted': 0, 'releaseBlocked': True, 'observations': len(incidents)}))


if __name__ == '__main__':
    main()
