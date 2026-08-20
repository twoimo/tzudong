"""Live adapter (injected runner) and cutover gate."""

from __future__ import annotations

import json
from hashlib import sha256
import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from backend.pipeline_control.adapter import execute_steps
from backend.pipeline_control.cutover import plan_cutover
from backend.pipeline_control.manifest import (
    is_live_evidence_eligible,
    is_live_execution_success,
    record_parity_attempt,
)
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one, write_run_manifest
from backend.utils.supabase_rest import (
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
)


def _live_evidence(job_id: str) -> dict:
    readback_sha = "c" * 64
    return {
        "jobId": job_id,
        "sameRunIdVerified": True,
        "executionMode": "live",
        "dataSink": "local_db",
        "computeProfile": "heavy_local",
        "target": "tzuyang",
        "finalStatus": "OK",
        "finalExitCode": 0,
        "noWorkShortCircuit": False,
        "gitSha": "a" * 40,
        "inputSha256": "b" * 64,
        "outputSha256": readback_sha,
        "stepEvidenceSha256": "d" * 64,
        "evidenceSchemaVersion": "pipeline-live-evidence-v1",
        "baselineSha256": readback_sha,
        "candidateSha256": readback_sha,
        "readbackSha256": readback_sha,
        "evidenceReceiptSha256": sha256(job_id.encode("utf-8")).hexdigest(),
        "baselineRowCount": 25,
        "candidateRowCount": 25,
        "readbackRowCount": 25,
    }


class LiveAdapterTests(unittest.TestCase):
    def test_live_mode_uses_injected_runner_not_real_subprocess(self) -> None:
        seen: list[list[str]] = []

        def runner(argv: list[str]) -> int:
            seen.append(argv)
            return 0

        run = RunRecord(
            id="live-1",
            target="tzuyang",
            profile="heavy_local",
            status="Fetching",
            idempotency_key="livekey01",
            payload_hash="abc",
            actor="qa",
            request_id="req",
            lease_until=9_999,
            heartbeat_at=1,
            dry_run=False,
        )
        result = execute_steps(run, should_stop=lambda: None, live=True, runner=runner)
        self.assertEqual(result, "Succeeded")
        self.assertEqual(len(seen), 14)
        self.assertIn("--channel", seen[0])
        self.assertIn("tzuyang", seen[0])

    def test_live_failure_stops_between_steps(self) -> None:
        calls = {"n": 0}

        def runner(argv: list[str]) -> int:
            calls["n"] += 1
            return 1 if calls["n"] == 2 else 0

        run = RunRecord(
            id="live-2",
            target="tzuyang",
            profile="heavy_local",
            status="Fetching",
            idempotency_key="livekey02",
            payload_hash="abc",
            actor="qa",
            request_id="req",
            lease_until=9_999,
            heartbeat_at=1,
            dry_run=False,
        )
        result = execute_steps(run, should_stop=lambda: None, live=True, runner=runner)
        self.assertEqual(result, "Failed")
        self.assertEqual(calls["n"], 2)

    def test_worker_writes_manifest_and_respects_dry_run_flag(self) -> None:
        seen: list[list[str]] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="livekey03",
            payload={},
            actor="qa",
            request_id="req",
            dry_run=True,
        )
        with tempfile.TemporaryDirectory() as raw, patch.dict(
            os.environ,
            {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""},
            clear=False,
        ):
            path = Path(raw) / "current-summary.json"
            process_one(store, live=True, runner=lambda argv: seen.append(argv) or 0, manifest_path=path)
            self.assertEqual(seen, [])
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["finalStatus"], "OK")
            self.assertEqual(payload["jobId"], next(iter(store.runs)))
            self.assertEqual(payload["executionMode"], "dry_run")
            self.assertEqual(payload["dataSink"], "local_db")
            self.assertRegex(payload["gitSha"], r"^[0-9a-f]{40}$")
            self.assertIsNone(payload["inputSha256"])
            self.assertIsNone(payload["outputSha256"])
            self.assertRegex(payload["requestPayloadSha256"], r"^[0-9a-f]{64}$")
            self.assertRegex(payload["stepEvidenceSha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(
                payload["hashProvenance"],
                {"inputSha256": "unavailable", "outputSha256": "unavailable"},
            )
            self.assertFalse(payload["liveExecutionSucceeded"])
            self.assertFalse(payload["liveEvidenceEligible"])

    def test_hosted_supabase_url_is_rejected_before_live_runner(self) -> None:
        import os
        from unittest.mock import patch

        calls: list[list[str]] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="liveboundary01",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-boundary",
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as raw, patch.dict(
            os.environ,
            {
                "TZUDONG_DATA_ENV": "local_db",
                "TZUDONG_DATA_SINK": "local_db",
                "SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co",
            },
            clear=False,
        ):
            path = Path(raw) / "current-summary.json"
            result = process_one(
                store,
                live=True,
                runner=lambda argv: calls.append(argv) or 0,
                manifest_path=path,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(result, "Failed")
        self.assertEqual(store.get(run.id).error_code, "supabase_data_boundary_rejected")
        self.assertEqual(calls, [])
        self.assertEqual(payload["executionMode"], "live")
        self.assertFalse(payload["liveExecutionSucceeded"])
        self.assertFalse(payload["liveEvidenceEligible"])

    def test_worker_binds_derived_boundary_for_runner_and_restores_environment(self) -> None:
        marker_names = (
            "TZUDONG_DATA_SINK",
            "TZUDONG_EXECUTION_MODE",
            "TZUDONG_COMPUTE_PROFILE",
        )
        previous = {name: os.environ.pop(name, None) for name in marker_names}
        seen: list[tuple[str | None, str | None, str | None]] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="boundcontext01",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-bound-context",
            dry_run=False,
        )

        def runner(_argv: list[str]) -> int:
            seen.append(tuple(os.environ.get(name) for name in marker_names))
            return 1

        try:
            with tempfile.TemporaryDirectory() as raw, patch.dict(
                os.environ,
                {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""},
                clear=False,
            ):
                result = process_one(
                    store,
                    live=True,
                    runner=runner,
                    manifest_path=Path(raw) / "current-summary.json",
                )
            self.assertEqual(result, "Failed")
            self.assertEqual(seen, [("local_db", "live", "heavy_local")])
            for name in marker_names:
                self.assertNotIn(name, os.environ)
        finally:
            for name, value in previous.items():
                if value is not None:
                    os.environ[name] = value

    def test_late_dotenv_hosted_url_is_rejected_before_sdk_loader(self) -> None:
        runner_calls: list[list[str]] = []
        sdk_loader_calls: list[str] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="latedotenv01",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-late-dotenv",
            dry_run=False,
        )

        def runner(argv: list[str]) -> int:
            runner_calls.append(argv)
            # Model a numbered script loading backend/.env after the worker
            # preflight but before its lazy Supabase SDK import.
            prior_url = os.environ.get("SUPABASE_URL")
            prior_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            os.environ["SUPABASE_URL"] = "https://abcdefghijklmnopqrst.supabase.co"
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-test-value"
            try:
                try:
                    resolve_privileged_supabase_rest_credentials()
                except SupabaseRestConfigurationError:
                    return 1
                sdk_loader_calls.append("loaded")
                return 0
            finally:
                if prior_url is None:
                    os.environ.pop("SUPABASE_URL", None)
                else:
                    os.environ["SUPABASE_URL"] = prior_url
                if prior_key is None:
                    os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
                else:
                    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = prior_key

        with tempfile.TemporaryDirectory() as raw, patch.dict(
            os.environ,
            {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""},
            clear=False,
        ):
            result = process_one(
                store,
                live=True,
                runner=runner,
                manifest_path=Path(raw) / "current-summary.json",
            )
        self.assertEqual(result, "Failed")
        self.assertEqual(len(runner_calls), 1)
        self.assertEqual(sdk_loader_calls, [])

    def test_live_manifest_is_eligible_only_with_frozen_input_and_readback_hashes(self) -> None:
        import os
        from unittest.mock import patch

        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="liveevidence01",
            payload={"frozen": True},
            actor="qa",
            request_id="req-evidence",
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as raw, patch.dict(
            os.environ,
            {
                "TZUDONG_DATA_ENV": "local_db",
                "TZUDONG_DATA_SINK": "local_db",
                "RUN_DAILY_EXECUTION_SHA": "f" * 40,
                "RUN_DAILY_INPUT_SHA256": "d" * 64,
                "RUN_DAILY_OUTPUT_SHA256": "e" * 64,
            },
            clear=False,
        ):
            os.environ.pop("SUPABASE_URL", None)
            path = Path(raw) / "current-summary.json"
            result = process_one(
                store,
                live=True,
                runner=lambda _argv: 0,
                manifest_path=path,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(result, "Succeeded")
        self.assertEqual(payload["jobId"], run.id)
        self.assertEqual(payload["executionMode"], "live")
        self.assertEqual(payload["inputSha256"], "d" * 64)
        self.assertEqual(payload["outputSha256"], "e" * 64)
        self.assertTrue(payload["liveExecutionSucceeded"])
        self.assertFalse(payload["sameRunIdVerified"])
        self.assertFalse(payload["liveEvidenceEligible"])

    def test_artifact_only_live_result_is_not_local_cutover_evidence(self) -> None:
        candidate = {**_live_evidence("job-artifact-1"), "dataSink": "artifact_only"}
        self.assertFalse(is_live_execution_success(candidate))
        self.assertFalse(is_live_evidence_eligible(candidate))

    def test_artifact_only_live_run_refuses_mutating_adapter(self) -> None:
        import os

        calls: list[list[str]] = []
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="lite_gha",
            idempotency_key="artifactlive01",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-artifact",
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
        self.assertEqual(result, "Failed")
        self.assertEqual(store.get(run.id).error_code, "artifact_only_live_unsupported")
        self.assertEqual(calls, [])
        self.assertEqual(payload["dataSink"], "artifact_only")
        self.assertEqual(payload["executionMode"], "live")
        self.assertFalse(payload["liveExecutionSucceeded"])

    def test_environment_hashes_cannot_manufacture_n3_evidence(self) -> None:
        candidate = _live_evidence("job-unverified-1")
        candidate["sameRunIdVerified"] = False
        candidate["evidenceSchemaVersion"] = None
        self.assertFalse(is_live_evidence_eligible(candidate))

    def test_cutover_refused_without_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger = Path(raw) / "ledger.json"
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ):
                record_parity_attempt(ledger, matched=True, candidate=_live_evidence("job-live-1"))
                with self.assertRaises(PermissionError):
                    plan_cutover(ledger)
                record_parity_attempt(ledger, matched=True, candidate=_live_evidence("job-live-2"))
                record_parity_attempt(ledger, matched=True, candidate=_live_evidence("job-live-3"))
                planned = plan_cutover(ledger)
                self.assertTrue(planned["allowed"])

    def test_cutover_refuses_forged_counter_only_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "ledger.json"
            ledger_path.write_text('{"consecutiveMatches":3}\n', encoding="utf-8")
            with self.assertRaises(PermissionError):
                plan_cutover(ledger_path)
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ), self.assertRaises(PermissionError):
                plan_cutover(ledger_path)

    def test_manifest_uses_canonical_sh_labels_and_skip_reason(self) -> None:
        from backend.pipeline_control.worker import write_run_manifest
        import json
        import tempfile
        from pathlib import Path

        events = [
            {"type": "step.progress", "step": "01-collect-urls"},
            {"type": "step.progress", "step": "04-frames", "skipped": True},
            {"type": "step.progress", "step": "03-transcript"},
        ]
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "m.json"
            write_run_manifest("Succeeded", path, events=events)
            payload = json.loads(path.read_text())
        names = [event["name"] for event in payload["stepEvents"]]
        self.assertIn("Step 1 (URL Collection)", names)
        self.assertIn("Step 4 (Heatmap & Frames)", names)
        self.assertIn("Step 3+4 (Transcript+Frames+Context)", names)
        skipped = next(event for event in payload["stepEvents"] if event["status"] == "optional_skipped")
        self.assertEqual(skipped["reason"], "경량 모드(SKIP_HEAVY_COMPUTE) — 로컬 머신에서 실행")
    def test_queue_enqueue_drain_and_dry_run_not_escalated(self) -> None:
        import os
        import tempfile
        from pathlib import Path
        from backend.pipeline_control import queue as queue_mod
        from backend.pipeline_control.live_run import run_once
        from backend.pipeline_control.store import MemoryStore

        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "q.jsonl"
            queue_mod.enqueue({"target": "tzuyang", "dry_run": True}, path)
            queue_mod.enqueue({"target": "tzuyang", "dry_run": True}, path)
            rows = queue_mod.drain(path)
            self.assertEqual(len(rows), 2)
            self.assertEqual(queue_mod.drain(path), [])
            os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
            os.environ["TZUDONG_DATA_ENV"] = "local_db"
            seen: list[list[str]] = []
            store = MemoryStore(clock=lambda: 1_000.0)
            result = run_once(
                store,
                target="tzuyang",
                index=1,
                live=True,
                runner=lambda argv: seen.append(argv) or 0,
                queued_dry_run=True,
            )
            self.assertEqual(result, "Succeeded")
            self.assertEqual(seen, [])
            poison = path
            poison.write_text("{not-json\n{\"target\":\"tzuyang\",\"dry_run\":true}\n")
            recovered = queue_mod.drain(path)
            self.assertEqual(len(recovered), 1)
    def test_monitor_has_nowork_short_circuit(self) -> None:
        from pathlib import Path

        source = Path("backend/bin/run_daily_monitor_daemon.sh").read_text(encoding="utf-8")
        self.assertIn("recent_success_manifest", source)
        self.assertIn("no-work short-circuit", source)
        self.assertIn("TZUDONG_PIPELINE_LIVE=\"${TZUDONG_PIPELINE_LIVE:-0}\"", source)
        self.assertIn('payload.get("executionMode") != "live"', source)
        self.assertIn('payload.get("dataSink") != "local_db"', source)
        self.assertIn('payload.get("liveExecutionSucceeded") is not True', source)
    def test_file_store_shared_across_instances(self) -> None:
        import tempfile
        from pathlib import Path
        from backend.pipeline_control.file_store import FileStore

        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "store.json"
            first = FileStore(path, clock=lambda: 1_000.0)
            run, created = first.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="filestore01",
                payload={},
                actor="qa",
                request_id="req-fs",
            )
            self.assertTrue(created)
            second = FileStore(path, clock=lambda: 1_001.0)
            loaded = second.get(run.id)
            self.assertEqual(loaded.status, "Queued")
            self.assertEqual(loaded.idempotency_key, "filestore01")
            claimed = second.claim()
            self.assertIsNotNone(claimed)
            self.assertEqual(claimed.id, run.id)
            self.assertEqual(claimed.status, "Fetching")
            third = FileStore(path, clock=lambda: 1_002.0)
            again = third.get(run.id)
            self.assertEqual(again.status, "Fetching")


if __name__ == "__main__":
    unittest.main()
