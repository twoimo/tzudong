"""Performance admission adapter tests; fixture verdicts are not measurements.

The canonical validator's complete scoring/zero-admission corpus lives in the
web governance suite. Here we verify file/hash/commit binding, mandatory command
execution and failure propagation, including rejection by the real validator.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

from backend.pipeline_control.rust_performance_admission import verified_performance, VALIDATOR
from backend.pipeline_control.performance_evidence import BACKEND_METRIC_BUDGETS


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
            'frozenAsOf': '2026-09-05T00:00:00.000000Z'}
        self.receipt = {'kind': 'rust_performance_admission_v1', 'sliceId': 'R1',
            'rustArtifactId': self.artifact, 'frozenTree': {'startCommit': self.sha,
            'endCommit': self.sha, 'startClean': True, 'endClean': True},
            'artifactMap': self.write('map.json', self.map),
            'raw': self.write('raw.json', {'schemaVersion': 'performance-backlog-raw.v2'}),
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
        self.receipt['raw'] = self.write('raw.json', {'schemaVersion': 'performance-backlog-raw.v2'})
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


if __name__ == '__main__':
    unittest.main()
