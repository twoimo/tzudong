"""Focused process-boundary tests for backend.pipeline.nodes."""

from __future__ import annotations

import ctypes
import json
import os
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from backend.pipeline import nodes
from backend.pipeline.state import StepName


class RunCommandBoundaryTests(unittest.TestCase):
    _SENSITIVE_NAMES = (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "NAVER_CLIENT_SECRET_BYEON",
        "BROWSER_COOKIE",
        "YOUTUBE_COOKIES",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
    )

    def _run_python(self, stage: str, code: str, timeout: float = 5) -> nodes.CommandResult:
        result = nodes.run_command(
            stage,
            [nodes._python_cmd(), "-c", code],
            timeout=timeout,
        )
        self.assertEqual(nodes.SUBPROCESS_OK, result.reason_code, result.stderr)
        return result

    def _environment_for(self, stage: str) -> dict[str, str | None]:
        names = (*self._SENSITIVE_NAMES, "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "TZUDONG_PIPELINE_ISOLATED")
        result = self._run_python(
            stage,
            "import json, os; print(json.dumps({name: os.environ.get(name) for name in "
            f"{names!r}}}))",
        )
        return json.loads(result.stdout)

    def test_pinned_executables_ignore_parent_path_and_reject_fakes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            fake_bin = Path(temporary_directory) / "fake-bin"
            fake_bin.mkdir()
            marker = Path(temporary_directory) / "fake-executed"
            fake_python = fake_bin / ("python.cmd" if os.name == "nt" else "python")
            fake_python.write_text(f"echo fake > {marker}\n", encoding="utf-8")
            if os.name != "nt":
                fake_python.chmod(0o700)
                fake_bash = fake_bin / "bash"
                fake_bash.write_text(f"#!/bin/sh\necho fake > {marker}\n", encoding="utf-8")
                fake_bash.chmod(0o700)
            else:
                fake_bash = fake_bin / "bash.cmd"
                fake_bash.write_text(f"@echo fake > {marker}\r\n", encoding="utf-8")

            with mock.patch.dict(
                os.environ,
                {"PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"},
                clear=False,
            ):
                result = self._run_python(StepName.GEMINI.value, "print('pinned-python')")
                self.assertIn("pinned-python", result.stdout)
                self.assertFalse(marker.exists())
                rejected = nodes.run_command(
                    StepName.GEMINI.value,
                    [str(fake_python.resolve()), "-c", "raise SystemExit(0)"],
                )
                self.assertEqual(nodes.SUBPROCESS_EXECUTABLE_REJECTED, rejected.reason_code)

                try:
                    bash = nodes._bash_cmd()
                except RuntimeError:
                    # A platform without a pinned bash fails closed instead of using fake PATH.
                    self.assertFalse(marker.exists())
                else:
                    bash_result = nodes.run_command(
                        StepName.GEMINI.value,
                        [bash, "-c", "exit 0"],
                    )
                    self.assertEqual(nodes.SUBPROCESS_OK, bash_result.reason_code)
                    self.assertFalse(marker.exists())

    def test_untrusted_stages_do_not_receive_parent_secrets_or_paths(self) -> None:
        parent_secrets = {
            "SUPABASE_URL": "https://database.example.test",
            "SUPABASE_SERVICE_ROLE_KEY": "service-role-secret",
            "DATABASE_URL": "postgres://database-secret",
            "GEMINI_API_KEY": "provider-secret",
            "OPENAI_API_KEY": "llm-secret",
            "NAVER_CLIENT_SECRET_BYEON": "provider-client-secret",
            "BROWSER_COOKIE": "browser-session-secret",
            "YOUTUBE_COOKIES": "youtube-session-secret",
            "VITE_SUPABASE_PUBLISHABLE_KEY": "publishable-key",
            "PATH": "/attacker/bin",
            "HOME": "/attacker/home",
            "TMPDIR": "/attacker/tmp",
            "TEMP": "/attacker/temp",
            "TMP": "/attacker/tmp",
        }
        with mock.patch.dict(os.environ, parent_secrets, clear=False):
            child_environment = self._environment_for(StepName.ENRICH.value)

        for name in self._SENSITIVE_NAMES:
            self.assertIsNone(child_environment[name], name)
        self.assertNotEqual("/attacker/bin", child_environment["PATH"])
        self.assertNotEqual("/attacker/home", child_environment["HOME"])
        self.assertNotEqual("/attacker/tmp", child_environment["TMPDIR"])
        self.assertNotEqual("/attacker/temp", child_environment["TEMP"])
        self.assertNotEqual("/attacker/tmp", child_environment["TMP"])
        self.assertEqual("1", child_environment["TZUDONG_PIPELINE_ISOLATED"])

        with mock.patch.dict(os.environ, parent_secrets, clear=False):
            gemini_environment = self._environment_for(StepName.GEMINI.value)
        self.assertEqual(parent_secrets["GEMINI_API_KEY"], gemini_environment["GEMINI_API_KEY"])
        for name in self._SENSITIVE_NAMES:
            if name != "GEMINI_API_KEY":
                self.assertIsNone(gemini_environment[name], name)

    def test_final_writer_capability_is_explicit_and_fail_closed(self) -> None:
        self.assertEqual(
            frozenset({"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"}),
            nodes.STAGE_CAPABILITIES[StepName.INSERT.value],
        )
        self.assertEqual(
            frozenset({"GEMINI_API_KEY", "PRIMARY_MODEL", "FALLBACK_MODEL", "GEMINI_THINKING_LEVEL"}),
            nodes.STAGE_CAPABILITIES[StepName.GEMINI.value],
        )
        self.assertEqual(
            frozenset({"GEMINI_API_KEY", "GEMINI_FALLBACK_MODEL", "GEMINI_FALLBACK_TIMEOUT_SEC"}),
            nodes.STAGE_CAPABILITIES[StepName.RULE.value],
        )
        self.assertEqual(
            frozenset({"GEMINI_API_KEY", "PRIMARY_MODEL", "FALLBACK_MODEL", "GEMINI_CLI_TIMEOUT_SEC"}),
            nodes.STAGE_CAPABILITIES[StepName.LAAJ.value],
        )
        for stage in (StepName.ENRICH, StepName.TARGET, StepName.TRANSFORM):
            self.assertEqual(frozenset(), nodes.STAGE_CAPABILITIES[stage.value])

        parent_secrets = {
            "SUPABASE_URL": "https://database.example.test",
            "SUPABASE_SERVICE_ROLE_KEY": "service-role-secret",
            "DATABASE_URL": "postgres://database-secret",
            "GEMINI_API_KEY": "provider-secret",
            "OPENAI_API_KEY": "llm-secret",
            "NAVER_CLIENT_SECRET_BYEON": "provider-client-secret",
            "BROWSER_COOKIE": "browser-session-secret",
            "YOUTUBE_COOKIES": "youtube-session-secret",
            "VITE_SUPABASE_PUBLISHABLE_KEY": "publishable-key",
        }
        with mock.patch.dict(os.environ, parent_secrets, clear=False):
            writer_environment = self._environment_for(StepName.INSERT.value)

        self.assertEqual(parent_secrets["SUPABASE_URL"], writer_environment["SUPABASE_URL"])
        self.assertEqual(
            parent_secrets["SUPABASE_SERVICE_ROLE_KEY"],
            writer_environment["SUPABASE_SERVICE_ROLE_KEY"],
        )
        for name in self._SENSITIVE_NAMES:
            if name not in nodes.STAGE_CAPABILITIES[StepName.INSERT.value]:
                self.assertIsNone(writer_environment[name], name)

        rejected = nodes.run_command(
            "unapproved-stage",
            [nodes._python_cmd(), "-c", "raise SystemExit(0)"],
        )
        self.assertEqual(nodes.SUBPROCESS_STAGE_REJECTED, rejected.reason_code)
    def test_isolated_provider_stages_do_not_reload_repository_env_files(self) -> None:
        root = nodes._project_root()
        gemini_shell = (root / "backend/restaurant-crawling/scripts/07-gemini-crawling.sh").read_text(encoding="utf-8")
        laaj_shell = (root / "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh").read_text(encoding="utf-8")
        rule_script = (root / "backend/restaurant-evaluation/scripts/10-rule-evaluation.py").read_text(encoding="utf-8")

        for source in (gemini_shell, laaj_shell):
            self.assertIn('TZUDONG_PIPELINE_ISOLATED:-0', source)
        self.assertIn('gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()', rule_script)
        self.assertIn("if not gemini_api_key and not has_oauth:", rule_script)

    def test_noisy_child_is_capped_and_stopped_on_aggregate_overflow(self) -> None:
        with mock.patch.object(nodes, "MAX_SUBPROCESS_OUTPUT_BYTES", 4096), mock.patch.object(
            nodes,
            "MAX_CAPTURED_OUTPUT_BYTES",
            1024,
        ):
            result = nodes.run_command(
                StepName.GEMINI.value,
                [nodes._python_cmd(), "-c", "import sys; sys.stdout.write('x' * 1000000); sys.stdout.flush()"],
                timeout=5,
            )

        self.assertEqual(nodes.SUBPROCESS_OUTPUT_LIMIT, result.reason_code)
        self.assertEqual(125, result.returncode)
        self.assertLessEqual(len(result.stdout.encode("utf-8")), 1024)
        self.assertLessEqual(len(result.stderr.encode("utf-8")), 1024)

    def test_timeout_terminates_descendant_process_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            ready_file = temporary_path / "ready"
            heartbeat_file = temporary_path / "heartbeat"
            grandchild = "\n".join((
                "from pathlib import Path",
                "import os, time",
                f"ready = Path({str(ready_file)!r})",
                f"heartbeat = Path({str(heartbeat_file)!r})",
                "ready.write_text(str(os.getpid()), encoding='utf-8')",
                "while True:",
                "    with heartbeat.open('a', encoding='utf-8') as output:",
                "        output.write('x')",
                "    time.sleep(0.02)",
            ))
            parent = "\n".join((
                "from pathlib import Path",
                "import subprocess, sys, time",
                f"subprocess.Popen([sys.executable, '-c', {grandchild!r}])",
                f"while not Path({str(ready_file)!r}).exists():",
                "    time.sleep(0.01)",
                "while True:",
                "    time.sleep(0.1)",
            ))

            original_terminate = nodes._terminate_process_tree

            def terminate_after_ready(supervisor) -> bool:
                deadline = time.monotonic() + 2
                while not ready_file.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready_file.exists())
                return original_terminate(supervisor)

            started = time.monotonic()
            with mock.patch.object(
                nodes,
                "_terminate_process_tree",
                side_effect=terminate_after_ready,
            ):
                result = nodes.run_command(
                    StepName.GEMINI.value,
                    [nodes._python_cmd(), "-c", parent],
                    timeout=0.1,
                )
            elapsed = time.monotonic() - started

            self.assertEqual(nodes.SUBPROCESS_TIMEOUT, result.reason_code)
            self.assertEqual(124, result.returncode)
            self.assertLess(elapsed, 3)
            self.assertTrue(ready_file.exists())
            self.assertTrue(heartbeat_file.exists())
            initial_size = heartbeat_file.stat().st_size
            time.sleep(0.2)
            self.assertEqual(initial_size, heartbeat_file.stat().st_size)


class NodeCommandResultPropagationTests(unittest.TestCase):
    _NODE_CASES = (
        ("enrich", nodes.run_enrich, StepName.ENRICH.value),
        ("gemini", nodes.run_gemini, StepName.GEMINI.value),
        ("target", nodes.run_target, StepName.TARGET.value),
        ("rule", nodes.run_rule, StepName.RULE.value),
        ("laaj", nodes.run_laaj, StepName.LAAJ.value),
        ("transform", nodes.run_transform, StepName.TRANSFORM.value),
        ("insert", nodes.run_insert, StepName.INSERT.value),
    )
    _RESULT_CASES = (
        (nodes.SUBPROCESS_OK, 0),
        (nodes.SUBPROCESS_EXIT_NONZERO, 1),
        (nodes.SUBPROCESS_TIMEOUT, 124),
        (nodes.SUBPROCESS_OUTPUT_LIMIT, 125),
        (nodes.SUBPROCESS_LAUNCH_FAILED, 127),
        (nodes.SUBPROCESS_STAGE_REJECTED, 126),
        (nodes.SUBPROCESS_EXECUTABLE_REJECTED, 126),
        (nodes.SUBPROCESS_CLEANUP_FAILED, 126),
    )

    @staticmethod
    def _state() -> dict:
        return {
            "channel": "channel",
            "crawling_path": "/crawling",
            "evaluation_path": "/evaluation",
            "completed_transform": ["transformed-video"],
            "dry_run": False,
        }

    @staticmethod
    def _result(reason_code: str, returncode: int) -> nodes.CommandResult:
        return nodes.CommandResult(
            args=(),
            returncode=returncode,
            stdout="child-output-must-not-be-logged",
            stderr="child-error-must-not-be-logged",
            reason_code=reason_code,
        )

    def test_every_node_consumes_each_command_result_reason_code(self) -> None:
        for node_name, node, step in self._NODE_CASES:
            for reason_code, returncode in self._RESULT_CASES:
                with self.subTest(node=node_name, reason_code=reason_code):
                    state = self._state()
                    before = dict(state)
                    result = self._result(reason_code, returncode)
                    with mock.patch.object(nodes, "_python_cmd", return_value="/fixed/python"), mock.patch.object(
                        nodes,
                        "_bash_cmd",
                        return_value="/fixed/bash",
                    ), mock.patch.object(nodes, "run_command", return_value=result):
                        if reason_code == nodes.SUBPROCESS_OK:
                            update = node(state)
                        else:
                            with self.assertRaises(nodes.PipelineCommandFailure) as failure:
                                node(state)

                    if reason_code == nodes.SUBPROCESS_OK:
                        self.assertEqual(step, update["current_step"])
                        self.assertEqual(
                            [{"step": step, "duration_sec": mock.ANY}],
                            update["step_timings"],
                        )
                        if node is nodes.run_insert:
                            self.assertEqual(["transformed-video"], update["completed_insert"])
                        else:
                            self.assertNotIn("completed_insert", update)
                    else:
                        self.assertEqual(reason_code, failure.exception.reason_code)
                        self.assertEqual(reason_code, str(failure.exception))
                        self.assertEqual(before, state)
                        self.assertNotIn("completed_insert", state)
                        self.assertEqual(["transformed-video"], state["completed_transform"])

    def test_insert_nonzero_and_timeout_never_publish_completion(self) -> None:
        for reason_code, returncode in (
            (nodes.SUBPROCESS_EXIT_NONZERO, 1),
            (nodes.SUBPROCESS_TIMEOUT, 124),
        ):
            with self.subTest(reason_code=reason_code):
                state = self._state()
                result = self._result(reason_code, returncode)
                with mock.patch.object(nodes, "_python_cmd", return_value="/fixed/python"), mock.patch.object(
                    nodes,
                    "run_command",
                    return_value=result,
                ), self.assertRaises(nodes.PipelineCommandFailure) as failure:
                    nodes.run_insert(state)

                self.assertEqual(reason_code, failure.exception.reason_code)
                self.assertNotIn("completed_insert", state)
                self.assertEqual(["transformed-video"], state["completed_transform"])


    def test_each_node_maps_executable_launch_failure_to_graph_failure(self) -> None:
        for node_name, node, _ in self._NODE_CASES:
            with self.subTest(node=node_name):
                executable_lookup = "_bash_cmd" if node_name in {"gemini", "laaj"} else "_python_cmd"
                state = self._state()
                with mock.patch.object(
                    nodes,
                    executable_lookup,
                    side_effect=RuntimeError(nodes.SUBPROCESS_EXECUTABLE_REJECTED),
                ), mock.patch.object(nodes, "run_command") as run_command, self.assertRaises(
                    nodes.PipelineCommandFailure,
                ) as failure:
                    node(state)

                self.assertEqual(nodes.SUBPROCESS_EXECUTABLE_REJECTED, failure.exception.reason_code)
                run_command.assert_not_called()
                self.assertNotIn("completed_insert", state)

class ProcessTreeFallbackTests(unittest.TestCase):
    @staticmethod
    def _wait_until_ready(ready_file: Path) -> None:
        deadline = time.monotonic() + 3
        while not ready_file.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        if not ready_file.exists():
            raise AssertionError("descendant tree never reached the ready state")
    @staticmethod
    def _assert_windows_process_is_in_job(process, job) -> None:
        ctypes, wintypes, kernel32 = nodes._windows_kernel32()
        process_handle = wintypes.HANDLE(int(process._handle))
        in_job = wintypes.BOOL()
        if not kernel32.IsProcessInJob(process_handle, job, ctypes.byref(in_job)):
            raise AssertionError("could not verify Windows Job Object containment")
        if not in_job.value:
            raise AssertionError("Windows child escaped its Job Object")

    @unittest.skipUnless(os.name == "nt", "Windows job-object supervision")
    def test_windows_job_is_empty_after_ordinary_exit(self) -> None:
        observed_clean_states: list[bool] = []
        original_close = nodes._ProcessTreeSupervisor.close

        def close_after_observing_job(supervisor) -> bool:
            self.assertIsNotNone(supervisor.windows_job)
            observed_clean_states.append(supervisor.is_clean())
            return original_close(supervisor)

        with mock.patch.object(
            nodes._ProcessTreeSupervisor,
            "close",
            new=close_after_observing_job,
        ):
            result = nodes.run_command(
                StepName.GEMINI.value,
                [nodes._python_cmd(), "-c", "print('job-drained')"],
                timeout=5,
            )

        self.assertEqual(nodes.SUBPROCESS_OK, result.reason_code)
        self.assertEqual([True], observed_clean_states)

    def _assert_descendant_tree_stopped(self, invoke, expected_reason_code: str) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            ready_file = temporary_path / "ready"
            heartbeat_file = temporary_path / "heartbeat"
            grandchild = "\n".join((
                "from pathlib import Path",
                "import time",
                f"ready = Path({str(ready_file)!r})",
                f"heartbeat = Path({str(heartbeat_file)!r})",
                "ready.write_text('ready', encoding='utf-8')",
                "while True:",
                "    with heartbeat.open('a', encoding='utf-8') as output:",
                "        output.write('x')",
                "    time.sleep(0.02)",
            ))
            child = "\n".join((
                "from pathlib import Path",
                "import subprocess, sys, time",
                f"subprocess.Popen([sys.executable, '-c', {grandchild!r}])",
                f"while not Path({str(ready_file)!r}).exists():",
                "    time.sleep(0.01)",
                "while True:",
                "    time.sleep(0.1)",
            ))
            parent = "\n".join((
                "from pathlib import Path",
                "import subprocess, sys, time",
                f"subprocess.Popen([sys.executable, '-c', {child!r}])",
                f"while not Path({str(ready_file)!r}).exists():",
                "    time.sleep(0.01)",
                "while True:",
                "    time.sleep(0.1)",
            ))

            result = invoke(parent, ready_file)
            self.assertEqual(expected_reason_code, result.reason_code)
            self.assertTrue(ready_file.exists())
            self.assertTrue(heartbeat_file.exists())
            initial_size = heartbeat_file.stat().st_size
            time.sleep(0.2)
            self.assertEqual(initial_size, heartbeat_file.stat().st_size)

    @unittest.skipIf(os.name == "nt", "POSIX process-group fallback")
    def test_killpg_failure_uses_full_group_helper_without_descendant_leak(self) -> None:
        original_killpg = nodes.os.killpg
        term_failed = False

        def fail_first_term(process_group_id: int, signal_value: int) -> None:
            nonlocal term_failed
            if signal_value == signal.SIGTERM and not term_failed:
                term_failed = True
                raise OSError("forced killpg failure")
            original_killpg(process_group_id, signal_value)

        def invoke(child: str, ready_file: Path) -> nodes.CommandResult:
            original_terminate = nodes._terminate_process_tree

            def terminate_after_ready(supervisor) -> bool:
                self._wait_until_ready(ready_file)
                return original_terminate(supervisor)

            with mock.patch.object(nodes.os, "killpg", side_effect=fail_first_term), mock.patch.object(
                nodes,
                "_terminate_process_tree",
                side_effect=terminate_after_ready,
            ):
                return nodes.run_command(
                    StepName.GEMINI.value,
                    [nodes._python_cmd(), "-c", child],
                    timeout=0.1,
                )

        self._assert_descendant_tree_stopped(invoke, nodes.SUBPROCESS_TIMEOUT)

    @unittest.skipIf(os.name == "nt", "POSIX process-group fallback")
    def test_tree_helper_term_failure_escalates_to_full_group_kill(self) -> None:
        original_killpg = nodes.os.killpg

        def fail_term(process_group_id: int, signal_value: int) -> None:
            if signal_value == signal.SIGTERM:
                raise OSError("forced killpg failure")
            original_killpg(process_group_id, signal_value)

        def invoke(child: str, ready_file: Path) -> nodes.CommandResult:
            original_terminate = nodes._terminate_process_tree

            def terminate_after_ready(supervisor) -> bool:
                self._wait_until_ready(ready_file)
                return original_terminate(supervisor)

            with mock.patch.object(nodes.os, "killpg", side_effect=fail_term), mock.patch.object(
                nodes,
                "_run_posix_tree_helper",
                return_value=False,
            ), mock.patch.object(
                nodes,
                "_terminate_process_tree",
                side_effect=terminate_after_ready,
            ):
                return nodes.run_command(
                    StepName.GEMINI.value,
                    [nodes._python_cmd(), "-c", child],
                    timeout=0.1,
                )

        self._assert_descendant_tree_stopped(invoke, nodes.SUBPROCESS_TIMEOUT)

    @unittest.skipUnless(os.name == "nt", "Windows job-object fallback")
    def test_taskkill_failure_closes_job_without_descendant_leak(self) -> None:
        def invoke(child: str, ready_file: Path) -> nodes.CommandResult:
            original_terminate = nodes._terminate_process_tree

            def terminate_after_ready(supervisor) -> bool:
                if supervisor.windows_job_released:
                    self.assertIsNone(supervisor.windows_job)
                    return False
                self._wait_until_ready(ready_file)
                self.assertIsNotNone(supervisor.windows_job)
                self._assert_windows_process_is_in_job(
                    supervisor.process,
                    supervisor.windows_job,
                )
                self.assertFalse(nodes._windows_job_is_empty(supervisor.windows_job))
                terminated = original_terminate(supervisor)
                self.assertFalse(terminated)
                self.assertIsNone(supervisor.windows_job)
                self.assertTrue(supervisor.windows_job_released)
                return terminated

            with mock.patch.object(nodes, "_terminate_windows_job", return_value=False), mock.patch.object(
                nodes,
                "_taskkill_process_tree",
                return_value=False,
            ), mock.patch.object(
                nodes,
                "_terminate_process_tree",
                side_effect=terminate_after_ready,
            ):
                return nodes.run_command(
                    StepName.GEMINI.value,
                    [nodes._python_cmd(), "-c", child],
                    timeout=0.1,
                )

        self._assert_descendant_tree_stopped(invoke, nodes.SUBPROCESS_CLEANUP_FAILED)

if __name__ == "__main__":
    unittest.main()
