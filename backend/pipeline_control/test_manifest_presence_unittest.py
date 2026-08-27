"""Unit test for Run_Manifest presence and required fields at the fixed path.

Covers task 2.11 (Requirement 5.1): a representative run driven through
``worker.write_run_manifest`` writes ``current-summary.json`` at the fixed
location recording the required fields (final status, execution mode, data
sink, compute profile, per-step outcomes, evidence sha256, UTC timestamps) plus
the additive, bounded, secret-free orchestration fields (operator summary,
cadence window, window overrun, missed-window count, reflection accounting, and
the hosted-gate rejection code).

Placed in a NEW file to avoid conflicting with the property-test module.
Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import DEFAULT_MANIFEST, write_run_manifest

_GENERATED_AT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_SHA256_RE = re.compile(r"[0-9a-f]{64}")

# Fields that Requirement 5.1 requires the manifest to record for a run, plus
# the additive orchestration fields introduced by task 2.1.
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
_ADDITIVE_FIELDS = (
    "operatorSummary",
    "windowStart",
    "windowEnd",
    "windowOverrun",
    "missedWindowCount",
    "reflection",
    "hostedGateRejectionCode",
)


def _representative_run(store: MemoryStore):
    """Enqueue and claim a representative lite-profile run in an in-memory store."""

    run, _created = store.create_run(
        target="tzuyang",
        profile="lite_gha",
        idempotency_key="manifest-presence-2-11",
        payload={"limit": 1},
        actor="operator",
        request_id="req-manifest-presence",
    )
    return store.claim(run.id)


class ManifestPresenceTests(unittest.TestCase):
    def test_default_manifest_points_at_fixed_location(self) -> None:
        # R5.1: the fixed known location is backend/log/cron/current-summary.json.
        self.assertEqual(DEFAULT_MANIFEST.name, "current-summary.json")
        self.assertEqual(DEFAULT_MANIFEST.parent.name, "cron")
        self.assertEqual(DEFAULT_MANIFEST.parent.parent.name, "log")
        self.assertEqual(DEFAULT_MANIFEST.parent.parent.parent.name, "backend")
        self.assertEqual(
            DEFAULT_MANIFEST.parts[-4:],
            ("backend", "log", "cron", "current-summary.json"),
        )

    def test_representative_run_writes_manifest_with_required_fields(self) -> None:
        store = MemoryStore()
        run = _representative_run(store)
        self.assertIsNotNone(run)

        events = [
            {"type": "step.progress", "step": "01-fetch"},
            {"type": "step.progress", "step": "03-transcript"},
            {
                "type": "step.progress",
                "step": "04-frames",
                "skipped": True,
                "skipKind": "optional",
                "reason": "heavy step skipped under lite_gha",
            },
        ]

        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / "current-summary.json"
            written = write_run_manifest(
                "Succeeded",
                destination,
                events=events,
                run=run,
                execution_mode="dry_run",
                data_sink="local_db",
                store=store,
            )

            # 1) The manifest file is written at the given path.
            self.assertEqual(written, destination)
            self.assertTrue(destination.is_file())

            manifest = json.loads(destination.read_text(encoding="utf-8"))

        # 2) The written JSON contains the required Requirement 5.1 fields ...
        for field in _REQUIRED_5_1_FIELDS:
            self.assertIn(field, manifest, field)
        # ... and the additive orchestration fields.
        for field in _ADDITIVE_FIELDS:
            self.assertIn(field, manifest, field)

        # Core fields carry the representative run's values.
        self.assertEqual(manifest["finalStatus"], "OK")
        self.assertEqual(manifest["executionMode"], "dry_run")
        self.assertEqual(manifest["dataSink"], "local_db")
        self.assertEqual(manifest["computeProfile"], run.profile)

        # Per-step outcomes are recorded as a non-empty list of name/status pairs.
        self.assertIsInstance(manifest["stepEvents"], list)
        self.assertTrue(manifest["stepEvents"])
        for event in manifest["stepEvents"]:
            self.assertIn("name", event)
            self.assertIn("status", event)

        # UTC timestamps use the fixed formats.
        self.assertRegex(manifest["generatedAt"], _GENERATED_AT_RE)
        self.assertRegex(manifest["date"], _DATE_RE)

        # Evidence sha256 is a lowercase 64-hex digest.
        self.assertRegex(manifest["stepEvidenceSha256"], _SHA256_RE)

        # Additive fields have their bounded, secret-free shapes.
        self.assertIsInstance(manifest["operatorSummary"], str)
        self.assertLessEqual(len(manifest["operatorSummary"]), 200)
        self.assertIn("status=OK", manifest["operatorSummary"])

        self.assertIsNone(manifest["hostedGateRejectionCode"])

        self.assertIsInstance(manifest["missedWindowCount"], int)
        self.assertGreaterEqual(manifest["missedWindowCount"], 0)

        self.assertIsInstance(manifest["windowOverrun"], bool)

        reflection = manifest["reflection"]
        self.assertIsInstance(reflection, dict)
        for key in ("applied", "skippedAlreadyPresent", "unresolved"):
            self.assertIn(key, reflection)
            self.assertIsInstance(reflection[key], list)

        # windowStart/windowEnd are present; for the lite_gha runner they resolve
        # to the committed cadence config's KST HH:MM bounds.
        self.assertIsNotNone(manifest["windowStart"])
        self.assertIsNotNone(manifest["windowEnd"])
        self.assertRegex(manifest["windowStart"], re.compile(r"[0-2][0-9]:[0-5][0-9]"))
        self.assertRegex(manifest["windowEnd"], re.compile(r"[0-2][0-9]:[0-5][0-9]"))


if __name__ == "__main__":
    unittest.main()
