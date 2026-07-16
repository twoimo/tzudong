from __future__ import annotations

import json
import os
import signal
import subprocess
import tempfile
import textwrap
import time
import sys
import types
import unittest
from unittest import mock
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
WRAPPER = BACKEND_ROOT / "bin" / "gemini"
SYSTEM_PYTHON = Path("/usr/bin/python3")
SYSTEM_NODE = Path("/usr/bin/node")


@unittest.skipUnless(
    os.name == "posix"
    and SYSTEM_PYTHON.is_file()
    and os.access(SYSTEM_PYTHON, os.X_OK)
    and Path("/proc/self/fd").is_dir(),
    "Gemini wrapper requires Linux /proc descriptors and /usr/bin/python3",
)
class GeminiWrapperSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        os.chmod(self.root, 0o700)
        self.home = self.root / "home"
        self.bin = self.root / "bin"
        for directory in (self.home, self.bin):
            directory.mkdir(mode=0o700)
            os.chmod(directory, 0o700)
        self.gemini_dir = self.home / ".gemini"
        self.gemini_dir.mkdir(mode=0o700)
        os.chmod(self.gemini_dir, 0o700)
        self.cli = self.bin / "gemini"

    def tearDown(self) -> None:
        for runtime_directory in self.home.glob(".gemini-wrapper-*"):
            os.chmod(runtime_directory, 0o700)
        self.temporary_directory.cleanup()

    def _write_cli(self, source: str) -> None:
        self._write_raw_cli(
            f"#!{SYSTEM_PYTHON}\n{textwrap.dedent(source).lstrip()}\n",
        )

    def _write_raw_cli(self, source: str) -> None:
        self.cli.write_text(source, encoding="utf-8")
        os.chmod(self.cli, 0o700)

    def _write_credential(self, name: str, value: dict[str, str]) -> Path:
        path = self.gemini_dir / name
        path.write_text(json.dumps(value), encoding="utf-8")
        os.chmod(path, 0o600)
        return path

    def _environment(
        self,
        *,
        path: str | None = None,
        extra_environment: dict[str, str] | None = None,
        timeout_seconds: str = "1",
    ) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HOME": str(self.home),
                "PATH": str(self.bin) if path is None else path,
                "TMPDIR": str(self.root / "caller-tmp"),
                "GEMINI_WRAPPER_TIMEOUT_SECONDS": timeout_seconds,
            }
        )
        if extra_environment:
            environment.update(extra_environment)
        return environment

    def _run(
        self,
        *argv: str,
        path: str | None = None,
        extra_environment: dict[str, str] | None = None,
        input_data: bytes = b"",
        timeout: float = 8.0,
        timeout_seconds: str = "1",
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [str(WRAPPER), *argv],
            cwd=self.root,
            env=self._environment(
                path=path,
                extra_environment=extra_environment,
                timeout_seconds=timeout_seconds,
            ),
            input=input_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )

    def _assert_runtime_directory_cleaned(self) -> None:
        self.assertEqual(list(self.home.glob(".gemini-wrapper-*")), [])

    @staticmethod
    def _process_is_live(process_id: int) -> bool:
        try:
            os.kill(process_id, 0)
        except ProcessLookupError:
            return False
        status_path = Path(f"/proc/{process_id}/stat")
        if status_path.exists():
            fields = status_path.read_text(encoding="utf-8").rsplit(")", 1)[1].split()
            if fields and fields[0] == "Z":
                return False
        return True
    @staticmethod
    def _wrapper_namespace() -> dict[str, object]:
        source = WRAPPER.read_text(encoding="utf-8")
        supervisor = source.split("0<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        module_name = "gemini_wrapper_security_namespace"
        module = types.ModuleType(module_name)
        sys.modules[module_name] = module
        try:
            exec(compile(supervisor, str(WRAPPER), "exec"), module.__dict__)
        finally:
            sys.modules.pop(module_name, None)
        return module.__dict__

    def test_direct_execution_uses_fixed_isolated_python_despite_hostile_path(self) -> None:
        python_marker = self.root / "hostile-python-ran"
        bash_marker = self.root / "hostile-bash-ran"
        hostile_python = self.bin / "python3"
        hostile_python.write_text(f"#!/bin/sh\nprintf bad > {python_marker!s}\n", encoding="utf-8")
        os.chmod(hostile_python, 0o700)
        bash_environment = self.root / "hostile-bash-env"
        bash_environment.write_text(f"printf bad > {bash_marker!s}\n", encoding="utf-8")
        self._write_cli("print('safe')")

        completed = self._run(
            extra_environment={
                "BASH_ENV": str(bash_environment),
                "PYTHONHOME": str(self.root / "invalid-python-home"),
                "PYTHONPATH": str(self.root / "hostile-python-path"),
                "PYTHONSTARTUP": str(self.root / "startup.py"),
            },
        )

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"safe\n")
        self.assertEqual(completed.stderr, b"")
        self.assertFalse(python_marker.exists())
        self.assertFalse(bash_marker.exists())
        self._assert_runtime_directory_cleaned()

    def test_provider_stderr_is_redacted_and_argv_is_literal(self) -> None:
        self._write_cli(
            """
import json
import sys
sys.stdout.write(json.dumps(sys.argv[1:], ensure_ascii=False) + "\\n")
sys.stderr.write(
    "Bearer private-token eyJhbGciOiJIUzI1NiJ9.payload.signature "
    "operator@example.com +82-10-1234-5678 37.5665,126.9780\\n"
)
""",
        )
        argv = ["plain", "contains a space", "$(not-executed)", ";", "", "한글"]

        completed = self._run(*argv)

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(json.loads(completed.stdout.decode("utf-8")), argv)
        self.assertEqual(completed.stderr, b"")
        for secret in (
            b"Bearer private-token",
            b"eyJhbGciOiJIUzI1NiJ9",
            b"operator@example.com",
            b"+82-10-1234-5678",
            b"37.5665,126.9780",
        ):
            self.assertNotIn(secret, completed.stderr)
        self._assert_runtime_directory_cleaned()

    def test_child_environment_is_minimal_and_strips_runtime_hooks(self) -> None:
        self._write_cli(
            """
import json
import os
print(json.dumps(dict(sorted(os.environ.items()))))
""",
        )
        canaries = {
            "NODE_OPTIONS": "--require=/tmp/hook.js",
            "NODE_PATH": "/tmp/node-path",
            "PYTHONPATH": "/tmp/python-path",
            "PYTHONHOME": "/tmp/python-home",
            "PYTHONSTARTUP": "/tmp/startup.py",
            "DATABASE_URL": "postgres://private",
            "SUPABASE_SERVICE_ROLE_KEY": "private-service-key",
            "OPENAI_API_KEY": "provider-canary",
            "AWS_SECRET_ACCESS_KEY": "cloud-canary",
            "GEMINI_API_KEY": "allowed-gemini-key",
            "GOOGLE_CLOUD_PROJECT": "allowed-project",
        }

        completed = self._run(extra_environment=canaries)

        self.assertEqual(completed.returncode, 0)
        child_environment = json.loads(completed.stdout)
        self.assertEqual(child_environment["HOME"], str(self.home))
        self.assertEqual(child_environment["PATH"], "/usr/bin:/bin")
        self.assertEqual(child_environment["PWD"], child_environment["TMPDIR"])
        self.assertTrue(child_environment["TMPDIR"].startswith(str(self.home)))
        self.assertEqual(child_environment["LANG"], "C.UTF-8")
        self.assertEqual(child_environment["LC_ALL"], "C.UTF-8")
        self.assertEqual(child_environment["GEMINI_API_KEY"], "allowed-gemini-key")
        self.assertEqual(child_environment["GOOGLE_CLOUD_PROJECT"], "allowed-project")
        for name in canaries:
            if name not in {"GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT"}:
                self.assertNotIn(name, child_environment)
        self._assert_runtime_directory_cleaned()

    def test_huge_provider_stderr_has_a_fixed_bounded_public_code(self) -> None:
        self._write_cli(
            """
import sys
sys.stderr.write("Bearer private-token " + "x" * (1024 * 1024))
sys.stderr.flush()
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 125)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_STDERR_LIMIT\n")
        self.assertLess(len(completed.stderr), 128)
        self.assertNotIn(b"Bearer private-token", completed.stderr)
        self._assert_runtime_directory_cleaned()

    def test_validated_node_package_executes_with_fixed_node_not_env(self) -> None:
        if not SYSTEM_NODE.is_file() or not os.access(SYSTEM_NODE, os.X_OK):
            self.skipTest("fixed /usr/bin/node is unavailable")
        package_root = self.home / ".npm-global/lib/node_modules/@google/gemini-cli"
        (package_root / "dist").mkdir(parents=True, mode=0o700)
        package_json = package_root / "package.json"
        package_json.write_text(
            json.dumps({"name": "@google/gemini-cli", "bin": {"gemini": "dist/index.js"}}),
            encoding="utf-8",
        )
        entrypoint = package_root / "dist/index.js"
        entrypoint.write_text("#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join('|'));\n", encoding="utf-8")
        for path in (package_json, entrypoint):
            os.chmod(path, 0o700)

        completed = self._run("literal", "$(not-executed)")

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"literal|$(not-executed)\n")
        self.assertEqual(completed.stderr, b"")
        self._assert_runtime_directory_cleaned()

    def test_unapproved_env_shebang_symlink_and_mutable_directory_are_rejected(self) -> None:
        self._write_raw_cli("#!/usr/bin/env python3\nprint('must-not-run')\n")
        completed = self._run()
        self.assertEqual(completed.returncode, 127)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_EXECUTABLE_UNAVAILABLE\n")

        self._write_cli("raise SystemExit(99)")
        unsafe_directory = self.root / "unsafe"
        unsafe_directory.mkdir(mode=0o777)
        os.chmod(unsafe_directory, 0o777)
        unsafe_cli = unsafe_directory / "gemini"
        unsafe_cli.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
        os.chmod(unsafe_cli, 0o700)
        symlink_directory = self.root / "symlink"
        symlink_directory.mkdir(mode=0o700)
        os.chmod(symlink_directory, 0o700)
        (symlink_directory / "gemini").symlink_to(self.cli)

        for result in (
            self._run(path=f"relative:{unsafe_directory}"),
            self._run(path=str(symlink_directory)),
            self._run(path=str(WRAPPER.parent)),
        ):
            self.assertEqual(result.returncode, 127)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(result.stderr, b"GEMINI_WRAPPER_EXECUTABLE_UNAVAILABLE\n")
        self._assert_runtime_directory_cleaned()

    def test_verified_descriptor_execution_is_used_for_swap_resistance(self) -> None:
        source = WRAPPER.read_text(encoding="utf-8")
        self.assertIn("/proc/self/fd/{self.descriptor}", source)
        self.assertIn("pass_fds=inherited_descriptors", source)
        self.assertIn("runtime_directory.descriptor", source)
        self.assertIn("os.O_NOFOLLOW", source)
        self.assertIn("digest_open_descriptor", source)
        self.assertIn("#!/usr/bin/env node", source)

    def test_quota_retry_uses_atomic_backup_without_mutating_backups(self) -> None:
        current = self._write_credential("oauth_creds.json", {"account": "current"})
        backup_a = self._write_credential("oauth_creds_a.json", {"account": "a"})
        backup_b = self._write_credential("oauth_creds_b.json", {"account": "b"})
        self._write_cli(
            """
import json
import os
import sys
credential_path = os.path.join(os.environ["HOME"], ".gemini", "oauth_creds.json")
with open(credential_path, encoding="utf-8") as credential_file:
    account = json.load(credential_file)["account"]
if account == "current":
    sys.stderr.write("RESOURCE_EXHAUSTED private diagnostic\\n")
    raise SystemExit(1)
sys.stdout.write(account + "\\n")
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"a\n")
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(json.loads(current.read_text(encoding="utf-8")), {"account": "a"})
        self.assertEqual(json.loads(backup_a.read_text(encoding="utf-8")), {"account": "a"})
        self.assertEqual(json.loads(backup_b.read_text(encoding="utf-8")), {"account": "b"})
        for credential in (current, backup_a, backup_b):
            self.assertEqual(credential.stat().st_mode & 0o077, 0)
        self._assert_runtime_directory_cleaned()
    def test_one_second_exact_quota_retry_reaps_sigterm_ignoring_stderr_daemon(self) -> None:
        self._write_credential("oauth_creds.json", {"account": "current"})
        self._write_credential("oauth_creds_a.json", {"account": "rotated"})
        daemon_pid = self.home / "quota-daemon.pid"
        self._write_cli(
            """
import json
import os
import signal
import sys
import time
from pathlib import Path

credential_path = Path(os.environ["HOME"]) / ".gemini" / "oauth_creds.json"
account = json.loads(credential_path.read_text(encoding="utf-8"))["account"]
pid_path = Path(os.environ["HOME"]) / "quota-daemon.pid"

if account == "current":
    if os.fork() == 0:
        os.setsid()
        if os.fork() == 0:
            pid_path.write_text(str(os.getpid()), encoding="ascii")
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            sys.stderr.write("daemon keeps stderr open\\n")
            sys.stderr.flush()
            time.sleep(60)
        os._exit(0)
    deadline = time.monotonic() + 1
    while not pid_path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not pid_path.exists():
        raise SystemExit(97)
    sys.stderr.write("RESOURCE_EXHAUSTED\\n")
    raise SystemExit(1)

process_id = int(pid_path.read_text(encoding="ascii"))
try:
    os.kill(process_id, 0)
except ProcessLookupError:
    pass
else:
    fields = Path(f"/proc/{process_id}/stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()
    if not fields or fields[0] != "Z":
        sys.stderr.write("adopted daemon survived\\n")
        raise SystemExit(98)
print("daemon-dead")
""",
        )

        completed = self._run(timeout_seconds="1")

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"daemon-dead\n")
        self.assertEqual(completed.stderr, b"")
        self.assertFalse(self._process_is_live(int(daemon_pid.read_text(encoding="ascii"))))
        self._assert_runtime_directory_cleaned()

    def test_status_zero_and_unrelated_text_never_trigger_quota_rotation(self) -> None:
        current = self._write_credential("oauth_creds.json", {"account": "current"})
        backup = self._write_credential("oauth_creds_a.json", {"account": "a"})
        self._write_cli(
            """
import sys
sys.stderr.write("RESOURCE_EXHAUSTED but status zero\\n")
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b"")
        self.assertEqual(json.loads(current.read_text(encoding="utf-8")), {"account": "current"})
        self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), {"account": "a"})

        self._write_cli("import sys\nsys.stderr.write('quota unrelated private text\\n')\nraise SystemExit(1)")
        completed = self._run()
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_CHILD_FAILURE\n")
        self.assertEqual(json.loads(current.read_text(encoding="utf-8")), {"account": "current"})
        self._assert_runtime_directory_cleaned()

    def test_fifo_rotation_lock_is_rejected_without_blocking(self) -> None:
        self._write_credential("oauth_creds.json", {"account": "current"})
        self._write_credential("oauth_creds_a.json", {"account": "a"})
        os.mkfifo(self.gemini_dir / ".oauth_creds.rotation.lock", 0o600)
        self._write_cli("import sys\nsys.stderr.write('429\\n')\nraise SystemExit(1)")

        started = time.monotonic()
        completed = self._run()

        self.assertLess(time.monotonic() - started, 2.0)
        self.assertEqual(completed.returncode, 126)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_CREDENTIAL_ROTATION_FAILED\n")
        self._assert_runtime_directory_cleaned()

    def test_stale_generation_is_retried_without_rotating_the_new_current(self) -> None:
        current = self._write_credential("oauth_creds.json", {"account": "current"})
        backup = self._write_credential("oauth_creds_a.json", {"account": "backup"})
        self._write_cli(
            """
import json
import os
import sys
path = os.path.join(os.environ["HOME"], ".gemini", "oauth_creds.json")
with open(path, encoding="utf-8") as source:
    account = json.load(source)["account"]
if account == "current":
    with open(path, "w", encoding="utf-8") as destination:
        json.dump({"account": "new-current"}, destination)
    os.chmod(path, 0o600)
    sys.stderr.write("RESOURCE_EXHAUSTED\\n")
    raise SystemExit(1)
print(account)
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, b"new-current\n")
        self.assertEqual(json.loads(current.read_text(encoding="utf-8")), {"account": "new-current"})
        self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), {"account": "backup"})
        self._assert_runtime_directory_cleaned()

    def test_concurrent_rotations_keep_current_valid_and_never_mutate_backups(self) -> None:
        current = self._write_credential("oauth_creds.json", {"account": "current"})
        backup_a = self._write_credential("oauth_creds_a.json", {"account": "a"})
        backup_b = self._write_credential("oauth_creds_b.json", {"account": "b"})
        self._write_cli(
            """
import json
import os
import sys
path = os.path.join(os.environ["HOME"], ".gemini", "oauth_creds.json")
with open(path, encoding="utf-8") as source:
    account = json.load(source)["account"]
if account == "current":
    sys.stderr.write("RESOURCE_EXHAUSTED\\n")
    raise SystemExit(1)
print(account)
""",
        )
        processes = [
            subprocess.Popen(
                [str(WRAPPER)],
                cwd=self.root,
                env=self._environment(timeout_seconds="4"),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            for _ in range(2)
        ]

        results = [process.communicate(timeout=8) for process in processes]

        self.assertTrue(all(process.returncode == 0 for process in processes))
        self.assertTrue(all(stdout in (b"a\n", b"b\n") for stdout, _ in results))
        self.assertTrue(all(stderr == b"" for _, stderr in results))
        self.assertIn(json.loads(current.read_text(encoding="utf-8"))["account"], {"a", "b"})
        self.assertEqual(json.loads(backup_a.read_text(encoding="utf-8")), {"account": "a"})
        self.assertEqual(json.loads(backup_b.read_text(encoding="utf-8")), {"account": "b"})
        self._assert_runtime_directory_cleaned()
    def test_global_deadline_covers_retries_and_rotation(self) -> None:
        self._write_credential("oauth_creds.json", {"account": "current"})
        self._write_credential("oauth_creds_a.json", {"account": "a"})
        self._write_cli(
            """
import sys
import time
time.sleep(0.65)
sys.stderr.write("429\\n")
raise SystemExit(1)
""",
        )

        completed = self._run(timeout_seconds="1")

        self.assertEqual(completed.returncode, 124)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_TIMEOUT\n")
        self._assert_runtime_directory_cleaned()
    def test_expiry_after_runtime_creation_inventory_and_stage_writes_is_cleanup_safe(self) -> None:
        namespace = self._wrapper_namespace()
        deadline_expired = namespace["DeadlineExpired"]
        deadline_type = namespace["Deadline"]

        class ExpiringDeadline:
            def __init__(self, allowed_require_calls: int) -> None:
                self.allowed_require_calls = allowed_require_calls
                self.require_calls = 0

            def require(self) -> None:
                self.require_calls += 1
                if self.require_calls > self.allowed_require_calls:
                    raise deadline_expired

        home_directory = namespace["open_home_directory"](str(self.home))
        runtime_directory = None
        credential_directory = None
        try:
            after_create = ExpiringDeadline(1)
            runtime_directory = namespace["create_runtime_directory"](
                home_directory,
                after_create,
            )
            self.assertEqual(after_create.require_calls, 1)
            self.assertTrue(
                namespace["cleanup_runtime_directory"](
                    runtime_directory,
                    deadline_type.start(1),
                )
            )
            runtime_directory = None

            self._write_credential("oauth_creds_a.json", {"account": "a"})
            credential_directory = namespace["credential_directory"](
                home_directory,
                deadline_type.start(1),
            )
            self.assertIsNotNone(credential_directory)
            with self.assertRaises(deadline_expired):
                namespace["credential_inventory"](
                    credential_directory,
                    ExpiringDeadline(1),
                )

            for partial_write in (False, True):
                original_write = os.write
                original_close = os.close
                original_unlink = os.unlink
                closed_descriptors: list[int] = []
                unlinked_names: list[str] = []

                def track_close(descriptor: int) -> None:
                    closed_descriptors.append(descriptor)
                    original_close(descriptor)

                def track_unlink(path: str, *args: object, **kwargs: object) -> None:
                    unlinked_names.append(str(path))
                    original_unlink(path, *args, **kwargs)

                if partial_write:
                    def short_write(descriptor: int, data: bytes) -> int:
                        return original_write(descriptor, data[: max(1, len(data) // 2)])
                    os.write = short_write
                os.close = track_close
                os.unlink = track_unlink
                try:
                    with self.assertRaises(deadline_expired):
                        namespace["atomic_replace_current"](
                            credential_directory,
                            b'{"account":"rotated"}',
                            ExpiringDeadline(2),
                        )
                finally:
                    os.write = original_write
                    os.close = original_close
                    os.unlink = original_unlink
                self.assertTrue(closed_descriptors)
                self.assertTrue(
                    any(name.startswith(".oauth_creds.stage.") for name in unlinked_names)
                )
                self.assertEqual(list(self.gemini_dir.glob(".oauth_creds.stage.*")), [])
        finally:
            if runtime_directory is not None:
                namespace["cleanup_runtime_directory"](
                    runtime_directory,
                    deadline_type.start(1),
                )
            if credential_directory is not None:
                credential_directory.close()
            home_directory.close()
        self._assert_runtime_directory_cleaned()

    def test_runtime_pin_open_failure_after_mkdtemp_is_cleaned_with_fixed_diagnostics(self) -> None:
        namespace = self._wrapper_namespace()
        wrapper_os = namespace["os"]
        wrapper_signal = namespace["signal"]
        wrapper_tempfile = namespace["tempfile"]
        original_mkdtemp = wrapper_tempfile.mkdtemp
        original_open = wrapper_os.open
        original_write = wrapper_os.write
        runtime_paths: list[str] = []
        pin_open_after_mkdtemp: list[bool] = []
        diagnostics: list[bytes] = []

        def track_mkdtemp(*args: object, **kwargs: object) -> str:
            runtime_path = original_mkdtemp(*args, **kwargs)
            runtime_paths.append(runtime_path)
            return runtime_path

        def fail_runtime_pin_open(
            path: str,
            flags: int,
            mode: int = 0o777,
            *,
            dir_fd: int | None = None,
        ) -> int:
            if (
                runtime_paths
                and path == os.path.basename(runtime_paths[-1])
                and dir_fd is not None
            ):
                pin_open_after_mkdtemp.append(True)
                raise OSError("private runtime pin open failure")
            if dir_fd is None:
                return original_open(path, flags, mode)
            return original_open(path, flags, mode, dir_fd=dir_fd)

        def capture_stderr(descriptor: int, data: bytes) -> int:
            if descriptor == 2:
                diagnostics.append(bytes(data))
                return len(data)
            return original_write(descriptor, data)

        with (
            mock.patch.dict(
                os.environ,
                {
                    "HOME": str(self.home),
                    "GEMINI_WRAPPER_TIMEOUT_SECONDS": "1",
                },
            ),
            mock.patch.object(sys, "argv", [str(WRAPPER), str(self.cli)]),
            mock.patch.dict(
                namespace,
                {
                    "require_resource_support": lambda: None,
                    "install_subreaper": lambda: None,
                },
            ),
            mock.patch.object(wrapper_tempfile, "mkdtemp", track_mkdtemp),
            mock.patch.object(wrapper_os, "open", fail_runtime_pin_open),
            mock.patch.object(wrapper_os, "write", capture_stderr),
            mock.patch.object(wrapper_signal, "signal"),
        ):
            status = namespace["main"]()

        self.assertEqual(len(runtime_paths), 1)
        self.assertEqual(pin_open_after_mkdtemp, [True])
        self.assertEqual(status, 126)
        self.assertEqual(
            diagnostics,
            [b"GEMINI_WRAPPER_RESOURCE_UNAVAILABLE\n"],
        )
        self.assertNotIn(b"private runtime pin open failure", b"".join(diagnostics))
        self.assertEqual(list(self.root.rglob(".gemini-wrapper-*")), [])

    def test_fast_stderr_cap_is_observed_after_reader_close_and_join(self) -> None:
        self._write_cli(
            """
import os
os.write(2, b"x" * (64 * 1024 + 1))
""",
        )
        completed = self._run()

        self.assertEqual(completed.returncode, 125)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_STDERR_LIMIT\n")
        self._assert_runtime_directory_cleaned()

        self._write_cli(
            """
import os
os.write(2, b"429\\n" + b"x" * (64 * 1024 + 1))
raise SystemExit(9)
""",
        )
        completed = self._run()

        self.assertEqual(completed.returncode, 125)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_STDERR_LIMIT\n")
        self._assert_runtime_directory_cleaned()

    def test_reader_join_failure_is_a_cleanup_failure(self) -> None:
        namespace = self._wrapper_namespace()

        class Stream:
            def close(self) -> None:
                pass

        class UnjoinableThread:
            def join(self, timeout: float) -> None:
                pass

            def is_alive(self) -> bool:
                return True

        reader = namespace["BoundedStderrReader"](Stream())
        reader.thread = UnjoinableThread()
        self.assertFalse(reader.close(namespace["Deadline"].start(1)))

        source = WRAPPER.read_text(encoding="utf-8")
        self.assertIn(
            "stderr_limited = reader.limit_exceeded.is_set() or stderr_limited",
            source,
        )

    def test_child_sigterm_handler_receives_the_unblocked_signal(self) -> None:
        handled = self.home / "sigterm-handled"
        self._write_cli(
            """
import os
import signal
import time
from pathlib import Path

def handle_term(_signum, _frame):
    Path(os.environ["HOME"]).joinpath("sigterm-handled").write_text("handled", encoding="ascii")
    raise SystemExit(0)

signal.signal(signal.SIGTERM, handle_term)
time.sleep(60)
""",
        )

        completed = self._run(timeout_seconds="1")

        self.assertEqual(completed.returncode, 124)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_TIMEOUT\n")
        self.assertEqual(handled.read_text(encoding="ascii"), "handled")
        self._assert_runtime_directory_cleaned()

    def test_runtime_nested_and_external_moves_remove_mkdir_and_symlink_replacements(self) -> None:
        self._write_cli(
            """
import os
import sys
from pathlib import Path

runtime = Path.cwd()
home = Path(os.environ["HOME"])
if sys.argv[1] == "nested":
    destination_parent = home / "nested-runtime-parent"
else:
    destination_parent = home.parent / "external-runtime-parent"
destination_parent.mkdir(mode=0o700, exist_ok=True)
os.chmod(destination_parent, 0o700)
os.chdir(runtime.parent)
moved = destination_parent / runtime.name
runtime.rename(moved)
if sys.argv[2] == "mkdir":
    runtime.mkdir()
    (runtime / "replacement-canary").write_text("x", encoding="ascii")
else:
    runtime.symlink_to(moved, target_is_directory=True)
(moved / "pinned-runtime-canary").write_text("x", encoding="ascii")
""",
        )

        for destination in ("nested", "external"):
            for replacement in ("mkdir", "symlink"):
                with self.subTest(destination=destination, replacement=replacement):
                    completed = self._run(destination, replacement)

                    self.assertEqual(completed.returncode, 122)
                    self.assertEqual(
                        completed.stderr,
                        b"GEMINI_WRAPPER_CLEANUP_FAILED\n",
                    )
                    self.assertEqual(list(self.root.rglob(".gemini-wrapper-*")), [])

    def test_cleanup_failure_precedes_timeout_stderr_limit_and_interruption(self) -> None:
        self._write_cli(
            """
import os
import signal
import sys
import time
from pathlib import Path

runtime = Path.cwd()
os.chdir(runtime.parent)
moved = runtime.with_name(runtime.name + "-moved")
runtime.rename(moved)
runtime.mkdir()
mode = sys.argv[1]
if mode == "stderr":
    os.write(2, b"x" * (64 * 1024 + 1))
if mode == "signal":
    os.kill(os.getppid(), signal.SIGTERM)
time.sleep(60)
""",
        )

        for mode in ("timeout", "stderr", "signal"):
            completed = self._run(mode, timeout_seconds="1")
            self.assertEqual(completed.returncode, 122, mode)
            self.assertEqual(
                completed.stderr,
                b"GEMINI_WRAPPER_CLEANUP_FAILED\n",
                mode,
            )

    def test_stdin_is_preserved_across_heredoc_supervisor(self) -> None:
        self._write_cli("import sys\nsys.stdout.buffer.write(sys.stdin.buffer.read())")
        payload = b"stdin\x00is literal\n$(not-shell)\n"

        completed = self._run(input_data=payload)

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stdout, payload)
        self.assertEqual(completed.stderr, b"")
        self._assert_runtime_directory_cleaned()

    def test_memory_fork_and_file_resource_controls_emit_fixed_code(self) -> None:
        self._write_cli(
            """
import resource
import sys
checks = (
    resource.getrlimit(resource.RLIMIT_AS)[0] <= 2 * 1024 * 1024 * 1024,
    resource.getrlimit(resource.RLIMIT_NPROC)[0] <= 64,
    resource.getrlimit(resource.RLIMIT_FSIZE)[0] <= 32 * 1024 * 1024,
    resource.getrlimit(resource.RLIMIT_NOFILE)[0] <= 128,
    resource.getrlimit(resource.RLIMIT_CORE)[0] == 0,
    resource.getrlimit(resource.RLIMIT_CPU)[0] <= 115,
)
if not all(checks):
    raise SystemExit(99)
sys.stderr.write("MemoryError: Resource temporarily unavailable: File too large\\n")
raise SystemExit(1)
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 123)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_RESOURCE_LIMIT\n")
        self._assert_runtime_directory_cleaned()

    def test_timeout_reaps_process_group_and_setsid_double_fork_escape(self) -> None:
        escaped_pid_file = self.home / "escaped.pid"
        self._write_cli(
            """
import os
import time
from pathlib import Path
pid_file = Path(os.environ["HOME"]) / "escaped.pid"
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        pid_file.write_text(str(os.getpid()), encoding="ascii")
        time.sleep(60)
    os._exit(0)
time.sleep(60)
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 124)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_TIMEOUT\n")
        process_id = int(escaped_pid_file.read_text(encoding="ascii"))
        deadline = time.monotonic() + 2.0
        while self._process_is_live(process_id) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(self._process_is_live(process_id))

    def test_signal_during_child_startup_has_fixed_interrupted_result_and_no_leak(self) -> None:
        pid_file = self.home / "child.pid"
        self._write_cli(
            """
import os
import time
from pathlib import Path
Path(os.environ["HOME"]).joinpath("child.pid").write_text(str(os.getpid()), encoding="ascii")
time.sleep(60)
""",
        )
        process = subprocess.Popen(
            [str(WRAPPER)],
            cwd=self.root,
            env=self._environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 2.0
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(pid_file.exists())
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=4)

            self.assertEqual(process.returncode, 128 + signal.SIGTERM)
            self.assertEqual(stdout, b"")
            self.assertEqual(stderr, b"GEMINI_WRAPPER_INTERRUPTED\n")
            child_pid = int(pid_file.read_text(encoding="ascii"))
            deadline = time.monotonic() + 2.0
            while self._process_is_live(child_pid) and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse(self._process_is_live(child_pid))
            self._assert_runtime_directory_cleaned()
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate()

    def test_cleanup_failure_has_fixed_code(self) -> None:
        self._write_cli(
            """
import os
from pathlib import Path
runtime = Path.cwd()
(runtime / "keep").write_text("x", encoding="ascii")
os.chdir(runtime.parent)
moved = runtime.with_name(runtime.name + "-moved")
runtime.rename(moved)
runtime.symlink_to(moved, target_is_directory=True)
""",
        )

        completed = self._run()

        self.assertEqual(completed.returncode, 122)
        self.assertEqual(completed.stderr, b"GEMINI_WRAPPER_CLEANUP_FAILED\n")


if __name__ == "__main__":
    unittest.main()
