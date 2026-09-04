"""Source-contract test: runner -> env-contract profile preflight ordering.

Feature: crawler-pipeline-orchestration (Requirements 7.1, 7.7).

This test pins two observable contracts of the environment-contract preflight:

1. The machine-readable ``--json`` report (and the underlying ``validate()``)
   enumerates every required and optional secret name for a profile, reports
   each secret's presence status, and reports a single overall
   satisfied/not-satisfied result (Requirement 7.7).

2. Each runner validates its mapped env-contract profile (one of ``daily``,
   ``pipeline-control``, ``hosted-pending-apply``, ``gdrive-backfill``) in a
   step that runs strictly before any pipeline-work step for that runner. Since
   a GitHub Actions ``run`` step halts its job on a non-zero exit, ordering the
   contract check ahead of the pipeline step guarantees the check must exit 0
   before any pipeline work begins (Requirement 7.1).

No secret values are constructed from real credentials; all values used here
are synthetic and never emitted.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Dict, List

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
CHECKER_PATH = REPO_ROOT / "backend" / "bin" / "check_env_contract.py"

_spec = importlib.util.spec_from_file_location("check_env_contract", CHECKER_PATH)
assert _spec is not None and _spec.loader is not None
check_env_contract = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = check_env_contract
_spec.loader.exec_module(check_env_contract)

PROFILES = check_env_contract.PROFILES

# The four canonical runner->profile mappings the orchestration pins. Each entry
# names the workflow file, the job, the env-contract profiles that job must
# validate, and markers that identify the job's first pipeline-work step.
WORKFLOW_RUNNERS = [
    {
        "path": ".github/workflows/daily-crawler.yml",
        "job": "daily-compute",
        "profiles": {"daily", "pipeline-control"},
        "pipeline_markers": ("backend.pipeline_control.worker",),
    },
    {
        "path": ".github/workflows/daily-crawler.yml",
        "job": "hosted-pending-apply",
        "profiles": {"hosted-pending-apply"},
        "pipeline_markers": ("run_hosted_new_video_pipeline.py",),
    },
    {
        "path": ".github/workflows/gdrive-frame-backfill.yml",
        "job": "backfill",
        "profiles": {"gdrive-backfill"},
        "pipeline_markers": ("Backfill staged frame shards",),
    },
]


def _satisfying_env(profile: str) -> Dict[str, str]:
    """Build a synthetic env that satisfies every required secret for a profile."""
    env: Dict[str, str] = {}
    for name in PROFILES[profile]["required"]:
        env[name] = f"synthetic-{name.lower()}-value"
    return env


def _load_steps(workflow_path: Path, job: str) -> List[dict]:
    document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    jobs = document.get("jobs") or {}
    if job not in jobs:
        raise AssertionError(f"job {job!r} missing from {workflow_path}")
    steps = jobs[job].get("steps") or []
    if not steps:
        raise AssertionError(f"job {job!r} in {workflow_path} declares no steps")
    return steps


def _first_index(steps: List[dict], predicate) -> int:
    for index, step in enumerate(steps):
        if predicate(step):
            return index
    return -1


class ReportSchemaTest(unittest.TestCase):
    """Requirement 7.7 - machine-readable report enumerates names + result."""

    def test_validate_enumerates_names_presence_and_overall_result(self) -> None:
        for profile, spec in PROFILES.items():
            with self.subTest(profile=profile):
                report = check_env_contract.validate(profile, _satisfying_env(profile))

                # Overall satisfied/not-satisfied result is a single boolean.
                self.assertIn("ok", report)
                self.assertIsInstance(report["ok"], bool)
                self.assertEqual(report["profile"], profile)

                # Required secrets: every name enumerated with a presence status.
                self.assertEqual(
                    set(report["required"].keys()), set(spec["required"])
                )
                for name, present in report["required"].items():
                    self.assertIsInstance(present, bool, name)

                # Optional secrets: every name enumerated with a presence status.
                self.assertEqual(
                    set(report["optional"].keys()), set(spec["optional"])
                )
                for name, present in report["optional"].items():
                    self.assertIsInstance(present, bool, name)

    def test_presence_status_tracks_binding_and_flips_overall_result(self) -> None:
        # Pick a profile with at least one required secret.
        profile = "daily"
        required = list(PROFILES[profile]["required"])
        self.assertTrue(required)

        satisfied = check_env_contract.validate(profile, _satisfying_env(profile))
        self.assertTrue(satisfied["ok"])
        self.assertTrue(all(satisfied["required"].values()))
        self.assertEqual(satisfied["missingRequired"], [])

        # Drop one required secret: presence flips to False and overall not-satisfied.
        env = _satisfying_env(profile)
        dropped = required[0]
        del env[dropped]
        report = check_env_contract.validate(profile, env)
        self.assertFalse(report["ok"])
        self.assertFalse(report["required"][dropped])
        self.assertIn(dropped, report["missingRequired"])

    def test_cli_json_emits_schema_with_overall_result(self) -> None:
        profile = "gdrive-backfill"
        # Clean, controlled environment so only synthetic required values are set.
        env = {
            "PATH": os.environ.get("PATH", ""),
            "SystemRoot": os.environ.get("SystemRoot", ""),
        }
        env.update(_satisfying_env(profile))
        completed = subprocess.run(
            [sys.executable, str(CHECKER_PATH), "--profile", profile, "--json"],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertIn("ok", payload)
        self.assertIsInstance(payload["ok"], bool)
        self.assertTrue(payload["ok"])
        self.assertEqual(
            set(payload["required"].keys()), set(PROFILES[profile]["required"])
        )
        self.assertEqual(
            set(payload["optional"].keys()), set(PROFILES[profile]["optional"])
        )

    def test_cli_json_reports_not_satisfied_and_nonzero_when_required_absent(self) -> None:
        profile = "pipeline-control"
        env = {
            "PATH": os.environ.get("PATH", ""),
            "SystemRoot": os.environ.get("SystemRoot", ""),
        }
        # Deliberately provide no required secrets.
        completed = subprocess.run(
            [sys.executable, str(CHECKER_PATH), "--profile", profile, "--json"],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["ok"])
        self.assertEqual(
            set(payload["missingRequired"]), set(PROFILES[profile]["required"])
        )


class PreflightOrderingTest(unittest.TestCase):
    """Requirement 7.1 - each runner validates its profile before pipeline work."""

    def test_all_four_profiles_are_mapped_to_a_runner(self) -> None:
        mapped = set()
        for runner in WORKFLOW_RUNNERS:
            mapped |= runner["profiles"]
        self.assertEqual(mapped, set(PROFILES))

    def test_env_contract_check_precedes_pipeline_step(self) -> None:
        for runner in WORKFLOW_RUNNERS:
            workflow_path = REPO_ROOT / runner["path"]
            steps = _load_steps(workflow_path, runner["job"])

            def step_text(step: dict) -> str:
                return f"{step.get('name', '')}\n{step.get('run', '')}"

            pipeline_index = _first_index(
                steps,
                lambda step: any(
                    marker in step_text(step)
                    for marker in runner["pipeline_markers"]
                ),
            )
            with self.subTest(runner=runner["job"], workflow=runner["path"]):
                self.assertGreaterEqual(
                    pipeline_index,
                    0,
                    f"no pipeline step found for job {runner['job']}",
                )

                for profile in runner["profiles"]:
                    check_index = _first_index(
                        steps,
                        lambda step: "check_env_contract.py" in step.get("run", "")
                        and f"--profile {profile}" in step.get("run", ""),
                    )
                    self.assertGreaterEqual(
                        check_index,
                        0,
                        f"job {runner['job']} does not validate profile {profile}",
                    )
                    self.assertLess(
                        check_index,
                        pipeline_index,
                        f"profile {profile} check must precede pipeline work "
                        f"in job {runner['job']}",
                    )

    def test_env_contract_step_does_not_swallow_nonzero_exit(self) -> None:
        # A preflight that ignores its own exit code cannot fail closed. Assert
        # no env-contract invocation is neutralized with `|| true` on its line.
        for runner in WORKFLOW_RUNNERS:
            workflow_path = REPO_ROOT / runner["path"]
            steps = _load_steps(workflow_path, runner["job"])
            for step in steps:
                run = step.get("run", "") or ""
                for line in run.splitlines():
                    if "check_env_contract.py" in line:
                        with self.subTest(job=runner["job"], line=line.strip()):
                            self.assertNotIn("|| true", line)
                            self.assertNotIn("|| exit 0", line)


if __name__ == "__main__":
    unittest.main()
