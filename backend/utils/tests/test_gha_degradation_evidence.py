"""Source-contract test: GHA lite-path degradation evidence + preflight ordering.

Feature: crawler-pipeline-orchestration (Requirements 6.7, 6.8, 6.10).

This test pins three observable contracts of the scheduled ``daily-crawler.yml``
``daily-compute`` job by parsing the committed workflow YAML (never by running
it). It asserts against the workflow's actual structure and does not modify it.

1. Requirement 6.7 - When the lite compute records a non-zero adapter status,
   the run still publishes its evidence artifact and records the non-zero
   adapter exit rather than discarding it. Concretely:
     * the pipeline step captures the worker's real exit status (``$?``) and
       writes it to ``$GITHUB_OUTPUT`` (``exit_code=...``) *before* any
       ``exit 0`` in that step, so the adapter status is recorded even when the
       lite lane is intentionally kept green;
     * the job re-exports that captured value as a job output so downstream
       consumers see the non-zero adapter status; and
     * an evidence-artifact upload step runs unconditionally (``if: always()``)
       so evidence is published regardless of the adapter exit.

2. Requirement 6.8 - A degraded run is not reported as a clean success: the
   status-propagation step derives the reported outcome from the recorded
   ``pipeline_exit`` value (a ``case`` on ``PIPELINE_EXIT_CODE``) and retains a
   non-success (``exit 1``) branch, rather than hardcoding success.

3. Requirement 6.10 - The environment-contract preflight fails closed before any
   pipeline work: the ``check_env_contract.py`` step is ordered strictly before
   the worker step and does not neutralize its own non-zero exit. Because a
   GitHub Actions ``run`` step halts its job on a non-zero exit, ordering the
   contract check ahead of the worker guarantees it must exit 0 before any
   pipeline work begins.

No secret values are referenced; this test only inspects workflow structure.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from typing import List, Optional

import yaml


REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "daily-crawler.yml"
JOB = "daily-compute"

PIPELINE_STEP_ID = "pipeline"
WORKER_MARKER = "backend.pipeline_control.worker"
ENV_CONTRACT_MARKER = "check_env_contract.py"


def _load_job_steps(workflow_path: Path, job: str) -> List[dict]:
    document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    jobs = document.get("jobs") or {}
    if job not in jobs:
        raise AssertionError(f"job {job!r} missing from {workflow_path}")
    steps = jobs[job].get("steps") or []
    if not steps:
        raise AssertionError(f"job {job!r} in {workflow_path} declares no steps")
    return steps


def _load_job(workflow_path: Path, job: str) -> dict:
    document = yaml.safe_load(workflow_path.read_text(encoding="utf-8"))
    return (document.get("jobs") or {})[job]


def _normalize_if(value) -> str:
    """Normalize a step ``if:`` expression, unwrapping any ``${{ ... }}``."""
    text = str(value).strip()
    if text.startswith("${{") and text.endswith("}}"):
        text = text[3:-2].strip()
    return text


def _is_always(step: dict) -> bool:
    if "if" not in step:
        return False
    return _normalize_if(step["if"]) == "always()"


def _step_text(step: dict) -> str:
    return f"{step.get('name', '')}\n{step.get('run', '')}"


def _first_index(steps: List[dict], predicate) -> int:
    for index, step in enumerate(steps):
        if predicate(step):
            return index
    return -1


def _find_step_by_id(steps: List[dict], step_id: str) -> Optional[dict]:
    for step in steps:
        if step.get("id") == step_id:
            return step
    return None


class PreflightFailsClosedTest(unittest.TestCase):
    """Requirement 6.10 - env-contract preflight fails closed before work."""

    def setUp(self) -> None:
        self.steps = _load_job_steps(WORKFLOW_PATH, JOB)

    def test_env_contract_check_precedes_worker_step(self) -> None:
        env_index = _first_index(
            self.steps,
            lambda step: ENV_CONTRACT_MARKER in (step.get("run") or ""),
        )
        worker_index = _first_index(
            self.steps,
            lambda step: WORKER_MARKER in (step.get("run") or ""),
        )
        self.assertGreaterEqual(
            env_index, 0, "no env-contract preflight step found in daily-compute"
        )
        self.assertGreaterEqual(
            worker_index, 0, "no pipeline worker step found in daily-compute"
        )
        self.assertLess(
            env_index,
            worker_index,
            "env-contract preflight must run before the pipeline worker step",
        )

    def test_env_contract_preflight_does_not_swallow_nonzero_exit(self) -> None:
        # A preflight that ignores its own exit code cannot fail closed. Assert
        # no env-contract invocation line neutralizes a non-zero exit.
        for step in self.steps:
            run = step.get("run") or ""
            for line in run.splitlines():
                if ENV_CONTRACT_MARKER in line:
                    with self.subTest(line=line.strip()):
                        self.assertNotIn("|| true", line)
                        self.assertNotIn("|| exit 0", line)


class LiteEvidenceAndAdapterExitTest(unittest.TestCase):
    """Requirement 6.7 - lite path publishes evidence + records adapter exit."""

    def setUp(self) -> None:
        self.steps = _load_job_steps(WORKFLOW_PATH, JOB)
        self.pipeline_step = _find_step_by_id(self.steps, PIPELINE_STEP_ID)
        self.assertIsNotNone(
            self.pipeline_step,
            f"pipeline step (id={PIPELINE_STEP_ID!r}) missing from daily-compute",
        )

    def test_pipeline_step_captures_real_adapter_exit_status(self) -> None:
        run = self.pipeline_step.get("run") or ""
        self.assertIn(WORKER_MARKER, run, "pipeline step must invoke the worker")
        # The worker's real exit status is captured rather than discarded.
        self.assertIn(
            "=$?",
            run,
            "pipeline step must capture the worker exit status via $?",
        )

    def test_pipeline_step_records_adapter_exit_before_any_early_exit(self) -> None:
        run = self.pipeline_step.get("run") or ""
        lines = run.splitlines()

        record_index = _first_index_in_lines(
            lines,
            lambda line: "exit_code=" in line and "GITHUB_OUTPUT" in line,
        )
        self.assertGreaterEqual(
            record_index,
            0,
            "pipeline step must record exit_code to $GITHUB_OUTPUT",
        )

        first_exit_zero = _first_index_in_lines(
            lines, lambda line: line.strip() == "exit 0"
        )
        if first_exit_zero >= 0:
            self.assertLess(
                record_index,
                first_exit_zero,
                "adapter exit must be recorded before the lite lane exits 0, so a "
                "non-zero adapter status is captured even when the job stays green",
            )

    def test_job_propagates_pipeline_exit_as_output(self) -> None:
        job = _load_job(WORKFLOW_PATH, JOB)
        outputs = job.get("outputs") or {}
        propagated = [
            key
            for key, expr in outputs.items()
            if "steps.pipeline.outputs.exit_code" in str(expr)
        ]
        self.assertTrue(
            propagated,
            "daily-compute must expose the captured pipeline exit_code as a job "
            "output so the non-zero adapter status is propagated downstream",
        )

    def test_evidence_artifact_upload_runs_unconditionally(self) -> None:
        always_uploads = [
            step
            for step in self.steps
            if "upload-artifact" in str(step.get("uses", "")) and _is_always(step)
        ]
        self.assertTrue(
            always_uploads,
            "at least one evidence-artifact upload step must run with if: always()",
        )
        # At least one always() upload publishes the run evidence (status/log JSON).
        publishes_evidence = any(
            "current-upload-status.json" in str((step.get("with") or {}).get("path", ""))
            for step in always_uploads
        )
        self.assertTrue(
            publishes_evidence,
            "an always() upload step must publish the lite-run evidence "
            "(e.g. current-upload-status.json)",
        )


class DegradedRunNotReportedCleanSuccessTest(unittest.TestCase):
    """Requirement 6.8 - a degraded run is not reported as a clean success."""

    def setUp(self) -> None:
        self.steps = _load_job_steps(WORKFLOW_PATH, JOB)

    def test_status_propagation_derives_outcome_from_recorded_exit(self) -> None:
        # Find the status-propagation step: it consumes the recorded pipeline
        # exit_code (via env) and always() runs so it reports even after a
        # degraded adapter run.
        propagation_steps = [
            step
            for step in self.steps
            if "steps.pipeline.outputs.exit_code"
            in str((step.get("env") or {}).values())
            or "PIPELINE_EXIT_CODE" in (step.get("run") or "")
        ]
        self.assertTrue(
            propagation_steps,
            "no step consumes the recorded pipeline exit code to report status",
        )

        # The reported outcome is derived from the recorded exit (a branch on it),
        # and retains a non-success path rather than hardcoding a clean success.
        derives_and_can_fail = False
        for step in propagation_steps:
            run = step.get("run") or ""
            if "PIPELINE_EXIT_CODE" in run and "exit 1" in run and _is_always(step):
                derives_and_can_fail = True
                break
        self.assertTrue(
            derives_and_can_fail,
            "the status-propagation step must branch on the recorded adapter exit "
            "(PIPELINE_EXIT_CODE) and retain a non-success (exit 1) outcome, so a "
            "degraded run is not reported as a clean success",
        )


def _first_index_in_lines(lines: List[str], predicate) -> int:
    for index, line in enumerate(lines):
        if predicate(line):
            return index
    return -1


if __name__ == "__main__":
    unittest.main()
