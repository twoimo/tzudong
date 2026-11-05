import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('pending_source_under_test', HERE / 'hosted_pending_source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
REV = 'a' * 40


class RuntimeSourceTests(unittest.TestCase):
    def setUp(self):
        # Exercise the Mac archive adapter on every test host. Replace only this
        # module's platform view; changing global sys.platform affects imports.
        self.platform_patch = patch.object(source, 'sys', SimpleNamespace(platform='darwin'))
        self.platform_patch.start()
        self.addCleanup(self.platform_patch.stop)
        # Keep fixture parents owner-only; system /tmp is intentionally rejected.
        self.temp = tempfile.TemporaryDirectory(prefix='source-fixture-', dir=HERE.parents[3])
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.runtime = self.home / source.RUNTIME_RELATIVE
        self.root = self.runtime / 'checkouts' / ('source-' + REV[:12])
        self.root.mkdir(parents=True)
        files = {'backend/package-lock.json': b'{}\n',
                 'backend/restaurant-crawling/scripts/requirements.txt': b'fixture==1\n',
                 'backend/bin/worker.py': b'print("public source fixture")\n'}
        for relative, data in files.items():
            p = self.root / relative
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            p.chmod(0o644)
        (self.root / 'backend/bin/alias.py').symlink_to('worker.py')
        python = self.runtime / 'python-fixture'
        python.mkdir()
        deps = self.runtime / 'checkouts/prepared-fixture/backend/node_modules'
        deps.mkdir(parents=True)
        (deps.parent / 'package-lock.json').write_bytes(files['backend/package-lock.json'])
        credentials = self.home / 'Documents/projects/tzudong/backend/.env'
        credentials.parent.mkdir(parents=True)
        credentials.write_bytes(b'not-read-by-adapter\n')
        credentials.chmod(0o600)
        (self.root / '.venv').symlink_to(python, target_is_directory=True)
        (self.root / 'backend/node_modules').symlink_to(deps, target_is_directory=True)
        (self.root / 'backend/.env').symlink_to(credentials)
        hashes = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
        entries = {name: ('100644', hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).digest()) for name, data in files.items()}
        link = b'worker.py'
        entries['backend/bin/alias.py'] = ('120000', hashlib.sha1(b'blob ' + str(len(link)).encode() + b'\0' + link).digest())
        self.manifest = dict(python=str(python), pythonRequirementsSha256=hashes['backend/restaurant-crawling/scripts/requirements.txt'],
                             preparedAt='2026-10-25T00:00:00+00:00', source=str(self.root), sourceCommit=REV,
                             sourceTree=source._tree(entries), trackedFilesVerified=len(files), sourceHashes=hashes,
                             sourceSymlinks={'backend/bin/alias.py': 'worker.py'}, backendLockSha256=hashes['backend/package-lock.json'],
                             active=True, credentialsTargetPreserved=True, publicCachedDataPreserved=True,
                             dotenv='18.0.8', activationReceipt='mac-crawler-activation-' + REV[:12] + '.json')
        self.manifest_path = self.home / source.MANIFEST_RELATIVE
        self.manifest_path.parent.mkdir(parents=True)
        self.save()
        self.home_patch = patch.object(source, '_native_home', return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest))
        self.manifest_path.chmod(0o600)

    def reject(self):
        with self.assertRaisesRegex(source.SourceAttestationError, '^pending_source_invalid$'):
            source.observe_source_revision(self.root)

    def test_normal_archive_verifies_all_source_and_never_reads_credentials(self):
        original = source.os.open
        def guarded(path, *args, **kwargs):
            self.assertNotEqual(Path(path).name, '.env')
            return original(path, *args, **kwargs)
        with patch.object(source.os, 'open', side_effect=guarded):
            self.assertEqual(source.observe_source_revision(self.root), REV)

    def test_linux_host_cannot_admit_a_mac_archive_manifest(self):
        with patch.object(source.sys, 'platform', 'linux'):
            self.reject()

    def test_environment_revision_and_manifest_overrides_are_not_authority(self):
        with patch.dict(os.environ, {'SOURCE_REVISION': 'b' * 40, 'TZUDONG_PIPELINE_SOURCE_SHA': 'b' * 40,
                                   'PENDING_SOURCE_MANIFEST': '/nonexistent'}):
            self.assertEqual(source.observe_source_revision(self.root), REV)
        self.manifest_path.unlink()
        self.reject()

    def test_dirty_git_never_falls_back_to_manifest(self):
        (self.root / '.git').mkdir()
        with patch.object(source, '_git_revision', side_effect=source.SourceAttestationError()), patch.object(source, '_runtime_revision') as fallback:
            self.reject()
            fallback.assert_not_called()

    def test_broken_git_command_is_fixed_failure_without_manifest_fallback(self):
        (self.root / '.git').write_text('invalid')
        with patch.object(source.subprocess, 'run', side_effect=subprocess.CalledProcessError(128, ['git'])), patch.object(source, '_runtime_revision') as fallback:
            self.reject()
            fallback.assert_not_called()

    def test_git_status_drift_rejects_and_git_environment_is_removed(self):
        outputs = [REV.encode(), str(self.root).encode(), b' M backend/bin/worker.py\n']
        def run(command, **kwargs):
            self.assertNotIn('GIT_DIR', kwargs['env'])
            return subprocess.CompletedProcess(command, 0, stdout=outputs.pop(0))
        (self.root / '.git').mkdir()
        with patch.dict(os.environ, {'GIT_DIR': '/untrusted'}), patch.object(source.subprocess, 'run', side_effect=run):
            self.reject()

    def test_source_hash_drift_rejects_even_with_same_size_and_restored_mtime(self):
        p = self.root / 'backend/bin/worker.py'; info = p.stat()
        p.write_bytes(p.read_bytes().replace(b'public', b'PUBLIC'))
        os.utime(p, ns=(info.st_atime_ns, info.st_mtime_ns))
        self.reject()

    def test_missing_source_file_rejects(self):
        (self.root / 'backend/bin/worker.py').unlink()
        self.reject()

    def test_untracked_importable_source_rejects(self):
        (self.root / 'backend/bin/extra.py').write_text('pass\n')
        self.reject()

    def test_omitting_file_from_manifest_does_not_hide_it(self):
        self.manifest['sourceHashes'].pop('backend/bin/worker.py')
        self.manifest['trackedFilesVerified'] -= 1
        self.save(); self.reject()

    def test_wrong_tree_and_executable_mode_drift_reject(self):
        original = self.manifest['sourceTree']
        self.manifest['sourceTree'] = 'b' * 40
        self.save(); self.reject()
        self.manifest['sourceTree'] = original
        (self.root / 'backend/bin/worker.py').chmod(0o755)
        self.save(); self.reject()

    def test_manifest_wrong_root_revision_or_inactive_reject(self):
        for key, value in [('source', str(self.root.parent)), ('sourceCommit', 'b' * 40), ('active', False), ('trackedFilesVerified', True)]:
            with self.subTest(key=key):
                original = self.manifest[key]; self.manifest[key] = value
                self.save(); self.reject(); self.manifest[key] = original

    def test_duplicate_manifest_key_and_path_traversal_reject(self):
        self.manifest_path.write_text(self.manifest_path.read_text()[:-1] + ',"active":true}')
        self.reject()
        self.manifest['sourceHashes']['../outside'] = '0' * 64
        self.manifest['trackedFilesVerified'] += 1
        self.save(); self.reject()

    def test_manifest_hardlink_symlink_and_permissions_reject(self):
        other = self.home / 'manifest-copy'
        os.link(self.manifest_path, other); self.reject(); other.unlink()
        self.manifest_path.chmod(0o644); self.reject(); self.manifest_path.chmod(0o600)
        self.manifest_path.rename(other); self.manifest_path.symlink_to(other); self.reject()

    def test_source_hardlink_symlink_and_write_permissions_reject(self):
        path = self.root / 'backend/bin/worker.py'; other = self.home / 'worker-copy'
        os.link(path, other); self.reject(); other.unlink()
        path.chmod(0o666); self.reject(); path.chmod(0o644)
        path.rename(other); path.symlink_to(other); self.reject()

    def test_recorded_source_symlink_target_drift_and_escape_reject(self):
        link = self.root / 'backend/bin/alias.py'; link.unlink(); link.symlink_to('../../package-lock.json')
        self.reject()
        link.unlink(); link.symlink_to(self.manifest_path)
        self.manifest['sourceSymlinks']['backend/bin/alias.py'] = str(self.manifest_path)
        self.save(); self.reject()

    def test_source_parent_symlink_rejects(self):
        p = self.root / 'backend/bin'; target = self.home / 'bin'
        p.rename(target); p.symlink_to(target, target_is_directory=True)
        self.reject()

    def test_dependency_lock_or_mount_routing_drift_reject(self):
        deps = (self.root / 'backend/node_modules').resolve()
        (deps.parent / 'package-lock.json').write_text('changed')
        self.reject()
        (deps.parent / 'package-lock.json').write_text('{}\n')
        link = self.root / '.venv'; link.unlink(); link.symlink_to(self.home, target_is_directory=True)
        self.reject()

    def test_manifest_and_file_size_bounds_reject(self):
        with patch.object(source, 'MAX_MANIFEST', 8): self.reject()
        with patch.object(source, 'MAX_FILE', 1): self.reject()
        with patch.object(source, 'MAX_SOURCE', 1): self.reject()

    def test_concurrent_source_change_rejects(self):
        original = source._hash_source
        changed = False
        def racing(path, info):
            nonlocal changed
            value = original(path, info)
            if not changed:
                changed = True
                (self.root / 'backend/bin/worker.py').write_text('changed during observation\n')
            return value
        with patch.object(source, '_hash_source', side_effect=racing): self.reject()

    def test_concurrent_manifest_change_rejects(self):
        original = source._hash_source
        def racing(path, info):
            value = original(path, info)
            self.manifest_path.write_text(self.manifest_path.read_text() + '\n')
            return value
        with patch.object(source, '_hash_source', side_effect=racing): self.reject()

    def test_mutable_data_does_not_masquerade_as_source(self):
        data = self.root / 'backend/restaurant-crawling/data/tzuyang'
        data.mkdir(parents=True)
        (data / 'fixture.json').write_text('{}')
        self.assertEqual(source.observe_source_revision(self.root), REV)
        self.manifest['sourceHashes']['backend/restaurant-crawling/data/tzuyang/fixture.json'] = hashlib.sha256(b'{}').hexdigest()
        self.manifest['trackedFilesVerified'] += 1
        self.save(); self.reject()

    def caller(self):
        old_paths = list(sys.path)
        sys.path[:0] = [str(HERE.parents[2]), str(HERE.parents[4] / 'candidate')]
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), old_paths))
        loader = importlib.util.spec_from_file_location('pending_integrated_caller', HERE / 'hosted_pending_operation.py')
        module = importlib.util.module_from_spec(loader)
        sys.modules[loader.name] = module
        self.addCleanup(lambda: sys.modules.pop(loader.name, None))
        loader.loader.exec_module(module)
        return module

    def test_integrated_caller_uses_actual_archive_adapter(self):
        caller = self.caller()
        with patch.dict(sys.modules, {'backend.supabase.scripts.hosted_pending_source': source}), patch.object(caller, 'rpc_transport') as transport:
            self.assertEqual(caller.current_source_revision(self.root), REV)
            transport.assert_not_called()

    def test_integrated_caller_rejects_source_change_with_fixed_error(self):
        caller = self.caller()
        (self.root / 'backend/bin/worker.py').write_text('changed')
        with patch.dict(sys.modules, {'backend.supabase.scripts.hosted_pending_source': source}), patch.object(caller, 'rpc_transport') as transport:
            with self.assertRaisesRegex(caller.HostedDataPlaneError, '^pending_source_invalid$'):
                caller.current_source_revision(self.root)
            transport.assert_not_called()

    def test_other_owner_is_rejected(self):
        with patch.object(source.os, 'getuid', return_value=os.getuid() + 1): self.reject()

    def test_native_home_and_uid_are_not_environment_attestation(self):
        self.home_patch.stop()
        with patch.dict(os.environ, {'HOME': str(self.home)}): self.reject()
        with patch.object(source.os, 'geteuid', return_value=os.getuid() + 1): self.reject()


if __name__ == '__main__':
    unittest.main()
