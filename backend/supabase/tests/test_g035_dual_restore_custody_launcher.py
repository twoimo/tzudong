from __future__ import annotations

import argparse
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/g035_dual_restore_custody_launcher.py"
PRODUCER = ROOT / "backend/supabase/scripts/run_g035_dual_restore_rehearsal.py"
RUNBOOK = ROOT / "backend/supabase/docs/g035-hosted-recovery-runbook.md"
SPEC = importlib.util.spec_from_file_location("g035_dual_restore_custody_launcher", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)
COMMIT = "a" * 40


def write_owned(path: Path, value: bytes) -> None:
    path.write_bytes(value)
    path.chmod(0o600)


class CustodyFixture:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name).resolve(strict=True)
        self.base.chmod(0o700)
        self.repository = self.base / "repository"
        self.repository.mkdir(mode=0o700)
        self.custody = self.base / "custody"
        self.custody.mkdir(mode=0o700)
        self.identity = self.custody / "age-identity.txt"
        self.identity_bytes = bytearray(b"AGE-SECRET-KEY-TEST-ONLY\n")
        write_owned(self.identity, bytes(self.identity_bytes))
        self.config = self.custody / "custody.json"
        self.write_config({"identityPath": os.fspath(self.identity)})

    def write_config(self, value: object, *, canonical: bool = True) -> None:
        if canonical:
            raw = json.dumps(
                value,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
                allow_nan=False,
            ).encode("ascii") + b"\n"
        else:
            raw = json.dumps(value, indent=2).encode("ascii") + b"\n"
        write_owned(self.config, raw)

    def close(self) -> None:
        self.temporary.cleanup()


def producer_args(config: Path, repository: Path) -> argparse.Namespace:
    return argparse.Namespace(
        repository_root=repository,
        authorized_final_commit=COMMIT,
        custody_config=config,
        capture_receipt=Path("/external/capture.json"),
        archive=Path("/external/archive.age"),
        destination=Path("/external/dual-restore"),
        python="/pinned/python",
        docker="/pinned/docker",
        age="/pinned/age",
        pg_restore="/pinned/pg_restore",
    )


class IdentityCustodyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = CustodyFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_exact_external_config_opens_identity_as_mutable_bytes(self) -> None:
        real_open = os.open
        with patch.object(launcher.os, "open", wraps=real_open) as opened:
            value = launcher._load_identity(self.fixture.config, self.fixture.repository)
        self.assertIs(type(value), bytearray)
        self.assertEqual(self.fixture.identity_bytes, value)
        self.assertEqual(2, opened.call_count)
        self.assertTrue(all(call.args[1] & getattr(os, "O_NOFOLLOW", 0) for call in opened.call_args_list))
        self.assertTrue(all(call.args[1] & getattr(os, "O_CLOEXEC", 0) for call in opened.call_args_list))
        launcher._zero(value)
        self.assertEqual(bytearray(len(value)), value)

    def test_config_rejects_noncanonical_duplicate_extra_and_relative_identity(self) -> None:
        cases = (
            b'{"identityPath":"/one","identityPath":"/two"}\n',
            json.dumps({"identityPath": os.fspath(self.fixture.identity), "extra": True}).encode() + b"\n",
            json.dumps({"identityPath": "relative/key"}).encode() + b"\n",
            json.dumps({"identityPath": os.fspath(self.fixture.identity)}, indent=2).encode() + b"\n",
            json.dumps({"identityPath": os.fspath(self.fixture.identity)}).encode(),
        )
        for raw in cases:
            with self.subTest(raw=raw[:30]):
                write_owned(self.fixture.config, raw)
                with self.assertRaisesRegex(launcher.CustodyError, "custody_config_invalid|identity_invalid"):
                    launcher._load_identity(self.fixture.config, self.fixture.repository)

    def test_config_must_be_external_regular_owner_only_single_link(self) -> None:
        inside = self.fixture.repository / "custody.json"
        write_owned(inside, self.fixture.config.read_bytes())
        cases: list[tuple[str, Path]] = [("inside", inside)]
        symlink = self.fixture.custody / "config-link"
        symlink.symlink_to(self.fixture.config)
        cases.append(("symlink", symlink))
        for label, path in cases:
            with self.subTest(label=label), self.assertRaises(launcher.CustodyError):
                launcher._load_identity(path, self.fixture.repository)
        self.fixture.config.chmod(0o640)
        with self.assertRaisesRegex(launcher.CustodyError, "custody_config_invalid"):
            launcher._load_identity(self.fixture.config, self.fixture.repository)
        self.fixture.config.chmod(0o600)
        hardlink = self.fixture.custody / "config-hardlink"
        os.link(self.fixture.config, hardlink)
        with self.assertRaisesRegex(launcher.CustodyError, "custody_config_invalid"):
            launcher._load_identity(self.fixture.config, self.fixture.repository)

    def test_parent_directory_must_be_canonical_owner_only(self) -> None:
        self.fixture.custody.chmod(0o750)
        with self.assertRaisesRegex(launcher.CustodyError, "custody_config_parent_invalid"):
            launcher._load_identity(self.fixture.config, self.fixture.repository)

    def test_identity_rejects_symlink_mode_hardlink_empty_oversize_and_wrong_format(self) -> None:
        separate = self.fixture.base / "separate"
        separate.mkdir(mode=0o700)
        identity = separate / "identity"
        cases = (
            ("empty", b"", 0o600),
            ("wrong", b"not-an-age-identity\n", 0o600),
            ("nul", b"AGE-SECRET-KEY-TEST\x00\n", 0o600),
            ("mode", b"AGE-SECRET-KEY-TEST\n", 0o640),
            ("oversize", b"AGE-SECRET-KEY-" + b"x" * launcher.MAX_IDENTITY_BYTES, 0o600),
        )
        for label, raw, mode in cases:
            with self.subTest(label=label):
                identity.write_bytes(raw)
                identity.chmod(mode)
                self.fixture.write_config({"identityPath": os.fspath(identity)})
                with self.assertRaises(launcher.CustodyError):
                    launcher._load_identity(self.fixture.config, self.fixture.repository)
        identity.write_bytes(b"AGE-SECRET-KEY-TEST\n")
        identity.chmod(0o600)
        hardlink = separate / "identity-hardlink"
        os.link(identity, hardlink)
        self.fixture.write_config({"identityPath": os.fspath(identity)})
        with self.assertRaisesRegex(launcher.CustodyError, "identity_invalid"):
            launcher._load_identity(self.fixture.config, self.fixture.repository)
        identity.unlink()
        hardlink.unlink()
        identity.symlink_to(self.fixture.identity)
        self.fixture.write_config({"identityPath": os.fspath(identity)})
        with self.assertRaisesRegex(launcher.CustodyError, "identity_invalid"):
            launcher._load_identity(self.fixture.config, self.fixture.repository)

    def test_inode_metadata_change_during_read_is_rejected_and_buffer_zeroed(self) -> None:
        real_fstat = os.fstat
        calls = 0

        def changed(fd: int) -> os.stat_result:
            nonlocal calls
            calls += 1
            info = real_fstat(fd)
            if calls == 2:
                fields = list(info)
                fields[6] += 1
                return os.stat_result(fields)
            return info

        with patch.object(launcher.os, "fstat", side_effect=changed):
            with self.assertRaisesRegex(launcher.CustodyError, "custody_config_changed"):
                launcher._load_identity(self.fixture.config, self.fixture.repository)


class SourceBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.root.chmod(0o700)
        self.launcher_bytes = b"committed launcher\n"
        self.producer_bytes = b"committed producer\n"
        for relative, raw in (
            (launcher.LAUNCHER_PATH, self.launcher_bytes),
            (launcher.PRODUCER_PATH, self.producer_bytes),
        ):
            path = self.root.joinpath(*relative.split("/"))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            path.chmod(0o644)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def git_result(self, unused_root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
        if args == ("symbolic-ref", "-q", "HEAD"):
            return subprocess.CompletedProcess([], 1, b"", b"")
        if args == ("rev-parse", "--verify", "HEAD^{commit}"):
            return subprocess.CompletedProcess([], 0, (COMMIT + "\n").encode(), b"")
        if args == ("status", "--porcelain=v1", "-z", "--untracked-files=all"):
            return subprocess.CompletedProcess([], 0, b"", b"")
        if args[:3] == ("ls-tree", "-z", COMMIT):
            relative = args[-1]
            raw = f"100644 blob {'b' * 40}\t{relative}\0".encode()
            return subprocess.CompletedProcess([], 0, raw, b"")
        if args[:2] == ("show", f"{COMMIT}:{launcher.LAUNCHER_PATH}"):
            return subprocess.CompletedProcess([], 0, self.launcher_bytes, b"")
        if args[:2] == ("show", f"{COMMIT}:{launcher.PRODUCER_PATH}"):
            return subprocess.CompletedProcess([], 0, self.producer_bytes, b"")
        raise AssertionError(args)

    def test_clean_detached_exact_blob_and_final_hash_are_required(self) -> None:
        expected = hashlib.sha256(self.producer_bytes).hexdigest()
        with patch.object(launcher, "EXPECTED_PRODUCER_SHA256", expected), patch.object(
            launcher, "_run_git", side_effect=self.git_result
        ):
            self.assertEqual(
                self.producer_bytes,
                launcher._committed_producer(self.root, COMMIT),
            )

    def test_unpinned_or_wrong_producer_hash_fails_closed(self) -> None:
        for expected in (None, "f" * 64):
            with self.subTest(expected=expected), patch.object(
                launcher, "EXPECTED_PRODUCER_SHA256", expected
            ), patch.object(launcher, "_run_git", side_effect=self.git_result):
                with self.assertRaisesRegex(launcher.CustodyError, "producer_hash_invalid"):
                    launcher._committed_producer(self.root, COMMIT)

    def test_attached_dirty_and_local_blob_drift_are_rejected(self) -> None:
        expected = hashlib.sha256(self.producer_bytes).hexdigest()

        def attached(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
            result = self.git_result(root, *args)
            if args == ("symbolic-ref", "-q", "HEAD"):
                return subprocess.CompletedProcess([], 0, b"refs/heads/main\n", b"")
            return result

        def dirty(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
            result = self.git_result(root, *args)
            if args == ("status", "--porcelain=v1", "-z", "--untracked-files=all"):
                return subprocess.CompletedProcess([], 0, b"?? unexpected\0", b"")
            return result

        for label, fake in (("attached", attached), ("dirty", dirty)):
            with self.subTest(label=label), patch.object(
                launcher, "EXPECTED_PRODUCER_SHA256", expected
            ), patch.object(launcher, "_run_git", side_effect=fake):
                with self.assertRaisesRegex(launcher.CustodyError, "source_binding_invalid"):
                    launcher._committed_producer(self.root, COMMIT)
        local = self.root.joinpath(*launcher.PRODUCER_PATH.split("/"))
        local.write_bytes(b"changed checkout bytes\n")
        with patch.object(launcher, "EXPECTED_PRODUCER_SHA256", expected), patch.object(
            launcher, "_run_git", side_effect=self.git_result
        ):
            with self.assertRaisesRegex(launcher.CustodyError, "source_binding_invalid"):
                launcher._committed_producer(self.root, COMMIT)


class PinnedPythonTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.root.chmod(0o700)
        self.python = self.root / "python"
        self.raw = b"#!/bin/sh\nprintf 'Python 3.14.6\\n'\n"
        self.python.write_bytes(self.raw)
        self.python.chmod(0o755)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def expected(self, *, digest: str | None = None, version: bytes | None = None) -> contextlib.ExitStack:
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(launcher, "PINNED_PYTHON_PATH", os.fspath(self.python)))
        stack.enter_context(patch.object(launcher, "PINNED_PYTHON_BYTES", len(self.raw)))
        stack.enter_context(patch.object(launcher, "PINNED_PYTHON_UID", os.getuid()))
        stack.enter_context(patch.object(launcher, "PINNED_PYTHON_MODE", 0o755))
        stack.enter_context(patch.object(
            launcher,
            "PINNED_PYTHON_SHA256",
            digest if digest is not None else hashlib.sha256(self.raw).hexdigest(),
        ))
        stack.enter_context(patch.object(
            launcher,
            "PINNED_PYTHON_VERSION",
            version if version is not None else b"Python 3.14.6\n",
        ))
        return stack

    def test_exact_path_bytes_owner_mode_hash_and_version_bind_then_recheck(self) -> None:
        with self.expected():
            binding = launcher._pinned_python(os.fspath(self.python))
            self.assertEqual(os.fspath(self.python), launcher._recheck_pinned_python(binding))

    def test_wrong_path_hash_version_mode_and_symlink_fail_before_binding(self) -> None:
        with self.expected(), self.assertRaisesRegex(launcher.CustodyError, "python_identity_invalid"):
            launcher._pinned_python(os.fspath(self.python) + "-other")
        with self.expected(digest="0" * 64), self.assertRaises(launcher.CustodyError):
            launcher._pinned_python(os.fspath(self.python))
        with self.expected(version=b"Python 0.0.0\n"), self.assertRaisesRegex(
            launcher.CustodyError,
            "python_identity_invalid",
        ):
            launcher._pinned_python(os.fspath(self.python))
        self.python.chmod(0o700)
        with self.expected(), self.assertRaisesRegex(launcher.CustodyError, "python_identity_invalid"):
            launcher._pinned_python(os.fspath(self.python))
        self.python.chmod(0o755)
        link = self.root / "python-link"
        link.symlink_to(self.python)
        with self.expected() as stack:
            stack.enter_context(patch.object(launcher, "PINNED_PYTHON_PATH", os.fspath(link)))
            with self.assertRaisesRegex(launcher.CustodyError, "python_identity_invalid"):
                launcher._pinned_python(os.fspath(link))

    def test_recheck_rejects_post_binding_inode_or_byte_change(self) -> None:
        with self.expected():
            binding = launcher._pinned_python(os.fspath(self.python))
            changed = self.raw.replace(b"3.14.6", b"3.14.7")
            self.assertEqual(len(self.raw), len(changed))
            self.python.write_bytes(changed)
            self.python.chmod(0o755)
            with self.assertRaises(launcher.CustodyError):
                launcher._recheck_pinned_python(binding)


class OutOfBandCleanupTests(unittest.TestCase):
    def setUp(self) -> None:
        self.nonce = "f" * 32
        self.container_id = "a" * 64
        self.source_id = "c" * 64
        self.network_id = "b" * 64
        self.container = f"tzudong-g035-{self.nonce[:20]}-1-db"
        self.source = f"tzudong-g035-{self.nonce[:20]}-1-source"
        self.network = f"tzudong-g035-{self.nonce[:20]}-1-net"
        self.labels = {
            launcher.OWNERSHIP_LABEL: self.nonce,
            launcher.SLOT_LABEL: "1",
        }

    @staticmethod
    def completed(stdout: bytes = b"", returncode: int = 0) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess([], returncode, stdout, b"")

    def exact_responses(self, *argv: object) -> subprocess.CompletedProcess[bytes]:
        command = argv[2:]
        if command[:2] == ("container", "ls") and "label=" in " ".join(command):
            count = getattr(self, "container_inventory_count", 0)
            self.container_inventory_count = count + 1
            return self.completed(
                (
                    f"{self.container_id}\t{self.container}\n"
                    f"{self.source_id}\t{self.source}\n"
                ).encode() if count == 0 else b""
            )
        if command == ("container", "inspect", self.container_id):
            return self.completed(json.dumps([{
                "Id": self.container_id,
                "Name": f"/{self.container}",
                "Image": launcher.IMAGE_ID,
                "Config": {"Image": launcher.IMAGE_REFERENCE, "Labels": self.labels},
                "HostConfig": {"NetworkMode": self.network},
            }]).encode())
        if command == ("rm", "-f", self.container_id):
            return self.completed()
        if command == ("container", "inspect", self.source_id):
            source_labels = {
                **self.labels,
                launcher.PURPOSE_LABEL: "postgres-custom-source",
            }
            return self.completed(json.dumps([{
                "Id": self.source_id,
                "Name": f"/{self.source}",
                "Image": launcher.IMAGE_ID,
                "Config": {
                    "Image": launcher.IMAGE_REFERENCE,
                    "Labels": source_labels,
                    "Entrypoint": ["/bin/tar"],
                    "Cmd": ["-C", "/etc/postgresql-custom", "-cf", "-", "."],
                    "Volumes": None,
                },
                "HostConfig": {
                    "NetworkMode": "none",
                    "ReadonlyRootfs": True,
                    "CapDrop": ["ALL"],
                    "CapAdd": None,
                    "SecurityOpt": ["no-new-privileges"],
                    "Privileged": False,
                    "Binds": None,
                    "Mounts": None,
                },
                "Mounts": [],
            }]).encode())
        if command == ("rm", "-f", self.source_id):
            return self.completed()
        if command[:2] == ("network", "ls") and "label=" in " ".join(command):
            count = getattr(self, "network_inventory_count", 0)
            self.network_inventory_count = count + 1
            return self.completed(
                f"{self.network_id}\t{self.network}\n".encode() if count == 0 else b""
            )
        if command == ("network", "inspect", self.network_id):
            return self.completed(json.dumps([{
                "Id": self.network_id,
                "Name": self.network,
                "Driver": "bridge",
                "Internal": True,
                "Attachable": False,
                "Options": {
                    "com.docker.network.bridge.enable_ip_masquerade": "false",
                    "com.docker.network.bridge.enable_icc": "false",
                },
                "Labels": self.labels,
                "Containers": {},
            }]).encode())
        if command == ("network", "rm", self.network_id):
            return self.completed()
        if command == ("container", "ls", "--all", "--no-trunc", "--format", "{{.Names}}"):
            return self.completed(b"unrelated-container\n")
        if command == ("network", "ls", "--no-trunc", "--format", "{{.Name}}"):
            return self.completed(b"bridge\n")
        raise AssertionError(command)

    def test_exact_labeled_resources_are_inspected_removed_by_id_and_proved_absent(self) -> None:
        with patch.object(launcher, "_docker_call", side_effect=self.exact_responses) as docker:
            launcher._last_resort_cleanup("/docker", {}, self.nonce)
        commands = [call.args[2:] for call in docker.call_args_list]
        self.assertIn(("rm", "-f", self.container_id), commands)
        self.assertIn(("rm", "-f", self.source_id), commands)
        self.assertIn(("network", "rm", self.network_id), commands)
        self.assertNotIn(("rm", "-f", self.container), commands)
        self.assertNotIn(("rm", "-f", self.source), commands)
        self.assertNotIn(("network", "rm", self.network), commands)

    def test_identity_mismatch_refuses_destructive_cleanup(self) -> None:
        def mismatch(*argv: object) -> subprocess.CompletedProcess[bytes]:
            command = argv[2:]
            if command[:2] == ("container", "ls"):
                return self.completed(f"{self.container_id}\t{self.container}\n".encode())
            if command == ("container", "inspect", self.container_id):
                return self.completed(json.dumps([{
                    "Id": self.container_id,
                    "Name": f"/{self.container}",
                    "Image": "sha256:" + "0" * 64,
                    "Config": {"Image": launcher.IMAGE_REFERENCE, "Labels": self.labels},
                    "HostConfig": {"NetworkMode": self.network},
                }]).encode())
            raise AssertionError(command)

        with patch.object(launcher, "_docker_call", side_effect=mismatch) as docker:
            with self.assertRaisesRegex(launcher.CustodyError, "docker_cleanup_ownership_invalid"):
                launcher._last_resort_cleanup("/docker", {}, self.nonce)
        self.assertFalse(any(call.args[2:4] == ("rm", "-f") for call in docker.call_args_list))

    def test_all_container_identities_are_validated_before_any_removal(self) -> None:
        def second_mismatch(*argv: object) -> subprocess.CompletedProcess[bytes]:
            command = argv[2:]
            if command == ("container", "inspect", self.source_id):
                return self.completed(json.dumps([{
                    "Id": self.source_id,
                    "Name": f"/{self.source}",
                    "Image": launcher.IMAGE_ID,
                    "Config": {
                        "Image": launcher.IMAGE_REFERENCE,
                        "Labels": {
                            **self.labels,
                            launcher.PURPOSE_LABEL: "wrong-purpose",
                        },
                        "Entrypoint": ["/bin/tar"],
                        "Cmd": ["-C", "/etc/postgresql-custom", "-cf", "-", "."],
                    },
                    "HostConfig": {"NetworkMode": "none"},
                }]).encode())
            return self.exact_responses(*argv)

        with patch.object(launcher, "_docker_call", side_effect=second_mismatch) as docker:
            with self.assertRaisesRegex(
                launcher.CustodyError,
                "docker_cleanup_ownership_invalid",
            ):
                launcher._last_resort_cleanup("/docker", {}, self.nonce)
        self.assertFalse(any(call.args[2:4] == ("rm", "-f") for call in docker.call_args_list))

    def test_exact_name_without_ownership_label_fails_absence_readback(self) -> None:
        def stripped(*argv: object) -> subprocess.CompletedProcess[bytes]:
            command = argv[2:]
            if "label=" in " ".join(command):
                return self.completed()
            if command[:2] == ("container", "ls"):
                return self.completed((self.container + "\n").encode())
            if command[:2] == ("network", "ls"):
                return self.completed(b"bridge\n")
            raise AssertionError(command)

        with patch.object(launcher, "_docker_call", side_effect=stripped):
            with self.assertRaisesRegex(launcher.CustodyError, "docker_cleanup_failed"):
                launcher._last_resort_cleanup("/docker", {}, self.nonce)


class InvocationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve(strict=True)
        self.root.chmod(0o700)
        self.config = self.root / "allowed-config-argv"
        self.args = producer_args(self.config, self.root)
        self.identity = bytearray(b"AGE-SECRET-KEY-NEVER-LEAK\n")
        self.producer = b"print('exact committed producer')\n"
        self.python_binding = launcher._PythonBinding("/pinned/python", (1,) * 9)
        self.python_recheck_patcher = patch.object(
            launcher,
            "_recheck_pinned_python",
            side_effect=lambda binding: binding.path,
        )
        self.python_recheck = self.python_recheck_patcher.start()
        self.cleanup_patcher = patch.object(launcher, "_last_resort_cleanup")
        self.cleanup = self.cleanup_patcher.start()

    def tearDown(self) -> None:
        self.cleanup_patcher.stop()
        self.python_recheck_patcher.stop()
        self.temporary.cleanup()

    def test_child_gets_only_anonymous_identity_fd_and_exact_committed_source(self) -> None:
        observed: dict[str, object] = {}

        class Process:
            pid = 43210
            returncode = 0

            def __init__(self, argv: list[str], **kwargs: object) -> None:
                observed["argv"] = argv
                observed["kwargs"] = kwargs
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                observed["source"] = input
                observed["timeout"] = timeout
                observed["bufferAtCommunicate"] = bytearray(self_identity)
                observed["identity"] = os.read(self.identity_fd, launcher.MAX_IDENTITY_BYTES)
                self.returncode = 0
                os.close(self.identity_fd)
                return None, None

            def poll(self) -> int:
                return self.returncode

        self_identity = self.identity
        with patch.object(launcher.subprocess, "Popen", Process):
            launcher._invoke_producer(
                self.args,
                self.producer,
                self.identity,
                self.python_binding,
                "/pinned/docker",
                {},
                "/pinned/age",
                "/pinned/pg_restore",
                "f" * 32,
            )
        argv = observed["argv"]
        kwargs = observed["kwargs"]
        self.assertEqual(["/pinned/python", "-I", "-B", "-"], argv[:4])
        self.assertEqual(1, argv.count("--identity-fd"))
        self.assertEqual("f" * 32, argv[argv.index("--run-nonce") + 1])
        self.assertEqual(1, len(kwargs["pass_fds"]))
        self.assertIs(True, kwargs["close_fds"])
        self.assertTrue(kwargs["start_new_session"])
        self.assertIs(subprocess.DEVNULL, kwargs["stdout"])
        self.assertIs(subprocess.DEVNULL, kwargs["stderr"])
        self.assertNotIn("shell", kwargs)
        self.assertEqual(self.producer, observed["source"])
        self.python_recheck.assert_called_once_with(self.python_binding)
        self.assertEqual(b"AGE-SECRET-KEY-NEVER-LEAK\n", observed["identity"])
        self.assertEqual(bytearray(len(self.identity)), observed["bufferAtCommunicate"])
        self.assertEqual(bytearray(len(self.identity)), self.identity)
        child_surface = repr((argv, kwargs["env"]))
        self.assertNotIn(os.fspath(self.config), child_surface)
        self.assertNotIn("NEVER-LEAK", child_surface)

    def test_timeout_kills_process_group_reaps_and_zeroes_identity(self) -> None:
        calls = 0

        class Process:
            pid = 54321
            returncode: int | None = None

            def __init__(self, unused_argv: list[str], **kwargs: object) -> None:
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                nonlocal calls
                calls += 1
                if calls == 1:
                    os.read(self.identity_fd, launcher.MAX_IDENTITY_BYTES)
                    os.close(self.identity_fd)
                    raise subprocess.TimeoutExpired([], timeout)
                self.returncode = -9
                return None, None

            def poll(self) -> int | None:
                return self.returncode

        with patch.object(launcher.subprocess, "Popen", Process), patch.object(
            launcher.os, "killpg"
        ) as killpg, patch.object(
            launcher, "PRODUCER_TIMEOUT_SECONDS", 1
        ), patch.object(
            launcher.time, "monotonic", side_effect=(0.0, 0.0, 2.0)
        ):
            with self.assertRaisesRegex(launcher.CustodyError, "producer_timeout"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "f" * 32,
                )
        killpg.assert_called_once_with(54321, launcher.signal.SIGTERM)
        self.assertEqual(2, calls)
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    def test_launcher_cancellation_kills_reaps_cleans_and_zeroes(self) -> None:
        class Process:
            pid = 54324
            returncode: int | None = None

            def __init__(self, unused_argv: list[str], **kwargs: object) -> None:
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                if input is not None:
                    os.read(self.identity_fd, launcher.MAX_IDENTITY_BYTES)
                    os.close(self.identity_fd)
                    raise launcher.CustodyError("launcher_cancelled")
                self.returncode = -15
                return None, None

            def poll(self) -> int | None:
                return self.returncode

        self.cleanup_patcher.stop()
        try:
            with patch.object(launcher.subprocess, "Popen", Process), patch.object(
                launcher.os, "killpg"
            ) as killpg, patch.object(launcher, "_last_resort_cleanup") as cleanup:
                with self.assertRaisesRegex(launcher.CustodyError, "launcher_cancelled"):
                    launcher._invoke_producer(
                        self.args,
                        self.producer,
                        self.identity,
                        self.python_binding,
                        "/pinned/docker",
                        {},
                        "/pinned/age",
                        "/pinned/pg_restore",
                        "f" * 32,
                    )
            killpg.assert_called_once_with(54324, launcher.signal.SIGTERM)
            cleanup.assert_called_once_with("/pinned/docker", {}, "f" * 32)
            self.assertEqual(bytearray(len(self.identity)), self.identity)
        finally:
            self.cleanup_patcher.start()

    def test_signal_handler_marks_cancellation_and_terms_active_group(self) -> None:
        class Process:
            pid = 54325

            @staticmethod
            def poll() -> None:
                return None

        prior_process = launcher._ACTIVE_PRODUCER
        prior_cancelled = launcher._LAUNCHER_CANCELLATION_REQUESTED
        try:
            launcher._ACTIVE_PRODUCER = Process()
            launcher._LAUNCHER_CANCELLATION_REQUESTED = False
            with patch.object(launcher.os, "killpg") as killpg:
                launcher._request_cancellation(launcher.signal.SIGTERM, None)
            killpg.assert_called_once_with(54325, launcher.signal.SIGTERM)
            self.assertIs(True, launcher._LAUNCHER_CANCELLATION_REQUESTED)
        finally:
            launcher._ACTIVE_PRODUCER = prior_process
            launcher._LAUNCHER_CANCELLATION_REQUESTED = prior_cancelled

    def test_timeout_with_unreapable_group_is_bounded_and_zeroes_identity(self) -> None:
        calls = 0

        class Process:
            pid = 54322
            returncode: int | None = None

            def __init__(self, unused_argv: list[str], **kwargs: object) -> None:
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                nonlocal calls
                calls += 1
                if calls == 1:
                    os.read(self.identity_fd, launcher.MAX_IDENTITY_BYTES)
                    os.close(self.identity_fd)
                raise subprocess.TimeoutExpired([], timeout)

            def poll(self) -> int | None:
                return self.returncode

        with patch.object(launcher.subprocess, "Popen", Process), patch.object(
            launcher.os, "killpg"
        ) as killpg, patch.object(
            launcher, "PRODUCER_TIMEOUT_SECONDS", 1
        ), patch.object(
            launcher.time, "monotonic", side_effect=(0.0, 0.0, 2.0)
        ):
            with self.assertRaisesRegex(launcher.CustodyError, "producer_reap_failed"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "f" * 32,
                )
        self.assertEqual(
            [
                call(54322, launcher.signal.SIGTERM),
                call(54322, launcher.signal.SIGKILL),
            ],
            killpg.call_args_list,
        )
        self.assertEqual(3, calls)
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    def test_pipe_write_failure_kills_and_reaps_group_then_zeroes_identity(self) -> None:
        class Process:
            pid = 54323
            returncode: int | None = None

            def __init__(self, unused_argv: list[str], **kwargs: object) -> None:
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                os.close(self.identity_fd)
                self.returncode = -9
                return None, None

            def poll(self) -> int | None:
                return self.returncode

        with patch.object(launcher.subprocess, "Popen", Process), patch.object(
            launcher.os, "write", side_effect=BrokenPipeError("synthetic")
        ), patch.object(launcher.os, "killpg") as killpg:
            with self.assertRaisesRegex(launcher.CustodyError, "producer_launch_failed"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "f" * 32,
                )
        killpg.assert_called_once_with(54323, launcher.signal.SIGTERM)
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    @unittest.skipUnless(os.name == "posix", "POSIX process groups required")
    def test_outer_timeout_allows_cooperative_cleanup_of_term_ignoring_nested_group(self) -> None:
        nested_pid = self.root / "nested.pid"
        cleanup_marker = self.root / "cleanup.done"
        nested_source = (
            "import signal,time\n"
            "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "while True: time.sleep(1)\n"
        )
        fake_producer = f"""
import os, signal, subprocess, sys, time
nested = subprocess.Popen([sys.executable, '-I', '-B', '-c', {nested_source!r}], start_new_session=True)
with open({os.fspath(nested_pid)!r}, 'w', encoding='ascii') as stream:
    stream.write(str(nested.pid))
def stop(unused_signal, unused_frame):
    os.killpg(nested.pid, signal.SIGTERM)
    try:
        nested.wait(timeout=0.2)
    except subprocess.TimeoutExpired:
        os.killpg(nested.pid, signal.SIGKILL)
        nested.wait(timeout=2)
    with open({os.fspath(cleanup_marker)!r}, 'w', encoding='ascii') as stream:
        stream.write('cleaned')
    raise SystemExit(2)
signal.signal(signal.SIGTERM, stop)
while True:
    time.sleep(1)
""".encode("ascii")
        identity = bytearray(b"AGE-SECRET-KEY-NESTED-TEST\n")
        with patch.object(launcher, "PRODUCER_TIMEOUT_SECONDS", 0.3), patch.object(
            launcher, "COOPERATIVE_CLEANUP_GRACE_SECONDS", 5
        ), patch.object(launcher, "REAP_TIMEOUT_SECONDS", 2):
            with self.assertRaisesRegex(launcher.CustodyError, "producer_timeout"):
                launcher._invoke_producer(
                    self.args,
                    fake_producer,
                    identity,
                    launcher._PythonBinding(sys.executable, (2,) * 9),
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "e" * 32,
                )
        self.assertEqual("cleaned", cleanup_marker.read_text(encoding="ascii"))
        pid = int(nested_pid.read_text(encoding="ascii"))
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertEqual(bytearray(len(identity)), identity)

    def test_spawn_failure_zeroes_identity_and_closes_pipe(self) -> None:
        def fail(*unused: object, **unused_kwargs: object) -> None:
            raise OSError("synthetic")

        with patch.object(launcher.subprocess, "Popen", side_effect=fail):
            with self.assertRaisesRegex(launcher.CustodyError, "producer_launch_failed"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "f" * 32,
                )
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    def test_invalid_nonce_fails_before_spawn_and_zeroes_identity(self) -> None:
        with patch.object(launcher.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(launcher.CustodyError, "run_nonce_invalid"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "invalid",
                )
        spawn.assert_not_called()
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    def test_nonzero_child_is_rejected_after_identity_is_zeroed(self) -> None:
        class Process:
            pid = 65432
            returncode: int | None = None

            def __init__(self, unused_argv: list[str], **kwargs: object) -> None:
                self.identity_fd = os.dup(kwargs["pass_fds"][0])

            def communicate(self, *, input: bytes | None = None, timeout: int) -> tuple[None, None]:
                os.read(self.identity_fd, launcher.MAX_IDENTITY_BYTES)
                os.close(self.identity_fd)
                self.returncode = 7
                return None, None

            def poll(self) -> int | None:
                return self.returncode

        with patch.object(launcher.subprocess, "Popen", Process):
            with self.assertRaisesRegex(launcher.CustodyError, "producer_failed"):
                launcher._invoke_producer(
                    self.args,
                    self.producer,
                    self.identity,
                    self.python_binding,
                    "/pinned/docker",
                    {},
                    "/pinned/age",
                    "/pinned/pg_restore",
                    "f" * 32,
                )
        self.assertEqual(bytearray(len(self.identity)), self.identity)

    def test_source_or_binary_failure_occurs_before_custody_file_is_opened(self) -> None:
        with patch.object(
            launcher, "_committed_producer", side_effect=launcher.CustodyError("source_binding_invalid")
        ), patch.object(launcher, "_load_identity") as load:
            with self.assertRaisesRegex(launcher.CustodyError, "source_binding_invalid"):
                launcher.run(self.args)
        load.assert_not_called()

        with patch.object(launcher, "_committed_producer", return_value=self.producer), patch.object(
            launcher,
            "_pinned_python",
            side_effect=launcher.CustodyError("python_identity_invalid"),
        ), patch.object(launcher, "_load_identity") as load:
            with self.assertRaisesRegex(launcher.CustodyError, "python_identity_invalid"):
                launcher.run(self.args)
        load.assert_not_called()

        order: list[str] = []

        def committed(unused_root: Path, unused_commit: str) -> bytes:
            order.append("source")
            return self.producer

        def binary(unused_value: str, label: str) -> str:
            order.append(label)
            return f"/{label}"

        def pinned_python(unused_value: str) -> launcher._PythonBinding:
            order.append("python")
            return self.python_binding

        def load_identity(unused_config: Path, unused_root: Path) -> bytearray:
            order.append("identity")
            return bytearray(b"AGE-SECRET-KEY-TEST\n")

        def docker_binding(unused_docker: str) -> dict[str, object]:
            order.append("dockerBinding")
            return {}

        def invoke(*unused: object, **unused_kwargs: object) -> None:
            order.append("invoke")
            launcher._zero(unused[2])

        with patch.object(launcher, "_committed_producer", side_effect=committed), patch.object(
            launcher, "_pinned_python", side_effect=pinned_python
        ), patch.object(
            launcher, "_binary", side_effect=binary
        ), patch.object(launcher, "_docker_cleanup_binding", side_effect=docker_binding), patch.object(
            launcher.secrets, "token_hex", return_value="f" * 32
        ), patch.object(launcher, "_load_identity", side_effect=load_identity), patch.object(
            launcher, "_invoke_producer", side_effect=invoke
        ):
            launcher.run(self.args)
        self.assertEqual(
            [
                "source", "python", "docker", "age", "pg_restore",
                "dockerBinding", "identity", "invoke",
            ],
            order,
        )

    def test_main_is_silent_on_success_and_fixed_on_failure(self) -> None:
        success_out = io.StringIO()
        success_err = io.StringIO()
        with patch.object(launcher, "run"), contextlib.redirect_stdout(success_out), contextlib.redirect_stderr(success_err):
            status = launcher.main(
                [
                    "--repository-root", os.fspath(self.root),
                    "--authorized-final-commit", COMMIT,
                    "--custody-config", os.fspath(self.config),
                    "--capture-receipt", "/external/capture",
                    "--archive", "/external/archive",
                    "--destination", "/external/destination",
                    "--python", "/python",
                    "--docker", "/docker",
                    "--age", "/age",
                    "--pg-restore", "/pg_restore",
                ]
            )
        self.assertEqual(0, status)
        self.assertEqual("", success_out.getvalue() + success_err.getvalue())
        failure_out = io.StringIO()
        failure_err = io.StringIO()
        secret = "AGE-SECRET-KEY-NEVER-PRINT"
        with patch.object(launcher, "run", side_effect=RuntimeError(secret)), contextlib.redirect_stdout(
            failure_out
        ), contextlib.redirect_stderr(failure_err):
            status = launcher.main(
                [
                    "--repository-root", os.fspath(self.root),
                    "--authorized-final-commit", COMMIT,
                    "--custody-config", os.fspath(self.config),
                    "--capture-receipt", "/external/capture",
                    "--archive", "/external/archive",
                    "--destination", "/external/destination",
                    "--python", "/python",
                    "--docker", "/docker",
                    "--age", "/age",
                    "--pg-restore", "/pg_restore",
                ]
            )
        self.assertEqual(2, status)
        self.assertEqual("", failure_out.getvalue())
        self.assertEqual("g035_dual_restore_custody_failed\n", failure_err.getvalue())
        self.assertNotIn(secret, failure_err.getvalue())
        self.assertNotIn(os.fspath(self.config), failure_err.getvalue())

        interrupt_err = io.StringIO()
        with patch.object(launcher, "run", side_effect=KeyboardInterrupt()), contextlib.redirect_stderr(
            interrupt_err
        ):
            status = launcher.main(
                [
                    "--repository-root", os.fspath(self.root),
                    "--authorized-final-commit", COMMIT,
                    "--custody-config", os.fspath(self.config),
                    "--capture-receipt", "/external/capture",
                    "--archive", "/external/archive",
                    "--destination", "/external/destination",
                    "--python", "/python",
                    "--docker", "/docker",
                    "--age", "/age",
                    "--pg-restore", "/pg_restore",
                ]
            )
        self.assertEqual(2, status)
        self.assertEqual("g035_dual_restore_custody_failed\n", interrupt_err.getvalue())

        parser_err = io.StringIO()
        with contextlib.redirect_stderr(parser_err):
            status = launcher.main(["--identity-file", "/private/key/never-echo"])
        self.assertEqual(2, status)
        self.assertEqual("g035_dual_restore_custody_failed\n", parser_err.getvalue())
        self.assertNotIn("/private/key/never-echo", parser_err.getvalue())

        help_out = io.StringIO()
        help_err = io.StringIO()
        with contextlib.redirect_stdout(help_out), contextlib.redirect_stderr(help_err):
            status = launcher.main(["--help"])
        self.assertEqual(2, status)
        self.assertEqual("", help_out.getvalue())
        self.assertEqual("g035_dual_restore_custody_failed\n", help_err.getvalue())

    def test_parser_has_config_but_no_identity_path_or_bytes_surface(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        options = {
            option
            for action in launcher.parser()._actions
            for option in action.option_strings
        }
        self.assertIn("--custody-config", options)
        self.assertNotIn("--identity-file", options)
        self.assertNotIn("--identity-path", options)
        self.assertNotIn("--identity", options)
        self.assertNotIn("shell=True", source)
        self.assertIn("pass_fds=(read_fd,)", source)
        self.assertIn("start_new_session=True", source)

    def test_outer_timeout_exceeds_explicit_whole_producer_bound(self) -> None:
        source = PRODUCER.read_text(encoding="utf-8")
        tree = ast.parse(source)
        integer_constants: dict[str, int] = {}

        def integer_value(node: ast.expr) -> int:
            if isinstance(node, ast.Constant) and type(node.value) is int:
                return node.value
            if isinstance(node, ast.Name) and node.id in integer_constants:
                return integer_constants[node.id]
            if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
                return integer_value(node.left) + integer_value(node.right)
            raise AssertionError("whole producer bound is not a static integer expression")

        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)
            ):
                try:
                    integer_constants[node.targets[0].id] = integer_value(node.value)
                except AssertionError:
                    pass
        whole_bound = integer_constants["MAX_WHOLE_REHEARSAL_SECONDS"]
        self.assertGreater(launcher.PRODUCER_TIMEOUT_SECONDS, whole_bound)
        self.assertGreaterEqual(launcher.COOPERATIVE_CLEANUP_GRACE_SECONDS, 60)
        functions = {
            node.name: node
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        run_impl = functions["_run_rehearsal_impl"]
        self.assertTrue(any(
            isinstance(node, ast.Name)
            and isinstance(node.ctx, ast.Load)
            and node.id == "MAX_WHOLE_REHEARSAL_SECONDS"
            for node in ast.walk(run_impl)
        ))
        run_impl_names = {
            node.id
            for node in ast.walk(run_impl)
            if isinstance(node, ast.Name)
        }
        self.assertTrue({
            "MAX_ACTIVE_REHEARSAL_SECONDS",
            "MAX_WHOLE_REHEARSAL_SECONDS",
            "_CLEANUP_DEADLINE",
            "_IN_CLEANUP",
        }.issubset(run_impl_names))
        restore = functions["_restore_clone"]
        restore_loops = [node for node in ast.walk(restore) if isinstance(node, ast.While)]
        self.assertTrue(any(
            {"_remaining_timeout", "_require_not_cancelled"}.issubset({
                child.func.id
                for child in ast.walk(loop)
                if isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
            })
            for loop in restore_loops
        ))
        direct_runs = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "run"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "subprocess"
        ]
        self.assertTrue(direct_runs)
        for direct_run in direct_runs:
            timeout = next(
                (keyword.value for keyword in direct_run.keywords if keyword.arg == "timeout"),
                None,
            )
            self.assertIsInstance(timeout, ast.Call)
            assert isinstance(timeout, ast.Call)
            self.assertIsInstance(timeout.func, ast.Name)
            assert isinstance(timeout.func, ast.Name)
            self.assertEqual("_remaining_timeout", timeout.func.id)
        source_names = {
            node.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        }
        self.assertIn("_WHOLE_DEADLINE", source_names)
        self.assertIn("_ACTIVE_IDENTITY", source_names)
        self.assertIn("os.killpg(process.pid, signal.SIGTERM)", source)
        self.assertIn("os.killpg(process.pid, signal.SIGKILL)", source)
        cleanup_reaps = [
            node
            for node in ast.walk(restore)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "communicate"
            and any(
                keyword.arg == "timeout"
                and isinstance(keyword.value, ast.Call)
                and isinstance(keyword.value.func, ast.Name)
                and keyword.value.func.id == "_remaining_timeout"
                and any(
                    nested.arg == "cleanup"
                    and isinstance(nested.value, ast.Constant)
                    and nested.value.value is True
                    for nested in keyword.value.keywords
                )
                for keyword in node.keywords
            )
        ]
        self.assertGreaterEqual(len(cleanup_reaps), 2)


class RunbookContractTests(unittest.TestCase):
    def test_dual_restore_uses_committed_launcher_and_external_config(self) -> None:
        source = RUNBOOK.read_text(encoding="utf-8")
        section = source[
            source.index("### Fresh local recovery evidence") :
            source.index("### Exact workspace and bounded apply")
        ]
        self.assertIn(launcher.LAUNCHER_PATH, section)
        self.assertIn("git show", section)
        self.assertIn("--custody-config <external-owner-only-custody-config.json>", section)
        self.assertNotIn("<approved-local-custodian>", section)
        self.assertNotIn("--identity-file", section)
        self.assertIn("--identity-fd", section)
        self.assertNotIn("<approved-local-custodian>", source)
        self.assertNotIn("<approved-selective-inheritance-custodian>", source)
        self.assertNotIn("--identity-handle", source)
        self.assertNotRegex(
            source,
            r"--entrypoint[^\n]+--\s+restore-verify",
        )


if __name__ == "__main__":
    unittest.main()
