"""P3 declarative adapter graph, target schema, and heavy/lite/GHA policy."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control.adapter import execute_steps
from backend.pipeline_control.graph import (
    ADAPTER_STEPS,
    STEP_BY_ID,
    AdapterGraphError,
    build_argv,
    validate_graph,
)
from backend.pipeline_control.profiles import (
    default_data_sink,
    resolve_compute_profile,
    resolve_control_store,
    skip_reason_for_step,
)
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.targets import TargetSchemaError, assert_admitted, load_targets
from backend.pipeline_control.worker import process_one

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "DATA_CONTRACTS.md"


def _run(target: str = "tzuyang", profile: str = "heavy_local") -> RunRecord:
    return RunRecord(
        id="graph-1",
        target=target,
        profile=profile,  # type: ignore[arg-type]
        status="Fetching",
        idempotency_key="graphkey01",
        payload_hash="abc",
        actor="qa",
        request_id="req",
        lease_until=9_999,
        heartbeat_at=1,
        dry_run=False,
    )


class GraphContractTests(unittest.TestCase):
    def test_commands_match_run_daily_and_include_quality_gate(self) -> None:
        validate_graph()
        self.assertEqual(STEP_BY_ID["04-frames"].script, "backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js")
        self.assertNotIn("--channel", STEP_BY_ID["03-1-context"].extra_args)
        self.assertEqual(ADAPTER_STEPS[-1], "13-quality-gate")
        argv = build_argv(STEP_BY_ID["03-1-context"], target="tzuyang")
        self.assertNotIn("--channel", argv)
        self.assertIn("--max-videos", argv)
        frames = build_argv(STEP_BY_ID["04-frames"], target="tzuyang")
        self.assertIn("--delete-cache", frames)
        self.assertTrue(any(part.endswith("04-extract-frames-with-heatmap.js") for part in frames))

    def test_python_override_must_remain_python3(self) -> None:
        with patch.dict(os.environ, {"PYTHON_CMD": "python"}, clear=False):
            with self.assertRaises(AdapterGraphError) as ctx:
                build_argv(STEP_BY_ID["01-collect-urls"], target="tzuyang")
            self.assertEqual(ctx.exception.code, "interpreter_not_admitted")

    def test_data_contracts_row(self) -> None:
        text = CONTRACTS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control adapter graph and profiles", text)
        self.assertIn("04-extract-frames-with-heatmap.js", text)
        self.assertNotIn("[Showing last", text)
        self.assertNotIn("artifact://", text)


class TargetSchemaTests(unittest.TestCase):
    def test_tzuyang_and_meatcreator_are_admitted(self) -> None:
        records = load_targets()
        ids = {item["id"] for item in records}
        self.assertEqual(ids, {"tzuyang", "meatcreator"})
        for item in records:
            self.assertTrue(item["enabled"])
            self.assertTrue(item["handle"].startswith("@"))
            self.assertIn("insert", item["capabilities"])
        self.assertEqual(assert_admitted("tzuyang"), "tzuyang")
        self.assertEqual(assert_admitted("meatcreator"), "meatcreator")

    def test_schema_rejects_missing_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "channels.yaml"
            path.write_text("channels:\n  tzuyang:\n    channel_id: x\n    handle: \"@tzuyang6145\"\n    name: z\n    data_path: restaurant-crawling/data/tzuyang\n    evaluation_data_path: restaurant-evaluation/data/tzuyang\n", encoding="utf-8")
            with self.assertRaises(TargetSchemaError):
                load_targets(path)


class ProfilePolicyTests(unittest.TestCase):
    def test_gha_defaults_to_lite_and_artifact(self) -> None:
        self.assertEqual(resolve_compute_profile("", {"GITHUB_ACTIONS": "true"}), "lite_gha")
        self.assertEqual(default_data_sink("lite_gha"), "artifact_only")
        self.assertEqual(default_data_sink("heavy_local"), "local_db")
        self.assertEqual(resolve_control_store({"TZUDONG_PIPELINE_STORE": "postgres"}), "postgres")

    def test_lite_skips_heavy_and_evaluation_downstream(self) -> None:
        blocked: set[str] = set()
        kinds = []
        from backend.pipeline_control.graph import STEP_SPECS

        for spec in STEP_SPECS:
            skip = skip_reason_for_step(
                spec,
                compute_profile="lite_gha",
                data_sink="artifact_only",
                skipped_or_failed=blocked,
                capabilities={"collect", "evaluate", "insert", "heavy_compute"},
            )
            if skip:
                blocked.add(spec.id)
                kinds.append((spec.id, skip[0]))
        self.assertIn(("04-frames", "optional"), kinds)
        self.assertIn(("08-chunk", "optional"), kinds)
        self.assertIn(("09-target", "downstream"), kinds)
        self.assertIn(("13-quality-gate", "downstream"), kinds)
        self.assertIn(("02-1-migrate", "downstream"), kinds)


class LiveGraphTests(unittest.TestCase):
    def test_live_runner_uses_fixed_commands_and_quality_gate(self) -> None:
        seen: list[list[str]] = []

        def runner(argv: list[str]) -> int:
            seen.append(argv)
            return 0

        result = execute_steps(_run(), should_stop=lambda: None, live=True, runner=runner, data_sink="local_db")
        self.assertEqual(result, "Succeeded")
        self.assertEqual(len(seen), len(ADAPTER_STEPS))
        joined = [" ".join(item) for item in seen]
        self.assertTrue(any("04-extract-frames-with-heatmap.js" in item for item in joined))
        self.assertFalse(any("04-heatmap-and-frames.js" in item for item in joined))
        context = next(item for item in seen if any("03-1-generate-transcript-context.py" in part for part in item))
        self.assertNotIn("--channel", context)
        self.assertTrue(any("admin-data-quality-audit.mjs" in item for item in joined))

    def test_step08_failure_skips_evaluation_downstream(self) -> None:
        seen: list[str] = []

        def runner(argv: list[str]) -> int:
            script = " ".join(argv)
            seen.append(script)
            if "08-chunk-multimodal-crawling.sh" in script:
                return 1
            return 0

        result = execute_steps(_run(), should_stop=lambda: None, live=True, runner=runner, data_sink="local_db")
        self.assertEqual(result, "Failed")
        self.assertTrue(any("08-chunk-multimodal-crawling.sh" in item for item in seen))
        self.assertFalse(any("09-target-selection.py" in item for item in seen))
        self.assertFalse(any("13-supabase-insert.py" in item for item in seen))

    def test_artifact_only_live_omits_mutating_steps(self) -> None:
        calls: list[list[str]] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="lite_gha",
            idempotency_key="artifactlive-p3",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-artifact-p3",
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as raw, patch.dict(
            os.environ,
            {
                "TZUDONG_DATA_SINK": "artifact_only",
                "TZUDONG_EXECUTION_MODE": "live",
                "TZUDONG_COMPUTE_PROFILE": "lite_gha",
            },
            clear=False,
        ):
            os.environ.pop("SUPABASE_URL", None)
            path = Path(raw) / "current-summary.json"
            result = process_one(
                store,
                live=True,
                runner=lambda argv: calls.append(argv) or 0,
                manifest_path=path,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(result, "Succeeded")
        self.assertIsNone(store.get(run.id).error_code)
        joined = "\n".join(" ".join(item) for item in calls)
        self.assertNotIn("02-1-migrate-meta-to-supabase.py", joined)
        self.assertNotIn("13-supabase-insert.py", joined)
        self.assertNotIn("admin-data-quality-audit.mjs", joined)
        self.assertEqual(payload["dataSink"], "artifact_only")
        self.assertEqual(payload["executionMode"], "live")
        self.assertFalse(payload["liveExecutionSucceeded"])


if __name__ == "__main__":
    unittest.main()
