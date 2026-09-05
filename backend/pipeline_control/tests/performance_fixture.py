"""Synthetic complete canonical corpus for verifier tests, never live evidence."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
FORMS = {'app_owned_invocation_errors': 'function_summary',
    'candidate_related_failed_production_deployments': 'deployment_summary',
    'duplicate_hot_query_count': 'sanitized_query_summary',
    'new_auth_rls_service_role_no_store_confirmation_readback_audit_violations': 'sanitized_security_review',
    'required_cell_console_page_network_errors': 'sanitized_browser_summary',
    'required_manifest_validator_failures': 'validator_summary'}


def canonical_fixture(root):
    root = Path(root).resolve()
    prefix = 'apps/web/performance/fixture/'
    artifacts = {}
    def put(name, value, mapped=True):
        path = prefix + name
        data = value if isinstance(value, bytes) else (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        if mapped:
            artifacts[path] = digest
        return {'path': path, 'sha256': digest}
    tree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    commit = f'tree {tree}\nauthor Fixture <fixture@invalid.example> 0 +0000\ncommitter Fixture <fixture@invalid.example> 0 +0000\n\nfixture\n'.encode()
    sha = hashlib.sha1(b'commit ' + str(len(commit)).encode() + b'\0' + commit).hexdigest()
    commit_ref = put('commit.json', {'kind': 'git_commit_object_v1', 'contentBase64': base64.b64encode(commit).decode()}, False)
    binding = {'releaseId': 'rust-fixture', 'candidate': {'sha': sha, 'tree': tree},
        'configSha256': 'b' * 64, 'dataProfileSha256': 'c' * 64}
    as_of = '2026-09-05T00:00:00.000000Z'
    window = {'start': '2026-09-04T00:00:00.000000Z', 'end': as_of}
    health = put('health.json', {'schemaVersion': 'performance-health-source.v1', **binding,
        'window': window, 'coverage': [{'gate': key, 'evidenceForm': value, 'count': 0}
        for key, value in sorted(FORMS.items())], 'incidents': []})
    pins = {}
    for key, file in [('rawSchema', 'backlog-raw.schema.json'), ('scoredSchema', 'backlog-scored.schema.json'),
                      ('budget', 'performance-budgets.v1.json')]:
        pins[key] = put(file, (ROOT / 'apps/web/performance' / file).read_bytes(), False)
    budgets = json.loads((ROOT / 'apps/web/performance/performance-budgets.v1.json').read_text())['budgets']
    artifact = 'fixture@sha256:' + 'a' * 64
    items, captures = [], {}
    for index, budget in enumerate(budgets):
        key, identity = budget['key'], f'row-{index:02d}'
        observations = sorted([{'id': f'{cohort}-{i:05d}', 'cohort': cohort,
            'capturedAt': as_of if cohort == 'candidate' else '2026-09-04T12:00:00.000000Z',
            'value': budget['absoluteBudget'], 'ownershipBasisPoints': 10000}
            for cohort in ('baseline', 'candidate') for i in range(budget['sampleMinimum'])], key=lambda x: x['id'])
        if key.startswith('backend.'):
            captures[key] = put(f'{identity}-capture.json', {'kind': 'rust_measurement_execution_v1', **binding,
                'key': key, 'sliceId': 'R1', 'implementation': 'rust', 'rustArtifactId': artifact,
                'compiledArtifactSha256': 'a' * 64,
                'observations': [o for o in observations if o['cohort'] == 'candidate']}, False)
        forms = budget['evidenceForms']
        attestations = [{'cohort': cohort, 'evidenceForm': form,
            'providerId': 'sanitized-provider' if form == 'external_provider' else None, 'capturedAt': as_of,
            'sourceSha256': captures[key]['sha256'] if key in captures and cohort == 'candidate' and form == ('rss_ndjson' if key == 'backend.peak_rss_mib' else 'benchmark_summary') else hashlib.sha256(f'{identity}:{cohort}:{form}'.encode()).hexdigest()}
            for cohort in ('baseline', 'candidate') for form in forms]
        attestations.sort(key=lambda a: (a['cohort'], a['evidenceForm'], a['providerId'] or ''))
        measurement = put(f'{identity}-measurement.json', {'schemaVersion': 'performance-measurement-source.v1',
            **binding, 'key': key, 'surfaceClass': budget['surfaceClass'], 'targetId': budget['targetId'],
            'availability': {'status': 'available', 'reason': None}, 'window': window,
            'observations': observations, 'attestations': attestations})
        manifest = put(f'{identity}-manifest.json', {'schemaVersion': 'performance-design-manifest.v1', **binding,
            'candidateId': identity, 'hypothesis': 'Reduce a bounded rendering delay without collecting private records.',
            'symbols': [{'path': 'apps/web/app/page.tsx', 'symbol': 'Page'}],
            'files': [{'path': 'apps/web/app/page.tsx', 'addedNonTestLoc': 1, 'deletedNonTestLoc': 0}],
            'tests': [{'id': 'governance-unit', 'kind': 'unit', 'path': 'apps/web/tests-unit/performance-backlog-governance.test.ts'}],
            'boundaries': [], 'rollback': {'kind': 'revert_candidate', 'steps': ['Revert the candidate commit.'],
            'verificationTestIds': ['governance-unit']}, 'stopConditions': [{'id': 'regression',
            'condition': 'Stop on regression.', 'requiredAction': 'stop_and_revert'}]})
        items.append({'id': identity, 'key': key, 'surfaceClass': budget['surfaceClass'],
                      'targetId': budget['targetId'], 'measurement': measurement, 'manifest': manifest})
    raw = put('raw.json', {'schemaVersion': 'performance-backlog-raw.v2', **binding, 'frozenAsOf': as_of,
                           'healthReceipt': health, 'items': sorted(items, key=lambda item: item['id'])})
    artifact_map = {'schemaVersion': 'performance-trusted-artifacts.v1', **binding,
                    'frozenAsOf': as_of, 'pins': pins, 'artifacts': artifacts}
    map_ref = put('map.json', artifact_map, False)
    scored_path = prefix + 'scored.json'
    argv = ['node', str(ROOT / 'apps/web/scripts/score-performance-backlog.mjs'),
        '--artifact-root', str(root), '--artifact-map', map_ref['path'], '--artifact-map-sha256', map_ref['sha256'],
        '--release-id', binding['releaseId'], '--candidate-sha', sha, '--candidate-tree', tree,
        '--config-sha256', binding['configSha256'], '--data-profile-sha256', binding['dataProfileSha256'],
        '--frozen-as-of', as_of, '--input', raw['path'], '--output', scored_path]
    subprocess.run(argv, check=True, capture_output=True, timeout=60)
    scored_bytes = (root / scored_path).read_bytes()
    scored = put('scored.json', scored_bytes)
    put('scored.json.sha256', (scored['sha256'] + '\n').encode())
    map_ref = put('map.json', artifact_map, False)
    receipt = {'kind': 'rust_performance_admission_v1', 'sliceId': 'R1', 'rustArtifactId': artifact,
        'frozenTree': {'startCommit': sha, 'endCommit': sha, 'startClean': True, 'endClean': True},
        'candidateCommitObject': commit_ref, 'artifactMap': map_ref, 'raw': raw, 'scored': scored,
        'runtimeCaptures': captures}
    return {'reference': put('admission.json', receipt, False), 'artifact': artifact, 'sha': sha,
            'admittedCount': len(json.loads(scored_bytes)['ranking']['admittedIds'])}
