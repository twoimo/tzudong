"""Property-based tests for Publish_Worker batch-split invariants (Property 21).

Feature: platform-modernization, Property 21: 배치 분할 불변식.
Validates: Requirements 10.9, 10.16.

Property 21 (design C6 / D6). For every publish input row count the
``PublishWorker.apply`` batch plan and its sequential execution satisfy three
invariants:

  * Batch bound (Requirement 10.9). Every apply call carries at most
    ``BATCH_LIMIT`` (200) rows; an input larger than the limit is split into
    sequential batches, never a single over-limit call.
  * Union preservation (Requirement 10.9). On the success path the rows applied
    across all batches, concatenated in call order, equal the projected input
    rows exactly — no row is lost, duplicated, or reordered.
  * Abort discipline (Requirement 10.16). When a batch fails at plan index ``k``
    the job returns ``publish_apply_aborted``; exactly ``k`` batches complete,
    the failing batch is the last one started, no batch after ``k`` is ever
    started, the completed / uncompleted batch counts stay consistent with the
    plan size, and completed batches retain readback and audit.

The test drives the real ``PublishWorker.apply`` (Task 14) against the real
committed ``backend/deploy/publication-set.v1.json`` ledger, using an in-memory
hosted model injected through ``hosted_apply`` / ``hosted_read`` (adapted from
``test_publish_apply_unittest.FakeHosted``). No database is touched and no
hosted write is performed. Row counts are generated across the batch boundaries
(0..600) together with a random failing-batch index.

Runnable via ``python -m unittest backend.pipeline_control.test_publish_batch_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import json
import math
import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.batch_upsert import BATCH_LIMIT
from backend.pipeline_control.publish_worker import (
    PUBLISH_APPLY_ABORTED,
    HostedApplyFailure,
    PublicationSet,
    PublicationTable,
    PublishWorker,
)
from backend.pipeline_control.tests.publication_fixtures import (
    ACTIVE_TEST_SCHEDULE,
    APPROVED_TEST_PUBLICATION_SET,
)

# The real committed Publication_Set ledger (design D5). Loaded once so the
# generator draws only enumerated columns and the batch plan is exercised
# against the authoritative allowlist.
_PUBLICATION_SET: PublicationSet = APPROVED_TEST_PUBLICATION_SET

# Property 21 is table-agnostic (it concerns batch splitting of a confirmed row
# set), so a single enumerated table keeps the plan a clean linear sequence of
# batches. ``public.videos`` has a single identity key, which makes unique
# identities and multiset comparison straightforward.
_TABLE: PublicationTable = _PUBLICATION_SET.tables["public.videos"]
_TABLE_KEY = _TABLE.key

# A benign scalar alphabet that can never contain the marker token
# ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` (no ':' and no uppercase), so no generated
# row is ever dropped as a local-test marker row.
_BENIGN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "
_scalar_value = st.one_of(
    st.text(alphabet=_BENIGN_ALPHABET, max_size=8),
    st.integers(min_value=-1_000, max_value=1_000),
    st.booleans(),
    st.none(),
)


def _canonical(row: dict[str, Any]) -> str:
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _projected(row: dict[str, Any]) -> dict[str, Any]:
    """Project a row exactly as the worker does: identity + published columns, sorted keys."""

    return {key: row[key] for key in sorted(row.keys())}


class FakeHosted:
    """In-memory hosted model with a per-index injectable batch failure.

    Adapted from ``test_publish_apply_unittest.FakeHosted``. ``apply`` records
    each call's row count, raises ``HostedApplyFailure`` when its call index
    equals ``fail_on_batch`` (so the worker aborts per Requirement 10.16), and
    otherwise stores the rows and returns inserted/updated counts. ``read``
    returns the stored rows so the success-path readback matches.
    """

    def __init__(self, identity_keys: tuple[str, ...]) -> None:
        self.identity_keys = identity_keys
        self.store: dict[tuple, dict] = {}
        self.apply_calls: list[int] = []
        self.applied_rows: list[dict] = []
        self.fail_on_batch: int | None = None

    def _sig(self, row: dict) -> tuple:
        return tuple(row.get(k) for k in self.identity_keys)

    def apply(self, table_key: str, rows: list[dict]) -> dict:
        index = len(self.apply_calls)
        self.apply_calls.append(len(rows))
        if self.fail_on_batch is not None and index == self.fail_on_batch:
            raise HostedApplyFailure()
        inserted = 0
        updated = 0
        for row in rows:
            self.applied_rows.append(dict(row))
            sig = self._sig(row)
            if sig in self.store:
                updated += 1
            else:
                inserted += 1
            self.store[sig] = dict(row)
        return {
            "inserted_count": inserted,
            "updated_count": updated,
            "readback": [dict(r) for r in rows],
        }

    def read(self, table_key: str, signatures: list[tuple]) -> list[dict]:
        out: list[dict] = []
        for sig in signatures:
            row = self.store.get(sig)
            if row is not None:
                out.append(dict(row))
        return out


def _request(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "publishJobId": "job-batch-prop",
        "tables": [{"schema": _TABLE.schema, "table": _TABLE.table, "rows": rows}],
    }


# An active schedule so the schedule gate never blocks apply; batch behavior is
# what this property exercises.
_ACTIVE_SCHEDULE = ACTIVE_TEST_SCHEDULE


@st.composite
def batch_split_cases(draw: st.DrawFn) -> dict[str, Any]:
    """Generate a row set spanning batch boundaries plus an optional failing batch.

    ``row_count`` is drawn from ``0..600`` (three full batches at the 200-row
    limit) so the split is exercised below, at, and across multiple batch
    boundaries. Each row carries the identity key plus a random subset of
    published columns with benign scalar values, and identities are unique so
    the multiset of applied rows is unambiguous. When ``inject_failure`` is set
    and at least one batch exists, ``failing_index`` picks a plan batch index in
    ``0..total_batches-1`` to fail.
    """

    published = sorted(_TABLE.published_columns)
    row_count = draw(st.integers(min_value=0, max_value=600))

    rows: list[dict[str, Any]] = []
    for i in range(row_count):
        row: dict[str, Any] = {_TABLE.identity_keys[0]: i + 1}
        if published:
            for col in draw(
                st.lists(
                    st.sampled_from(published),
                    unique=True,
                    min_size=1,
                    max_size=len(published),
                )
            ):
                row[col] = draw(_scalar_value)
        rows.append(row)

    total_batches = math.ceil(row_count / BATCH_LIMIT) if row_count else 0
    inject_failure = draw(st.booleans())
    if inject_failure and total_batches > 0:
        failing_index: int | None = draw(
            st.integers(min_value=0, max_value=total_batches - 1)
        )
    else:
        failing_index = None

    return {
        "rows": rows,
        "row_count": row_count,
        "total_batches": total_batches,
        "failing_index": failing_index,
    }


class PublishBatchSplitPropertyTests(unittest.TestCase):
    # Feature: platform-modernization, Property 21: 배치 분할 불변식
    # Validates: Requirements 10.9, 10.16
    @settings(max_examples=100, deadline=None)
    @given(case=batch_split_cases())
    def test_property_21_batch_split_invariants(self, case: dict[str, Any]) -> None:
        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        hosted = FakeHosted(_TABLE.identity_keys)
        rows = case["rows"]
        total_batches = case["total_batches"]

        preview = worker.preview(_request(rows), now=0.0).preview
        self.assertIsNotNone(preview)

        if case["failing_index"] is not None:
            hosted.fail_on_batch = case["failing_index"]

        result = worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )

        # Invariant 1 — every apply call carries at most BATCH_LIMIT rows (10.9).
        for n in hosted.apply_calls:
            self.assertLessEqual(n, BATCH_LIMIT)

        if case["failing_index"] is None:
            # -- Success path: union preserved, order preserved (10.9) -----
            self.assertTrue(result.succeeded)
            self.assertIsNone(result.code)
            self.assertEqual(result.completed_batch_count, total_batches)
            self.assertEqual(result.uncompleted_batch_count, 0)
            self.assertEqual(len(hosted.apply_calls), total_batches)
            # No row lost or duplicated: batch row counts sum to the input.
            self.assertEqual(sum(hosted.apply_calls), case["row_count"])
            # Concatenation of applied rows in call order equals the projected
            # input rows in order (union preservation + order preservation).
            expected = [_projected(r) for r in rows]
            self.assertEqual(hosted.applied_rows, expected)
            # Multiset equality is implied but asserted explicitly for clarity.
            self.assertEqual(
                sorted(_canonical(r) for r in hosted.applied_rows),
                sorted(_canonical(r) for r in expected),
            )
        else:
            # -- Abort path: no subsequent batch starts (10.16) ------------
            k = case["failing_index"]
            self.assertFalse(result.succeeded)
            self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)
            # Exactly k batches completed before the failing batch.
            self.assertEqual(result.completed_batch_count, k)
            # Completed + uncompleted counts stay consistent with the plan.
            self.assertEqual(result.uncompleted_batch_count, total_batches - k)
            self.assertEqual(
                result.completed_batch_count + result.uncompleted_batch_count,
                total_batches,
            )
            # The failing batch is the last one started; none after it starts.
            self.assertEqual(len(hosted.apply_calls), k + 1)
            self.assertEqual(sum(r.matched_row_count for r in result.readback_records), k * BATCH_LIMIT)
            self.assertEqual(sum(r.mismatched_row_count for r in result.readback_records), 0)

    # Feature: platform-modernization, Property 21: 배치 분할 불변식
    # Validates: Requirement 10.9
    def test_batch_boundaries_split_at_the_limit(self) -> None:
        """Explicit boundary examples: 0, 199, 200, 201, 400, 600 rows."""

        expectations = {
            0: [],
            199: [199],
            200: [200],
            201: [200, 1],
            400: [200, 200],
            600: [200, 200, 200],
        }
        for row_count, expected_calls in expectations.items():
            worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
            hosted = FakeHosted(_TABLE.identity_keys)
            rows = [{"id": i + 1, "title": "t"} for i in range(row_count)]
            preview = worker.preview(_request(rows), now=0.0).preview
            result = worker.apply(
                preview,
                _request(rows),
                preview.preview_hash,
                hosted_apply=hosted.apply,
                hosted_read=hosted.read,
                schedule=_ACTIVE_SCHEDULE,
                now=1.0,
            )
            self.assertTrue(result.succeeded, f"row_count={row_count}")
            self.assertEqual(
                hosted.apply_calls, expected_calls, f"row_count={row_count}"
            )
            self.assertEqual(sum(hosted.apply_calls), row_count)

    # Feature: platform-modernization, Property 21: 배치 분할 불변식
    # Validates: Requirement 10.16
    def test_failure_at_middle_batch_stops_subsequent(self) -> None:
        """Explicit example: failing the second of three batches starts no third."""

        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        hosted = FakeHosted(_TABLE.identity_keys)
        rows = [{"id": i + 1, "title": "t"} for i in range(600)]
        hosted.fail_on_batch = 1
        preview = worker.preview(_request(rows), now=0.0).preview
        result = worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)
        self.assertEqual(result.completed_batch_count, 1)
        self.assertEqual(result.uncompleted_batch_count, 2)
        # Two calls only (batch 0 completed, batch 1 failed, batch 2 never starts).
        self.assertEqual(len(hosted.apply_calls), 2)
        self.assertEqual(result.readback_records[0].matched_row_count, 200)


if __name__ == "__main__":
    unittest.main()
