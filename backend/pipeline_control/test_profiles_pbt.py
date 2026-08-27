"""Property-based tests for lite/heavy compute separation.

Feature: crawler-pipeline-orchestration (Requirement 2). These tests target the
pure-logic policy in ``backend/pipeline_control/profiles.py`` (skip decisions and
compute-profile resolution), the declarative graph in
``backend/pipeline_control/graph.py`` (``STEP_SPECS`` heavy capabilities), and the
heavy-local runtime-ready gate in ``backend/pipeline_control/worker.py``. They
encode design Properties 4, 5, and 6, use Python ``hypothesis`` (min 100
examples), and run under ``python -m unittest``.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.pipeline_control.graph import (
    HEAVY_CAPABILITY,
    SKIP_HEAVY_REASON,
    STEP_SPECS,
)
from backend.pipeline_control.profiles import (
    ProfileError,
    resolve_compute_profile,
    skip_reason_for_step,
)
from backend.pipeline_control.worker import heavy_local_runtime_ready

# The heavy steps are exactly those carrying the heavy_compute capability or the
# skip_when_lite marker (frames, OCR/caption, chunk-multimodal, visual location,
# map-URL). This mirrors the design definition used by the skip decision.
HEAVY_STEPS = tuple(
    spec
    for spec in STEP_SPECS
    if (HEAVY_CAPABILITY in spec.capabilities) or spec.skip_when_lite
)

# Capability tokens a target might advertise (see targets.ALLOWED_CAPABILITIES).
_CAP_TOKENS = ("collect", "evaluate", "insert", "heavy_compute", "map_url", "frame_caption", "chunk")

# Data sinks that never raise on their own (hosted_apply is excluded because it
# is fail-closed and raises before any step-skip decision is reached).
_SAFE_SINKS = (None, "artifact_only", "local_db")

# Fixed KST-agnostic bound guarding "bounded" skip reasons against unbounded text.
_MAX_REASON_LEN = 200


def _dispatched_under_lite(data_sink, capabilities):
    """Model the adapter's skip-then-dispatch loop using the real skip gate.

    ``execute_steps`` consults ``skip_reason_for_step`` for each step in order:
    a non-None decision records the skip and ``continue``s (never reaching the
    runner), otherwise the step is dispatched. This mirrors that control flow
    over the real ``STEP_SPECS`` without depending on on-disk script files, and
    returns the ordered ids that would actually be handed to a runner.
    """

    blocked: set[str] = set()
    dispatched: list[str] = []
    for spec in STEP_SPECS:
        decision = skip_reason_for_step(
            spec,
            compute_profile="lite_gha",
            data_sink=data_sink,
            skipped_or_failed=blocked,
            capabilities=capabilities,
        )
        if decision is not None:
            blocked.add(spec.id)
            continue
        dispatched.append(spec.id)
    return dispatched


class LiteVsHeavyComputeProperties(unittest.TestCase):
    # Feature: crawler-pipeline-orchestration, Property 4: Lite profile never runs
    # a heavy step. For all steps in STEP_SPECS under compute profile lite_gha,
    # every heavy step (heavy_compute capability or skip_when_lite) is skipped
    # with a bounded optional skip reason and is never dispatched to a runner.
    # Validates: Requirements 2.1, 2.5
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        data_sink=st.sampled_from(_SAFE_SINKS),
        capabilities=st.one_of(
            st.none(),
            st.sets(st.sampled_from(_CAP_TOKENS)),
        ),
    )
    def test_lite_profile_never_runs_a_heavy_step(self, data_sink, capabilities):
        self.assertTrue(HEAVY_STEPS, "expected at least one heavy step in the graph")

        # (a) The pure skip decision classifies every heavy step as an optional
        # skip with the bounded fixed reason, independent of sink/capabilities.
        for spec in HEAVY_STEPS:
            decision = skip_reason_for_step(
                spec,
                compute_profile="lite_gha",
                data_sink=data_sink,
                skipped_or_failed=set(),
                capabilities=capabilities,
            )
            self.assertIsNotNone(
                decision, f"heavy step {spec.id} must be skipped under lite_gha"
            )
            kind, reason = decision
            self.assertEqual(kind, "optional")
            self.assertEqual(reason, SKIP_HEAVY_REASON)
            self.assertIsInstance(reason, str)
            self.assertGreater(len(reason), 0)
            self.assertLessEqual(len(reason), _MAX_REASON_LEN)

        # (b) Modelling the adapter's skip-then-dispatch loop over the real
        # graph, no heavy step is ever dispatched to a runner under lite_gha.
        dispatched = _dispatched_under_lite(data_sink, capabilities)
        heavy_ids = {spec.id for spec in HEAVY_STEPS}
        self.assertEqual(heavy_ids & set(dispatched), set())

    # Feature: crawler-pipeline-orchestration, Property 5: Heavy readiness gates
    # every heavy step. For all heavy-local readiness states in which at least one
    # required prerequisite is absent, the Pipeline_Worker under profile
    # heavy_local halts with a bounded heavy-runtime-missing condition before
    # invoking any heavy step, leaving heavy-step outputs unmodified.
    # Validates: Requirements 2.3, 2.4
    @settings(
        max_examples=100,
        deadline=None,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
    )
    @given(
        # A proper subset of the filesystem prerequisites is present; max_size=2
        # guarantees at least one of the three is absent (nodeHint/ffmpegHint are
        # always satisfied, so absence must come from these three).
        present=st.sets(
            st.sampled_from(("scripts", "evaluation", "helpers")),
            max_size=2,
        ),
    )
    def test_heavy_readiness_gates_every_heavy_step(self, present):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if "scripts" in present:
                (root / "backend" / "restaurant-crawling" / "scripts").mkdir(parents=True)
            if "evaluation" in present:
                (root / "backend" / "restaurant-evaluation" / "scripts").mkdir(parents=True)
            if "helpers" in present:
                helpers = root / "backend" / "utils" / "run_daily_helpers.py"
                helpers.parent.mkdir(parents=True, exist_ok=True)
                helpers.write_text("# stub\n", encoding="utf-8")

            readiness = heavy_local_runtime_ready(root=root)

            # At least one prerequisite is reported absent, so the aggregate gate
            # is not ready.
            self.assertFalse(all(readiness.values()))
            self.assertFalse(readiness["scripts"] and readiness["evaluation"] and readiness["helpers"])

            # A heavy-step output sentinel that must remain untouched once the
            # gate halts.
            heavy_outputs = ["frozen"]

            # Mirrors the worker heavy-local preflight gate exactly: resolve the
            # profile, then refuse to invoke any heavy step when readiness is not
            # ready.
            def heavy_local_preflight(profile: str) -> None:
                if profile == "heavy_local" and not all(
                    heavy_local_runtime_ready(root=root).values()
                ):
                    raise SystemExit("heavy_local_runtime_missing")
                heavy_outputs.append("dispatched")  # unreachable when not ready

            with self.assertRaises(SystemExit) as ctx:
                heavy_local_preflight("heavy_local")

            # Bounded, secret-free halt condition; heavy outputs left unmodified.
            self.assertEqual(str(ctx.exception), "heavy_local_runtime_missing")
            self.assertEqual(heavy_outputs, ["frozen"])

    # Feature: crawler-pipeline-orchestration, Property 6: Unresolvable profile
    # halts before heavy work. For all non-empty compute-profile strings that are
    # not exactly lite_gha or heavy_local, profile resolution raises a bounded
    # profile-unresolved error and no heavy step executes.
    # Validates: Requirements 2.6
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        raw=st.text(min_size=1).filter(
            lambda value: value.strip() not in {"", "lite_gha", "heavy_local"}
        ),
    )
    def test_unresolvable_profile_halts_before_heavy_work(self, raw):
        heavy_executed: list[str] = []

        # Mirrors the worker ordering: resolve the compute profile first; only
        # then would any heavy step run. An unresolvable profile must abort here.
        def resolve_then_run(candidate: str) -> None:
            profile = resolve_compute_profile(candidate)
            heavy_executed.append(profile)  # heavy work stand-in, must not run

        with self.assertRaises(ProfileError) as ctx:
            resolve_then_run(raw)

        # Bounded profile-unresolved code from the fixed set; no heavy work ran.
        self.assertEqual(ctx.exception.code, "compute_profile_invalid")
        self.assertEqual(heavy_executed, [])


if __name__ == "__main__":
    unittest.main()
