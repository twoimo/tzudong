"""Live adapter (injected runner) and cutover gate."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control.adapter import execute_steps
from backend.pipeline_control.cutover import plan_cutover
from backend.pipeline_control.manifest import record_parity_attempt
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one, write_run_manifest


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
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "current-summary.json"
            process_one(store, live=True, runner=lambda argv: seen.append(argv) or 0, manifest_path=path)
            self.assertEqual(seen, [])
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["finalStatus"], "OK")

    def test_cutover_refused_without_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger = Path(raw) / "ledger.json"
            record_parity_attempt(ledger, matched=True)
            with self.assertRaises(PermissionError):
                plan_cutover(ledger)
            record_parity_attempt(ledger, matched=True)
            record_parity_attempt(ledger, matched=True)
            planned = plan_cutover(ledger)
            self.assertTrue(planned["allowed"])

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
