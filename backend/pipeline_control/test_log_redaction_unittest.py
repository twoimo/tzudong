"""Unit tests for the Log_Pipeline Redaction_Boundary step (Task 23).

Covers Requirements 13.3, 13.5, 13.8, 13.9, 13.15:

- R13.3: every record passes through the Redaction_Boundary before the sink;
  a record that cannot be routed through as a JSON object is not forwarded.
- R13.5: Forbidden_Log_Field values become the shared fixed marker with no
  substring/length/hash of the original; same class -> same marker.
- R13.8: string 4096, entries 100, depth 8, serialized 65536-byte bounds; the
  depth is aligned to 8 via the wrapper WITHOUT editing privacy_log.py's shared
  ``DEFAULT_MAX_DEPTH = 6``; overflow gets the fixed ``TRUNCATED`` marker.
- R13.9: exception info is a bounded (<= 128 char) exception type name only.
- R13.15: on redaction exception or unsafe marker -> not forwarded, fixed code
  ``log_redaction_unsafe``.

The dedicated property-based tests for redaction leak (Property 28, Task 25.4)
and log bounds (Property 30, Task 25.6) are separate. These unit tests pin the
specific examples and edge cases.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from backend.pipeline_control import log_redaction
from backend.pipeline_control.log_pipeline import LogPipelineError
from backend.pipeline_control.log_redaction import (
    CODE_REDACTION_UNSAFE,
    MAX_SERIALIZED_BYTES,
    REDACTED,
    TRUNCATED,
    UNSAFE_MARKER,
    LogRedactionError,
    prepare_record_for_sink,
    redact_record,
)
from backend.utils import privacy_log


def _serialized(record: dict[str, object]) -> str:
    return json.dumps(record, sort_keys=True, separators=(",", ":"))


def _valid_contracted(**overrides: object) -> dict[str, object]:
    """An allowlisted-shape record as returned by enforce_record_contract."""
    record: dict[str, object] = {
        "component": "backend_runtime",
        "occurred_at": "2026-01-01T00:00:00.000Z",
        "correlation_id": "corr-0001",
        "severity": "info",
        "type": "run.lifecycle",
        "status": "started",
    }
    record.update(overrides)
    return record


class DepthAlignmentTests(unittest.TestCase):
    def test_shared_default_depth_is_not_edited(self) -> None:
        # The shared boundary default stays 6; alignment happens via the wrapper.
        self.assertEqual(privacy_log.DEFAULT_MAX_DEPTH, 6)
        self.assertEqual(log_redaction.MAX_DEPTH, 8)

    def test_depth_seven_survives_alignment_to_eight(self) -> None:
        # A value nested to depth 7 (beyond the shared default 6, within 8) must
        # survive as a container, not collapse to the max-depth marker.
        marker = "depth7-leaf"
        nested: dict[str, object] = {"status": marker}
        for _ in range(6):
            nested = {"status": nested}
        record = _valid_contracted(status=nested)

        result = redact_record(record)
        self.assertIn(marker, _serialized(result))
        self.assertNotIn("<max-depth>", _serialized(result))

    def test_depth_beyond_eight_is_bounded(self) -> None:
        marker = "too-deep-leaf"
        nested: dict[str, object] = {"status": marker}
        for _ in range(12):
            nested = {"status": nested}
        record = _valid_contracted(status=nested)

        result = redact_record(record)
        serialized = _serialized(result)
        self.assertIn("<max-depth>", serialized)
        self.assertNotIn(marker, serialized)


class ForbiddenFieldRedactionTests(unittest.TestCase):
    def test_email_value_is_redacted_to_fixed_marker(self) -> None:
        record = _valid_contracted(status="reach me at alice@example.com now")
        result = redact_record(record)
        self.assertNotIn("alice@example.com", _serialized(result))
        self.assertIn(REDACTED, result["status"])  # type: ignore[operator]

    def test_same_class_maps_to_same_marker(self) -> None:
        a = redact_record(_valid_contracted(status="mail a@b.com"))
        b = redact_record(_valid_contracted(status="mail c@d.net"))
        # Both emails collapse to the identical fixed marker token.
        self.assertEqual(
            str(a["status"]).replace("mail ", ""),
            str(b["status"]).replace("mail ", ""),
        )

    def test_marker_carries_no_substring_length_or_hash(self) -> None:
        secret = "correct-horse-battery-staple"
        record = _valid_contracted(status=f"token={secret}")
        serialized = _serialized(redact_record(record))
        self.assertNotIn(secret, serialized)
        # Marker is fixed text, independent of the original length.
        self.assertNotIn(str(len(secret)), str(redact_record(record)["status"]))
        self.assertIn(REDACTED, str(redact_record(record)["status"]))

    def test_rrn_and_phone_values_are_redacted(self) -> None:
        record = _valid_contracted(
            status="rrn 900101-1234567 phone 010-1234-5678",
        )
        serialized = _serialized(redact_record(record))
        self.assertNotIn("900101-1234567", serialized)
        self.assertNotIn("010-1234-5678", serialized)


class BoundsTests(unittest.TestCase):
    def test_string_over_4096_is_truncated_with_fixed_marker(self) -> None:
        record = _valid_contracted(status="A" * 5000)
        result = redact_record(record)
        value = str(result["status"])
        self.assertLessEqual(len(value), log_redaction.MAX_STRING_LENGTH)
        self.assertTrue(value.endswith(TRUNCATED))

    def test_entries_over_100_are_truncated(self) -> None:
        big = {f"k{i}": i for i in range(500)}
        record = _valid_contracted(status=big)
        result = redact_record(record)
        # The nested mapping is bounded to <= 100 entries.
        self.assertLessEqual(len(result["status"]), log_redaction.MAX_ENTRIES)  # type: ignore[arg-type]

    def test_serialized_over_65536_is_reduced_with_marker(self) -> None:
        # Many bounded strings whose aggregate serialization exceeds the limit.
        big = {f"k{i}": "B" * 4000 for i in range(100)}
        record = _valid_contracted(status=big)
        result = redact_record(record)
        self.assertLessEqual(
            len(_serialized(result).encode("utf-8")), MAX_SERIALIZED_BYTES
        )
        # Identity fields survive the reduction.
        self.assertEqual(result["component"], "backend_runtime")
        self.assertEqual(result["type"], "run.lifecycle")
        # Non-identity overflow value collapses to the fixed truncation marker.
        self.assertEqual(result["status"], TRUNCATED)

    def test_within_bounds_record_is_unchanged_in_shape(self) -> None:
        record = _valid_contracted(status="ok")
        result = redact_record(record)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(set(result), set(record))


class UnsafeMarkerTests(unittest.TestCase):
    def test_value_carrying_unsafe_marker_is_not_forwarded(self) -> None:
        record = _valid_contracted(status=f"prefix {UNSAFE_MARKER} suffix")
        with self.assertRaises(LogRedactionError) as ctx:
            redact_record(record)
        self.assertEqual(ctx.exception.code, CODE_REDACTION_UNSAFE)

    def test_redaction_exception_yields_bounded_fixed_code(self) -> None:
        class Boom(RuntimeError):
            pass

        with mock.patch.object(
            log_redaction, "sanitize_log_value", side_effect=Boom("secret-detail")
        ):
            with self.assertRaises(LogRedactionError) as ctx:
                redact_record(_valid_contracted())

        self.assertEqual(ctx.exception.code, CODE_REDACTION_UNSAFE)
        # Only a bounded exception type name is retained; no message leaks.
        self.assertEqual(ctx.exception.error_name, "Boom")
        self.assertNotIn("secret-detail", str(ctx.exception.error_name))
        self.assertLessEqual(len(str(ctx.exception.error_name)), 128)

    def test_non_dict_sanitized_result_is_not_forwarded(self) -> None:
        # A list input sanitizes to a list, which is not a forwardable record.
        with self.assertRaises(LogRedactionError) as ctx:
            redact_record(["not", "a", "record"])  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.code, CODE_REDACTION_UNSAFE)


class PrepareRecordForSinkTests(unittest.TestCase):
    def test_valid_record_is_gated_then_redacted(self) -> None:
        raw = {
            "component": "backend_runtime",
            "occurred_at": "2026-01-01T00:00:00.000Z",
            "correlation_id": "corr-1",
            "severity": "info",
            "type": "run.lifecycle",
            "job_id": "job-1",
            "status": "started",
            "password": "hunter2",  # dropped by the allowlist gate
            "email": "a@b.com",  # dropped by the allowlist gate
        }
        result = prepare_record_for_sink(raw)
        self.assertNotIn("password", result)
        self.assertNotIn("email", result)
        self.assertNotIn("hunter2", _serialized(result))
        self.assertNotIn("a@b.com", _serialized(result))
        self.assertEqual(result["job_id"], "job-1")

    def test_output_keys_are_subset_of_class_allowlist(self) -> None:
        from backend.pipeline_control.log_pipeline import LOG_RECORD_CLASS_ALLOWLIST

        raw = _valid_contracted(job_id="job-1", injected="x", status="B" * 9000)
        result = prepare_record_for_sink(raw)
        self.assertTrue(
            set(result).issubset(LOG_RECORD_CLASS_ALLOWLIST["run.lifecycle"])
        )

    def test_contract_field_missing_propagates_unchanged(self) -> None:
        raw = _valid_contracted()
        del raw["severity"]
        with self.assertRaises(LogPipelineError) as ctx:
            prepare_record_for_sink(raw)
        self.assertEqual(ctx.exception.code, "log_record_field_missing")

    def test_contract_unknown_class_propagates_unchanged(self) -> None:
        with self.assertRaises(LogPipelineError) as ctx:
            prepare_record_for_sink(_valid_contracted(type="nope.unknown"))
        self.assertEqual(ctx.exception.code, "log_record_class_unknown")


if __name__ == "__main__":
    unittest.main()
