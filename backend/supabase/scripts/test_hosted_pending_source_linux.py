"""Synthetic Linux path metadata; this is not a hosted-runner observation.

Exercise the unchanged source adapter at its filesystem/Git boundaries without
creating /home/runner, changing ownership, invoking Git, or reading a manifest.
UID 1001/GID 121 are fixture inputs, not claims about a current GitHub runner.
"""
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('linux_source_adapter', HERE / 'hosted_pending_source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

ROOT = Path('/home/runner/work/tzudong/tzudong')
REVISION = 'a' * 40
RUNNER_UID = 1001


class LinuxGitSourceTests(unittest.TestCase):
    def setUp(self):
        self.nodes = {
            path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o755,
                                  st_uid=0 if str(path) in ('/', '/home') else RUNNER_UID,
                                  st_gid=121, st_nlink=1)
            for path in (*ROOT.parents, ROOT)
        }
        self.head = REVISION
        self.top = str(ROOT)
        self.status = ''
        self.git_error = None
        self.has_git = True
        self.calls = []
        self.stats = []
        self.runtime_route = source._runtime_revision
        self.fallback = patch.object(source, '_runtime_revision', side_effect=AssertionError('unexpected Mac fallback')).start()
        self.addCleanup(patch.stopall)
        patch.object(source.sys, 'platform', 'linux').start()
        patch.object(source.os, 'getuid', return_value=RUNNER_UID).start()
        patch.object(source.os, 'geteuid', return_value=RUNNER_UID).start()
        patch.object(source.Path, 'lstat', lambda path: self.lstat(path)).start()
        patch.object(source.os.path, 'lexists', side_effect=lambda path: self.has_git and Path(path) == ROOT / '.git').start()
        patch.object(source.subprocess, 'run', side_effect=self.git).start()

    def lstat(self, path):
        self.stats.append(path)
        if path not in self.nodes:
            raise AssertionError('unexpected path observation')
        info = self.nodes[path]
        if isinstance(info, Exception):
            raise info
        return info

    def git(self, command, **kwargs):
        self.calls.append(command)
        self.assertEqual(command[:5], ['git', '-c', 'core.fsmonitor=false', '-C', str(ROOT)])
        self.assertEqual(kwargs['timeout'], 10)
        self.assertTrue(kwargs['capture_output'])
        self.assertTrue(kwargs['check'])
        self.assertEqual({k: v for k, v in kwargs['env'].items() if k.startswith('GIT_')}, {
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
            'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0',
        })
        if self.git_error:
            raise self.git_error
        args = tuple(command[5:])
        outputs = {('rev-parse', 'HEAD'): self.head,
                   ('rev-parse', '--show-toplevel'): self.top,
                   ('status', '--porcelain', '--untracked-files=normal'): self.status}
        self.assertIn(args, outputs)
        return subprocess.CompletedProcess(command, 0, stdout=(outputs[args] + '\n').encode())

    def reject(self, *, before_git=False):
        self.calls.clear()
        with self.assertRaisesRegex(source.SourceAttestationError, '^pending_source_invalid$'):
            source.observe_source_revision(ROOT)
        self.fallback.assert_not_called()
        if before_git:
            self.assertEqual(self.calls, [])

    def test_clean_standard_layout_uses_git_not_environment_revision(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_WORKSPACE': str(ROOT),
                                     'GITHUB_SHA': 'b' * 40, 'SOURCE_REVISION': 'b' * 40,
                                     'GIT_DIR': '/injected', 'GIT_CONFIG_PARAMETERS': 'unsafe'}):
            self.assertEqual(source.observe_source_revision(ROOT), REVISION)
        self.assertEqual(self.stats, list(reversed(ROOT.parents)) + [ROOT])
        self.assertEqual(len(self.calls), 3)
        self.fallback.assert_not_called()

    def test_root_owned_or_runner_owned_readonly_ancestors_are_compatible(self):
        for path in ROOT.parents:
            with self.subTest(path=str(path)):
                old = self.nodes[path].st_uid
                self.nodes[path].st_uid = 0
                self.assertEqual(source.observe_source_revision(ROOT), REVISION)
                self.nodes[path].st_uid = old

    def test_group_writable_ancestor_is_an_explicit_rejection_not_a_git_failure(self):
        for path in ROOT.parents:
            with self.subTest(path=str(path)):
                self.nodes[path].st_mode = stat.S_IFDIR | 0o775
                self.reject(before_git=True)
                self.nodes[path].st_mode = stat.S_IFDIR | 0o755

    def test_world_writable_and_sticky_ancestors_remain_rejected(self):
        for mode in (0o777, 0o1777):
            with self.subTest(mode=oct(mode)):
                self.nodes[Path('/home/runner/work')].st_mode = stat.S_IFDIR | mode
                self.reject(before_git=True)

    def test_foreign_owner_at_each_ancestor_is_rejected(self):
        for path in ROOT.parents:
            with self.subTest(path=str(path)):
                old = self.nodes[path].st_uid
                self.nodes[path].st_uid = 2002
                self.reject(before_git=True)
                self.nodes[path].st_uid = old

    def test_symlink_at_each_ancestor_is_rejected(self):
        for path in ROOT.parents:
            with self.subTest(path=str(path)):
                self.nodes[path].st_mode = stat.S_IFLNK | 0o777
                self.reject(before_git=True)
                self.nodes[path].st_mode = stat.S_IFDIR | 0o755

    def test_checkout_root_requires_owner_directory_and_no_group_write(self):
        for mode, owner in ((stat.S_IFDIR | 0o755, 0),
                            (stat.S_IFDIR | 0o775, RUNNER_UID),
                            (stat.S_IFLNK | 0o777, RUNNER_UID),
                            (stat.S_IFREG | 0o644, RUNNER_UID)):
            with self.subTest(mode=oct(mode), owner=owner):
                self.nodes[ROOT].st_mode, self.nodes[ROOT].st_uid = mode, owner
                self.reject(before_git=True)

    def test_dirty_tracked_and_untracked_sources_never_fall_back(self):
        for status in (' M backend/bin/worker.py', '?? backend/bin/shadow.py', 'A  new-source.py'):
            with self.subTest(status=status):
                self.status = status
                self.reject()

    def test_nested_checkout_is_rejected(self):
        self.top = str(ROOT.parent)
        self.reject()

    def test_malformed_revision_and_git_timeout_are_fixed_failures(self):
        for value in ('', 'main', 'A' * 40, 'a' * 39, REVISION + '\n' + REVISION):
            with self.subTest(value=value):
                self.head = value
                self.reject()
        self.head = REVISION
        self.git_error = subprocess.TimeoutExpired('git', 10)
        self.reject()

    def test_metadata_permission_denial_is_not_bypassed(self):
        self.nodes[Path('/home/runner/work')] = PermissionError('synthetic fixed fixture')
        self.reject(before_git=True)

    def test_manifest_route_does_not_gain_a_linux_environment_override(self):
        # Exercise the real platform guard, before any native HOME/manifest read.
        with self.assertRaisesRegex(source.SourceAttestationError, '^pending_source_invalid$'):
            self.runtime_route(ROOT)


if __name__ == '__main__':
    unittest.main()
