"""Bounded source/runtime contracts for ``check_local_runtime.py``."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "backend/bin/check_local_runtime.py"


def _load():
    spec = importlib.util.spec_from_file_location("check_local_runtime", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = _load()


class CheckLocalRuntimeTests(unittest.TestCase):
    def test_registry_is_closed_and_commands_are_argv_only(self) -> None:
        self.assertEqual(
            [tool.name for tool in runtime.TOOL_REGISTRY],
            [
                "python",
                "node",
                "ffmpeg",
                "docker",
                "docker_compose",
                "psycopg2",
                "hypothesis",
                "rust_toolchain",
            ],
        )
        for tool in runtime.TOOL_REGISTRY:
            self.assertIsInstance(tool.argv, tuple)
            self.assertTrue(tool.argv)
            self.assertNotIn("sh", tool.argv[:1])
            self.assertNotIn("bash", tool.argv[:1])

    def test_phase_one_defers_rust_and_accepts_all_required_tools(self) -> None:
        calls = []

        def runner(argv):
            calls.append(tuple(argv))
            if tuple(argv) == ("python3", "--version"):
                return 0, "Python 3.11.0"
            if tuple(argv) == ("node", "--version"):
                return 0, "v24.0.0"
            return 0, "present"

        result = runtime.run_preflight(runner=runner, phase=1)
        self.assertTrue(result["ok"])
        self.assertIsNone(result["errorCode"])
        self.assertEqual(result["absent"], [])
        self.assertEqual(result["deferred"], ["rust_toolchain"])
        self.assertNotIn(("cargo", "--version"), calls)

    def test_missing_result_contains_names_not_command_output(self) -> None:
        marker = "provider diagnostic must stay out"

        def runner(argv):
            if tuple(argv) == ("python3", "--version"):
                return 0, "Python 3.11.0"
            if tuple(argv) == ("node", "--version"):
                return 0, "v24.0.0"
            return 1, marker

        result = runtime.run_preflight(runner=runner, phase=1)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], "heavy_local_runtime_missing")
        self.assertNotIn(marker, repr(result))
        self.assertEqual(
            result["absent"],
            ["docker", "docker_compose", "ffmpeg", "hypothesis", "psycopg2"],
        )

    def test_phase_six_requires_rust_toolchain(self) -> None:
        def runner(argv):
            if tuple(argv) == ("python3", "--version"):
                return 0, "Python 3.11.0"
            if tuple(argv) == ("node", "--version"):
                return 0, "v24.0.0"
            if tuple(argv) == ("cargo", "--version"):
                return 127, ""
            return 0, "present"

        result = runtime.run_preflight(runner=runner, phase=6)
        self.assertFalse(result["ok"])
        self.assertEqual(result["absent"], ["rust_toolchain"])
        self.assertEqual(result["deferred"], [])


if __name__ == "__main__":
    unittest.main()
