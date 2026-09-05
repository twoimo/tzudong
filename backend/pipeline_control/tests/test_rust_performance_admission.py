"""Performance admission adapter tests; fixture verdicts are not measurements.

The canonical validator's complete scoring/zero-admission corpus lives in the
web governance suite. Here we verify file/hash/commit binding, mandatory command
execution and failure propagation, including rejection by the real validator.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.pipeline_control.rust_performance_admission import verified_performance, VALIDATOR
from backend.pipeline_control.performance_evidence import BACKEND_METRIC_BUDGETS
from backend.pipeline_control import rust_performance_admission as admission
from backend.pipeline_control.tests.performance_fixture import canonical_fixture


class PerformanceAdmissionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix='rust-performance-')
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for args in (['init', '-q'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example',
                                    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture']):
            subprocess.run(['git', *args], cwd=self.root, capture_output=True, check=True)
        self.sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        self.tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=self.root, text=True).strip()
        self.artifact = 'component@sha256:' + 'a' * 64
        self.map = {'schemaVersion': 'performance-trusted-artifacts.v1',
            'candidate': {'sha': self.sha, 'tree': self.tree}, 'releaseId': 'fixture',
            'configSha256': 'b' * 64, 'dataProfileSha256': 'c' * 64,
            'frozenAsOf': '2026-09-05T00:00:00.000000Z', 'artifacts': {}}
        self.raw = {'schemaVersion': 'performance-backlog-raw.v2', 'items': []}
        self.captures = {}
        self.measurements = {}
        capture_refs = {}
        for key in BACKEND_METRIC_BUDGETS:
            observations = [{'id': str(i), 'cohort': 'candidate', 'value': 10,
                'capturedAt': self.map['frozenAsOf'], 'ownershipBasisPoints': 10000} for i in range(7)]
            binding = {k: self.map[k] for k in ('candidate', 'releaseId', 'configSha256', 'dataProfileSha256')}
            self.captures[key] = {'kind': 'rust_measurement_execution_v1', **binding, 'key': key,
                'sliceId': 'R1', 'implementation': 'rust', 'rustArtifactId': self.artifact,
                'compiledArtifactSha256': 'a' * 64, 'observations': observations}
            capture_refs[key] = self.write(key + '-capture.json', self.captures[key])
            self.measurements[key] = {**binding, 'observations': observations, 'attestations': [
                {'cohort': 'candidate', 'evidenceForm': 'rss_ndjson' if key == 'backend.peak_rss_mib' else 'benchmark_summary', 'sourceSha256': capture_refs[key]['sha256']}]}
            measurement = self.write(key + '-measurement.json', self.measurements[key])
            self.map['artifacts'][measurement['path']] = measurement['sha256']
            self.raw['items'].append({'key': key, 'measurement': measurement})
        commit = subprocess.check_output(['git', 'cat-file', 'commit', self.sha], cwd=self.root)
        self.receipt = {'kind': 'rust_performance_admission_v1', 'sliceId': 'R1',
            'rustArtifactId': self.artifact, 'frozenTree': {'startCommit': self.sha,
            'endCommit': self.sha, 'startClean': True, 'endClean': True},
            'candidateCommitObject': self.write('commit.json', {'kind': 'git_commit_object_v1',
                'contentBase64': base64.b64encode(commit).decode()}),
            'runtimeCaptures': capture_refs,
            'artifactMap': self.write('map.json', self.map),
            'raw': self.write('raw.json', self.raw),
            'scored': self.write('scored.json', self.scored())}

    def scored(self):
        return {'schemaVersion': 'performance-backlog-scored.v2', 'releaseBlocked': False,
                'ranking': {'admittedIds': []}, 'items': [{'key': key, 'sampleCount': 7,
                    'observed': 10, 'baseline': 10} for key in BACKEND_METRIC_BUDGETS]}

    def write(self, name, value):
        relative = 'apps/web/performance/' + name
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        path.write_bytes(raw)
        return {'path': relative, 'sha256': hashlib.sha256(raw).hexdigest()}

    def check(self, runner=None):
        return verified_performance(self.write('receipt.json', self.receipt), 'R1', self.artifact,
                                    self.sha, repo_root=self.root, runner=runner)

    def test_zero_admitted_count_is_valid_only_after_canonical_command_succeeds(self):
        calls = []
        def validator(argv, **kwargs):
            calls.append((argv, kwargs))
            return SimpleNamespace(returncode=0)
        self.assertTrue(self.check(validator))
        self.assertEqual(len(calls), 1)
        argv, kwargs = calls[0]
        self.assertEqual(argv[1], str(VALIDATOR))
        args = dict(zip(argv[2::2], argv[3::2]))
        self.assertEqual(args['--artifact-root'], str(self.root.resolve()))
        self.assertEqual(args['--artifact-map-sha256'], self.receipt['artifactMap']['sha256'])
        self.assertEqual(args['--candidate-sha'], self.sha)
        self.assertEqual(args['--candidate-tree'], self.tree)
        self.assertEqual(kwargs['timeout'], 60)

    def test_complete_canonical_zero_admission_passes_real_validator_without_git(self):
        with tempfile.TemporaryDirectory(prefix='canonical-rust-') as tmp:
            fixture = canonical_fixture(tmp)
            self.assertEqual(fixture['admittedCount'], 0)
            self.assertFalse((Path(tmp) / '.git').exists())
            self.assertTrue(verified_performance(fixture['reference'], 'R1', fixture['artifact'],
                                                fixture['sha'], repo_root=tmp))

    def test_validator_rejection_or_timeout_fails_closed(self):
        self.assertFalse(self.check(lambda *_a, **_k: SimpleNamespace(returncode=1)))
        def timed_out(*args, **kwargs):
            raise subprocess.TimeoutExpired('fixture', 60)
        self.assertFalse(self.check(timed_out))
        # Deliberately incomplete fixture files cannot pass the actual pinned
        # validator merely by claiming the scored schema and a zero count.
        self.assertFalse(self.check())

    def test_unavailable_measurements_do_not_count_as_valid_zero_admission(self):
        calls = []
        for change in ({'observed': None}, {'sampleCount': 0}):
            scored = self.scored()
            scored['items'][0].update(change)
            self.receipt['scored'] = self.write('scored.json', scored)
            self.assertFalse(self.check(lambda *_a, **_k: calls.append(True) or SimpleNamespace(returncode=0)))
        self.assertEqual(calls, [])

    def test_changed_bytes_frozen_commit_health_or_alias_fail_before_validator(self):
        calls = []
        runner = lambda *_a, **_k: calls.append(True) or SimpleNamespace(returncode=0)
        (self.root / self.receipt['raw']['path']).write_text('{}')
        self.assertFalse(self.check(runner))
        self.receipt['raw'] = self.write('raw.json', self.raw)
        self.receipt['frozenTree']['endClean'] = False
        self.assertFalse(self.check(runner))
        self.receipt['frozenTree']['endClean'] = True
        self.receipt['scored'] = self.write('scored.json', {'schemaVersion': 'performance-backlog-scored.v2', 'releaseBlocked': True})
        self.assertFalse(self.check(runner))
        self.receipt['scored'] = self.write('scored.json', self.scored())
        self.receipt['artifactMap'] = self.write('map.json', {**self.map, 'candidate': {'sha': self.sha, 'tree': 'a' * 40}})
        self.assertFalse(self.check(runner))
        self.receipt['artifactMap'] = self.write('map.json', self.map)
        real = self.root / self.receipt['raw']['path']
        replacement = real.with_suffix('.target')
        real.rename(replacement)
        real.symlink_to(replacement)
        self.assertFalse(self.check(runner))
        self.assertEqual(calls, [])

    def test_commit_object_works_without_git_and_rejects_a_forged_tree(self):
        with patch.object(subprocess, 'run', side_effect=AssertionError('no Git invocation')):
            self.assertTrue(self.check(lambda *_a, **_k: SimpleNamespace(returncode=0)))
        commit = json.loads((self.root / self.receipt['candidateCommitObject']['path']).read_text())
        commit['contentBase64'] = base64.b64encode(b'tree ' + b'f' * 40 + b'\n').decode()
        self.receipt['candidateCommitObject'] = self.write('commit.json', commit)
        self.assertFalse(self.check(lambda *_a, **_k: SimpleNamespace(returncode=0)))

    def test_python_wrong_slice_artifact_and_observation_substitution_are_rejected(self):
        key = next(iter(BACKEND_METRIC_BUDGETS))
        original = self.captures[key]
        for change in ({'implementation': 'python'}, {'sliceId': 'R2'},
                       {'rustArtifactId': 'other@sha256:' + 'b' * 64},
                       {'compiledArtifactSha256': 'b' * 64}, {'observations': []}):
            capture = self.write(key + '-capture.json', {**original, **change})
            self.receipt['runtimeCaptures'][key] = capture
            measurement = deepcopy(self.measurements[key])
            measurement['attestations'][0]['sourceSha256'] = capture['sha256']
            ref = self.write(key + '-measurement.json', measurement)
            self.map['artifacts'][ref['path']] = ref['sha256']
            self.raw['items'][0]['measurement'] = ref
            self.receipt['artifactMap'] = self.write('map.json', self.map)
            self.receipt['raw'] = self.write('raw.json', self.raw)
            self.assertFalse(self.check(lambda *_a, **_k: SimpleNamespace(returncode=0)), change)

    def test_unrelated_canonical_run_cannot_be_relabelled_by_outer_receipt(self):
        key = next(iter(BACKEND_METRIC_BUDGETS))
        self.receipt['runtimeCaptures'][key] = self.write('unrelated.json', self.captures[key] | {'key': 'unrelated'})
        self.assertFalse(self.check(lambda *_a, **_k: SimpleNamespace(returncode=0)))

    def test_immutable_verdict_is_cached_once_and_new_bindings_revalidate(self):
        reference = self.write('receipt.json', self.receipt)
        def invoke(artifact=self.artifact, ref=reference):
            return verified_performance(ref, 'R1', artifact, self.sha, repo_root=self.root)
        with patch.object(admission, '_verify_performance', return_value=True) as validator:
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertTrue(all(pool.map(lambda _: invoke(), range(32))))
            self.assertEqual(validator.call_count, 1)
            self.assertTrue(invoke('other@sha256:' + 'b' * 64))
            self.assertTrue(invoke(ref={**reference, 'sha256': 'c' * 64}))
            self.assertEqual(validator.call_count, 3)
        with patch.object(admission, '_verify_performance', return_value=False) as validator:
            self.assertFalse(invoke('missing'))
            self.assertFalse(invoke('missing'))
            self.assertEqual(validator.call_count, 2)


if __name__ == '__main__':
    unittest.main()
