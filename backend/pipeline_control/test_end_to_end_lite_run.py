"""End-to-end integration test for the lite run manifest and health outcome.

Covers task 12.2 (Requirements 5.1, 5.7, 8.5): a representative lite (``lite_gha``)
run is driven through ``worker.write_run_manifest`` to write a Run_Manifest at a
temp path, that manifest is fed through the health check, and the serialized
manifest and health report are asserted to be secret-free.

- R5.1: the manifest records final status, execution mode, data sink, compute
  profile, per-step outcomes, evidence sha256, and UTC timestamps, plus the
  additive orchestration fields (operator summary, cadence window, window
  overrun, missed-window count, reflection accounting, hosted-gate code).
- R5.7: a today-dated success manifest is healthy (``Succeeded``); a stale or
  absent manifest fails closed (``NotSucceeded``).
- R8.5: injected secret/credential/token/provider-diagnostic markers on the
  event stream's non-copied fields never survive into the serialized manifest
  or the health report.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from backend.pipeline_control.health import (
    REPORTED_STATUS_NOT_SUCCEEDED,
    REPORTED_STATUS_SUCCEEDED,
    build_health_report,
    write_health_report,
)
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import write_run_manifest

_GENERATED_AT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_SHA256_RE = re.compile(r"[0-9a-f]{64}")

# Fields Requirement 5.1 requires the manifest to record for a run.
_REQUIRED_5_1_FIELDS = (
    "finalStatus",
    "executionMode",
    "dataSink",
    "computeProfile",
    "stepEvents",
    "generatedAt",
    "date",
    "stepEvidenceSha256",
)
# Additive, bounded, secret-free orchestration fields.
_ADDITIVE_FIELDS = (
    "operatorSummary",
    "windowStart",
    "windowEnd",
    "windowOverrun",
    "missedWindowCount",
    "reflection",
    "hostedGateRejectionCode",
)

# Distinctive secret markers injected only on non-copied event fields (R8.5).
# write_run_manifest copies only ``type``/``status``/``step``/``skipped``/
# ``skipKind``/``reason`` from each event; any other key must be dropped.
_SECRET_MARKERS = (
    "SECRET_" + "ghp" + "_" + "AK" + "IAIOSFODNN7EXAMPLEKEY",
    "CREDENTIAL_supabase_service_role_jwt_zzz",
    "SESSIONTOKEN_onboarding_abcdef0123456789",
    "PROVIDERDIAGNOSTIC_pg_connection_refused_5432",
    "COOKIE_sb_access_token_leak_value",
)


def _representative_lite_run(store: MemoryStore):
    """Enqueue and claim a representative ``lite_gha`` run in an in-memory store."""

    run, _created = store.create_run(
        target="tzuyang",
        profile="lite_gha",
        idempotency_key="e2e-lite-run-12-2",
        payload={"limit": 1},
        actor="operator",
        request_id="req-e2e-lite-run",
    )
    return store.claim(run.id)


def _representative_lite_events() -> list[dict]:
    """Build a representative lite event stream mirroring execute_steps output.

    Under ``lite_gha`` the heavy frame/chunk steps are optional-skipped. Each
    event also carries extra, NON-COPIED keys seeded with secret markers to prove
    they never survive into the manifest (R8.5). The copied ``reason`` field is
    kept clean/bounded.
    """

    tainted = {
        "job_id": "run-1",
        "index": 0,
        "secretToken": _SECRET_MARKERS[0],
        "credential": _SECRET_MARKERS[1],
        "sessionToken": _SECRET_MARKERS[2],
        "providerDiagnostic": _SECRET_MARKERS[3],
        "cookie": _SECRET_MARKERS[4],
        "rawRequestBody": {"password": _SECRET_MARKERS[0]},
    }
    return [
        {"type": "step.progress", "step": "01-fetch", "skipped": False, **tainted},
        {"type": "step.progress", "step": "02-metadata", "skipped": False, **tainted},
        {"type": "step.progress", "step": "03-transcript", "skipped": False, **tainted},
        {
            "type": "step.progress",
            "step": "04-frames",
            "skipped": True,
            "skipKind": "optional",
            "reason": "heavy step skipped under lite_gha",
            **tainted,
        },
        {
            "type": "step.progress",
            "step": "08-chunk",
            "skipped": True,
            "skipKind": "optional",
            "reason": "heavy step skipped under lite_gha",
            **tainted,
        },
        {"type": "run.lifecycle", "status": "Succeeded", **tainted},
    ]


class EndToEndLiteRunTests(unittest.TestCase):
    def _write_manifest(self, tmp: str, run_status: str = "Succeeded") -> tuple[Path, dict]:
        store = MemoryStore()
        run = _representative_lite_run(store)
        self.assertIsNotNone(run)
        destination = Path(tmp) / "current-summary.json"
        written = write_run_manifest(
            run_status,
            destination,
            events=_representative_lite_events(),
            run=run,
            execution_mode="dry_run",
            data_sink="artifact_only",
            store=store,
        )
        self.assertEqual(written, destination)
        self.assertTrue(destination.is_file())
        manifest = json.loads(destination.read_text(encoding="utf-8"))
        return destination, manifest

    # -- R5.1 -----------------------------------------------------------------
    def test_lite_run_manifest_records_required_and_additive_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _destination, manifest = self._write_manifest(tmp)

        for field in _REQUIRED_5_1_FIELDS:
            self.assertIn(field, manifest, field)
        for field in _ADDITIVE_FIELDS:
            self.assertIn(field, manifest, field)

        # Core values reflect the representative lite run.
        self.assertEqual(manifest["finalStatus"], "OK")
        self.assertEqual(manifest["executionMode"], "dry_run")
        self.assertEqual(manifest["dataSink"], "artifact_only")
        self.assertEqual(manifest["computeProfile"], "lite_gha")

        # Per-step outcomes are a non-empty list of bounded name/status pairs,
        # and the heavy lite skips are recorded with the fixed skip vocabulary.
        self.assertIsInstance(manifest["stepEvents"], list)
        self.assertTrue(manifest["stepEvents"])
        statuses = set()
        for event in manifest["stepEvents"]:
            self.assertIn("name", event)
            self.assertIn("status", event)
            self.assertIsInstance(event["name"], str)
            statuses.add(event["status"])
        self.assertIn("completed", statuses)
        self.assertIn("optional_skipped", statuses)

        # UTC timestamps in the fixed formats; evidence sha256 is 64-hex.
        self.assertRegex(manifest["generatedAt"], _GENERATED_AT_RE)
        self.assertRegex(manifest["date"], _DATE_RE)
        self.assertRegex(manifest["stepEvidenceSha256"], _SHA256_RE)

        # Additive fields carry their bounded shapes.
        self.assertIsInstance(manifest["operatorSummary"], str)
        self.assertLessEqual(len(manifest["operatorSummary"]), 200)
        self.assertIn("status=OK", manifest["operatorSummary"])
        self.assertIn("sink=artifact_only", manifest["operatorSummary"])
        self.assertIsNone(manifest["hostedGateRejectionCode"])
        self.assertIsInstance(manifest["missedWindowCount"], int)
        self.assertGreaterEqual(manifest["missedWindowCount"], 0)
        self.assertIsInstance(manifest["windowOverrun"], bool)
        reflection = manifest["reflection"]
        self.assertIsInstance(reflection, dict)
        for key in ("applied", "skippedAlreadyPresent", "unresolved"):
            self.assertIn(key, reflection)
            self.assertIsInstance(reflection[key], list)
        # lite_gha resolves to the committed cadence config's KST HH:MM bounds.
        self.assertRegex(manifest["windowStart"], re.compile(r"[0-2][0-9]:[0-5][0-9]"))
        self.assertRegex(manifest["windowEnd"], re.compile(r"[0-2][0-9]:[0-5][0-9]"))

    # -- R5.7 -----------------------------------------------------------------
    def test_today_dated_success_manifest_is_healthy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination, manifest = self._write_manifest(tmp)
            today = datetime.strptime(manifest["date"], "%Y-%m-%d").date()

            # In-memory classification of the just-written manifest.
            report = build_health_report(manifest, today=today)
            self.assertTrue(report["healthy"])
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_SUCCEEDED)
            self.assertFalse(report["manifestStale"])
            self.assertTrue(report["manifestPresent"])
            self.assertEqual(report["finalStatus"], "OK")
            self.assertEqual(report["missedWindowCount"], 0)

            # Same outcome when read back from the written manifest file.
            health_path = Path(tmp) / "current-health.json"
            disk_report = write_health_report(destination, health_path, today=today)
            self.assertEqual(disk_report["reportedStatus"], REPORTED_STATUS_SUCCEEDED)
            self.assertEqual(
                json.loads(health_path.read_text(encoding="utf-8")), disk_report
            )

    def test_stale_manifest_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination, manifest = self._write_manifest(tmp)
            manifest_date = datetime.strptime(manifest["date"], "%Y-%m-%d").date()
            # Advance "today" past the manifest date so it reads as stale.
            later = manifest_date + timedelta(days=3)

            report = build_health_report(manifest, today=later)
            self.assertFalse(report["healthy"])
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
            self.assertTrue(report["manifestStale"])

            health_path = Path(tmp) / "current-health.json"
            disk_report = write_health_report(destination, health_path, today=later)
            self.assertEqual(
                disk_report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED
            )

    def test_absent_manifest_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "does-not-exist.json"
            health_path = Path(tmp) / "current-health.json"
            report = write_health_report(missing, health_path, today=None)
            self.assertFalse(report["healthy"])
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)
            self.assertFalse(report["manifestPresent"])
            self.assertTrue(report["manifestStale"])

    def test_today_dated_failure_fails_closed(self) -> None:
        # A failed run recorded today is still not-Succeeded (fail closed).
        with tempfile.TemporaryDirectory() as tmp:
            _destination, manifest = self._write_manifest(tmp, run_status="Failed")
            today = datetime.strptime(manifest["date"], "%Y-%m-%d").date()
            report = build_health_report(manifest, today=today)
            self.assertEqual(manifest["finalStatus"], "ERROR")
            self.assertFalse(report["healthy"])
            self.assertEqual(report["reportedStatus"], REPORTED_STATUS_NOT_SUCCEEDED)

    # -- R8.5 -----------------------------------------------------------------
    def test_manifest_and_health_report_are_secret_free(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            destination, manifest = self._write_manifest(tmp)
            today = datetime.strptime(manifest["date"], "%Y-%m-%d").date()
            health_path = Path(tmp) / "current-health.json"
            write_health_report(destination, health_path, today=today)

            manifest_text = destination.read_text(encoding="utf-8")
            health_text = health_path.read_text(encoding="utf-8")

            # No injected secret marker survives into the serialized evidence,
            # and none of the tainted event keys leak either.
            for marker in _SECRET_MARKERS:
                self.assertNotIn(marker, manifest_text, marker)
                self.assertNotIn(marker, health_text, marker)
            for leaked_key in (
                "secretToken",
                "credential",
                "sessionToken",
                "providerDiagnostic",
                "cookie",
                "rawRequestBody",
                "password",
            ):
                self.assertNotIn(leaked_key, manifest_text, leaked_key)
                self.assertNotIn(leaked_key, health_text, leaked_key)


if __name__ == "__main__":
    unittest.main()
