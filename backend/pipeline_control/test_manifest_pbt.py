"""Property-based tests for the Run_Manifest health/observability layer (R5).

Feature: crawler-pipeline-orchestration (design Properties 16, 17, 18, 19, 21, 22).

These exercise the pure manifest helpers in ``backend.pipeline_control.manifest`` and the
``backend.pipeline_control.worker.write_run_manifest`` writer, driven against a temporary
manifest path with an in-memory :class:`RunRecord`. No live Supabase, network, or hosted I/O
is involved: every run is written in ``dry_run`` mode (or with a non-``local_db`` sink) so the
live-evidence snapshot path is never entered.

Runnable via ``python -m unittest backend.pipeline_control.test_manifest_pbt``.
Requires ``hypothesis`` (use a throwaway venv if it is not installed).
"""

from __future__ import annotations

import json
import re
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.graph import CANONICAL_STEP_NAMES, SKIP_HEAVY_REASON
from backend.pipeline_control.manifest import (
    FINAL_STATUS_ERROR,
    FINAL_STATUS_OK,
    HOSTED_GATE_REJECTION_CODES,
    OPERATOR_SUMMARY_MAX_LENGTH,
    RUN_STATUS_FAILED,
    RUN_STATUS_SUCCEEDED,
    build_operator_summary,
    final_status_for,
)
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.worker import write_run_manifest

# Canonical manifest formats under test (R5.2).
GENERATED_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
DATE_FORMAT = "%Y-%m-%d"
_GENERATED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The four bounded stepEvents statuses accepted by the manifest schema validator.
STEP_EVENT_STATUSES = {"completed", "failed", "optional_skipped", "downstream_skipped"}

# Fixed skip-reason vocabulary distinguishing optional vs downstream skips (R5.4).
# Optional: a step deliberately not run under the lite profile or a missing target capability.
OPTIONAL_SKIP_REASONS = (
    SKIP_HEAVY_REASON,
    "target_lacks_map_url_capability",
    "target_lacks_frame_caption_capability",
    "target_lacks_chunk_capability",
)
# Downstream: skipped because an upstream required step failed or the sink forbade it.
DOWNSTREAM_SKIP_REASONS = (
    "artifact_only_skips_mutating_step",
    "target_lacks_insert_capability",
    "08-chunk skipped or failed",
    "09-target skipped or failed",
)
FIXED_SKIP_REASONS = frozenset(OPTIONAL_SKIP_REASONS + DOWNSTREAM_SKIP_REASONS)

# Heavy step slugs that map to distinct canonical names and do NOT trigger the writer's
# migrate-dedup (02-1-migrate/02-5-cleanup) or the transcript/frames group aggregation
# (03-transcript/03-1-context/04-frames). Safe skip candidates for Property 17/22.
HEAVY_SKIP_SLUGS = ("03-2-visual", "05-map-url", "06-frame-caption", "08-chunk")
# Non-heavy required step slugs used as failed-step candidates for Property 19.
REQUIRED_STEP_SLUGS = ("01-collect-urls", "02-collect-meta", "06-1-enrich", "13-supabase-insert")

# Provider/secret markers that must never leak into any serialized manifest field (R5.9).
SECRET_MARKERS = (
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "-----BEGIN PRIVATE KEY-----",
    "Bearer aa.bb.cc-secret-token-value",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "operator@example.com",
    "password=hunter2",
    "Traceback (most recent call last):",
    "postgresql://user:pw@db.internal:5432/prod",
)

RUN_STATUSES = (
    RUN_STATUS_SUCCEEDED,
    RUN_STATUS_FAILED,
    "Cancelled",
    "Paused",
)
EXECUTION_MODES = ("dry_run", "live")
# Sinks that never enter the live local-db snapshot path in write_run_manifest.
SAFE_DATA_SINKS = (None, "artifact_only", "hosted_apply")


def make_run(profile: str = "heavy_local", target: str = "tzuyang") -> RunRecord:
    """Build a minimal in-memory RunRecord for driving write_run_manifest."""
    return RunRecord(
        id="job-0000",
        target=target,
        profile=profile,  # type: ignore[arg-type]
        status="Succeeded",
        idempotency_key="idem-key",
        payload_hash="0" * 64,
        actor="worker",
        request_id="req-0000",
        lease_until=0.0,
        heartbeat_at=0.0,
    )


class ManifestPropertyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.manifest_path = Path(self._tmp.name) / "current-summary.json"

    def _write(self, run_status: str, **kwargs) -> dict:
        write_run_manifest(run_status, self.manifest_path, **kwargs)
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))

    # Feature: crawler-pipeline-orchestration, Property 16: Manifest timestamps are UTC in a fixed format.
    # Validates: Requirements 5.2
    @settings(max_examples=100)
    @given(
        run_status=st.sampled_from(RUN_STATUSES),
        execution_mode=st.sampled_from(EXECUTION_MODES),
        data_sink=st.sampled_from((None, "artifact_only")),
    )
    def test_property_16_timestamps_are_utc_fixed_format(
        self, run_status: str, execution_mode: str, data_sink: str | None
    ) -> None:
        payload = self._write(
            run_status,
            run=make_run(),
            execution_mode=execution_mode,
            data_sink=data_sink,
        )
        generated_at = payload["generatedAt"]
        date = payload["date"]

        # generatedAt matches the fixed %Y-%m-%dT%H:%M:%SZ UTC pattern and round-trips.
        self.assertRegex(generated_at, _GENERATED_AT_RE)
        parsed_ts = datetime.strptime(generated_at, GENERATED_AT_FORMAT)
        self.assertEqual(parsed_ts.strftime(GENERATED_AT_FORMAT), generated_at)

        # date matches the fixed %Y-%m-%d UTC pattern and round-trips.
        self.assertRegex(date, _DATE_RE)
        parsed_date = datetime.strptime(date, DATE_FORMAT)
        self.assertEqual(parsed_date.strftime(DATE_FORMAT), date)

        # The two UTC values agree on the calendar day (both derived from the same clock).
        self.assertEqual(generated_at[: len(date)], date)

    # Feature: crawler-pipeline-orchestration, Property 17: Skipped steps carry a fixed-vocabulary reason.
    # Validates: Requirements 5.4
    @settings(max_examples=100)
    @given(
        skips=st.lists(
            st.tuples(
                st.sampled_from(HEAVY_SKIP_SLUGS),
                st.sampled_from(("optional", "downstream")),
            ),
            min_size=1,
            max_size=6,
        ),
        data=st.data(),
    )
    def test_property_17_skipped_steps_fixed_vocabulary(self, skips, data) -> None:
        events = []
        expected_optional = 0
        expected_downstream = 0
        for slug, kind in skips:
            if kind == "downstream":
                reason = data.draw(st.sampled_from(DOWNSTREAM_SKIP_REASONS))
                expected_downstream += 1
            else:
                reason = data.draw(st.sampled_from(OPTIONAL_SKIP_REASONS))
                expected_optional += 1
            events.append(
                {
                    "type": "step.progress",
                    "step": slug,
                    "skipped": True,
                    "skipKind": kind,
                    "reason": reason,
                }
            )

        payload = self._write(
            "Succeeded",
            events=events,
            run=make_run(profile="lite_gha"),
            execution_mode="dry_run",
            data_sink="artifact_only",
        )

        skip_events = [
            event
            for event in payload["stepEvents"]
            if event["status"] in {"optional_skipped", "downstream_skipped"}
        ]
        # Every skipped step carries exactly one of the two skip statuses with a
        # fixed-vocabulary, non-empty reason.
        for event in skip_events:
            self.assertIn(event["status"], {"optional_skipped", "downstream_skipped"})
            reason = event.get("reason")
            self.assertIsInstance(reason, str)
            self.assertIn(reason, FIXED_SKIP_REASONS)

        # Optional and downstream skips are distinguished, never conflated.
        optional_events = [e for e in skip_events if e["status"] == "optional_skipped"]
        downstream_events = [e for e in skip_events if e["status"] == "downstream_skipped"]
        self.assertEqual(len(optional_events), expected_optional)
        self.assertEqual(len(downstream_events), expected_downstream)
        self.assertEqual(len(payload["optionalSkips"]), expected_optional)
        self.assertEqual(len(payload["downstreamSkips"]), expected_downstream)

        # The optional/downstream slice lists reference the skip reason verbatim.
        for event in downstream_events:
            self.assertIn(
                f"{event['name']} - {event['reason']}", payload["downstreamSkips"]
            )
        for event in optional_events:
            self.assertIn(
                f"{event['name']} - {event['reason']}", payload["optionalSkips"]
            )

    # Feature: crawler-pipeline-orchestration, Property 18: Final status is Succeeded exclusive-or Failed.
    # Validates: Requirements 5.5
    @settings(max_examples=100)
    @given(
        run_status=st.one_of(
            st.sampled_from(RUN_STATUSES),
            st.text(max_size=16),
        ),
        execution_mode=st.sampled_from(EXECUTION_MODES),
        data_sink=st.sampled_from(SAFE_DATA_SINKS),
    )
    def test_property_18_final_status_ok_xor_error(
        self, run_status: str, execution_mode: str, data_sink: str | None
    ) -> None:
        mapped = final_status_for(run_status)
        # finalStatus is exactly one of the two values, mutually exclusive.
        self.assertIn(mapped, {FINAL_STATUS_OK, FINAL_STATUS_ERROR})
        self.assertEqual(mapped == FINAL_STATUS_OK, mapped != FINAL_STATUS_ERROR)
        # OK maps from Succeeded exclusively; everything else is ERROR.
        self.assertEqual(mapped == FINAL_STATUS_OK, run_status == RUN_STATUS_SUCCEEDED)

        payload = self._write(
            run_status,
            run=make_run(),
            execution_mode=execution_mode,
            data_sink=data_sink,
        )
        self.assertEqual(payload["finalStatus"], mapped)
        # The exit code agrees with the mutually-exclusive status (0 iff OK/Succeeded).
        self.assertEqual(payload["finalExitCode"] == 0, mapped == FINAL_STATUS_OK)
        self.assertIn(payload["finalStatus"], {FINAL_STATUS_OK, FINAL_STATUS_ERROR})

    # Feature: crawler-pipeline-orchestration, Property 19: Failed runs identify failed required steps by bounded id only.
    # Validates: Requirements 5.6
    @settings(max_examples=100)
    @given(
        failed_slug=st.sampled_from(REQUIRED_STEP_SLUGS),
        secret=st.sampled_from(SECRET_MARKERS),
        execution_mode=st.sampled_from(EXECUTION_MODES),
    )
    def test_property_19_failed_steps_bounded_id_only(
        self, failed_slug: str, secret: str, execution_mode: str
    ) -> None:
        # The lifecycle/progress events carry raw provider text in fields the writer
        # must never copy into the manifest.
        events = [
            {
                "type": "step.progress",
                "step": failed_slug,
                "skipped": False,
                "stderr": secret,
                "providerError": secret,
            },
            {
                "type": "run.lifecycle",
                "status": "Failed",
                "step": failed_slug,
                "error": secret,
                "stackTrace": secret,
            },
        ]
        payload = self._write(
            "Failed",
            events=events,
            run=make_run(),
            execution_mode=execution_mode,
            data_sink="artifact_only",
        )

        canonical = CANONICAL_STEP_NAMES[failed_slug]
        # The failed required step is recorded by its fixed canonical id.
        self.assertIn(canonical, payload["failedRequiredSteps"])
        self.assertTrue(
            all(name in CANONICAL_STEP_NAMES.values() for name in payload["failedRequiredSteps"])
        )

        # Its stepEvent carries a bounded outcome indicator from the fixed status set.
        failed_events = [e for e in payload["stepEvents"] if e["status"] == "failed"]
        self.assertTrue(failed_events)
        for event in payload["stepEvents"]:
            self.assertIn(event["status"], STEP_EVENT_STATUSES)

        # No raw provider error or stack trace reaches any manifest field.
        serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True)
        self.assertNotIn(secret, serialized)
        self.assertNotIn("Traceback", serialized)
        self.assertNotIn("stackTrace", serialized)

    # Feature: crawler-pipeline-orchestration, Property 21: Operator summary is bounded and complete.
    # Validates: Requirements 5.8
    @settings(max_examples=100)
    @given(
        final_status=st.sampled_from((FINAL_STATUS_OK, FINAL_STATUS_ERROR)),
        execution_mode=st.text(
            alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=20
        ),
        data_sink=st.text(
            alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=20
        ),
        failed_count=st.integers(min_value=0, max_value=999_999),
    )
    def test_property_21_operator_summary_bounded_and_complete(
        self,
        final_status: str,
        execution_mode: str,
        data_sink: str,
        failed_count: int,
    ) -> None:
        summary = build_operator_summary(
            final_status=final_status,
            execution_mode=execution_mode,
            data_sink=data_sink,
            failed_required_count=failed_count,
        )
        # Bounded to the fixed maximum length.
        self.assertLessEqual(len(summary), OPERATOR_SUMMARY_MAX_LENGTH)
        # Encodes final status, execution mode, data sink, and failed-required count.
        # (These bounded inputs never exceed the maximum, so nothing is truncated away.)
        self.assertIn(f"status={final_status}", summary)
        self.assertIn(f"mode={execution_mode}", summary)
        self.assertIn(f"sink={data_sink}", summary)
        self.assertIn(f"failedRequiredSteps={failed_count}", summary)

        # An adversarially long input is still clamped to the maximum length.
        overlong = build_operator_summary(
            final_status=final_status,
            execution_mode="m" * 1000,
            data_sink="s" * 1000,
            failed_required_count=failed_count,
        )
        self.assertLessEqual(len(overlong), OPERATOR_SUMMARY_MAX_LENGTH)

    # Feature: crawler-pipeline-orchestration, Property 22: Manifest excludes secrets and diagnostics.
    # Validates: Requirements 5.9
    @settings(max_examples=100)
    @given(
        run_status=st.sampled_from(RUN_STATUSES),
        execution_mode=st.sampled_from(EXECUTION_MODES),
        data_sink=st.sampled_from(SAFE_DATA_SINKS),
        skips=st.lists(
            st.tuples(
                st.sampled_from(HEAVY_SKIP_SLUGS),
                st.sampled_from(("optional", "downstream")),
            ),
            min_size=0,
            max_size=5,
        ),
        rejection_code=st.one_of(st.none(), st.sampled_from(sorted(HOSTED_GATE_REJECTION_CODES))),
        missed_window_count=st.integers(min_value=0, max_value=30),
        candidate_ids=st.lists(
            st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789_-", min_size=1, max_size=12),
            min_size=0,
            max_size=5,
        ),
        secret=st.sampled_from(SECRET_MARKERS),
        data=st.data(),
    )
    def test_property_22_manifest_excludes_secrets(
        self,
        run_status: str,
        execution_mode: str,
        data_sink: str | None,
        skips,
        rejection_code: str | None,
        missed_window_count: int,
        candidate_ids,
        secret: str,
        data,
    ) -> None:
        events = []
        for slug, kind in skips:
            reason = (
                data.draw(st.sampled_from(DOWNSTREAM_SKIP_REASONS))
                if kind == "downstream"
                else data.draw(st.sampled_from(OPTIONAL_SKIP_REASONS))
            )
            # Secret material is injected only into fields the writer must not copy.
            events.append(
                {
                    "type": "step.progress",
                    "step": slug,
                    "skipped": True,
                    "skipKind": kind,
                    "reason": reason,
                    "stderr": secret,
                    "providerDiagnostic": secret,
                }
            )

        # Reflection object with benign candidate ids plus dropped secret-bearing extras.
        reflection = {
            "applied": candidate_ids[:2],
            "skippedAlreadyPresent": candidate_ids[2:4],
            "unresolved": candidate_ids[4:],
            "secretToken": secret,
            "rawProviderPayload": {"credential": secret},
        }

        payload = self._write(
            run_status,
            events=events,
            run=make_run(),
            execution_mode=execution_mode,
            data_sink=data_sink,
            hosted_gate_rejection_code=rejection_code,
            missed_window_count=missed_window_count,
            reflection=reflection,
        )

        serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True)
        # No forbidden marker survives into any manifest field, including step outcomes,
        # skip reasons, and the reflection accounting object.
        for marker in SECRET_MARKERS:
            self.assertNotIn(marker, serialized)
        self.assertNotIn("stderr", serialized)
        self.assertNotIn("providerDiagnostic", serialized)
        self.assertNotIn("secretToken", serialized)
        self.assertNotIn("rawProviderPayload", serialized)

        # The reflection accounting is coerced to exactly the three bounded string lists.
        self.assertEqual(
            set(payload["reflection"]),
            {"applied", "skippedAlreadyPresent", "unresolved"},
        )
        # The bounded hosted-gate rejection code is either absent or from the closed set.
        self.assertIn(
            payload["hostedGateRejectionCode"],
            {None, *HOSTED_GATE_REJECTION_CODES},
        )


if __name__ == "__main__":
    unittest.main()
