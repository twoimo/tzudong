"""Property-based tests for Publish_Worker idempotent convergence (Property 22).

Feature: platform-modernization, Property 22: 게시 멱등 수렴.
Validates: Requirement 10.11.

Property 22 (design C6). For every admitted publish input set, applying the
same input twice against the same hosted store converges: the observable hosted
state after the second apply equals the state after the first apply. Concretely
the property asserts, for every generated input set:

  * First apply succeeds and populates the hosted store. Every row is a fresh
    insert, so ``applied_insert_count`` equals the total input row count and the
    per-table stored row count equals the number of distinct identity keys.
  * Second identical apply converges (Requirement 10.11, design C6). Each batch
    hits a compare-and-set conflict, the worker re-reads, finds the hosted
    Publication_Set values already equal the intended values, and records the
    batch ``converged_no_op`` — the job still succeeds
    (``succeeded=True``, ``code=None``), applies zero inserts
    (``applied_insert_count == 0``), and its ``converged_no_op_count`` equals
    the total row count. No spurious ``publish_apply_aborted`` is returned.
  * One-apply image == two-apply image. The hosted store's
    ``(identity key -> Publication_Set column values)`` mapping and per-table
    row count after the second apply equal those after the first apply.

The generator ``publish_inputs()`` draws admitted rows (identity + published
columns only, unique identity keys, no ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` marker
rows) across the real committed ``backend/deploy/publication-set.v1.json``
ledger. The hosted side is an in-memory model with compare-and-set semantics
adapted from ``test_publish_apply_unittest.FakeHosted``: a wholly-identical
second apply of a batch raises ``HostedApplyConflict`` (mirroring the RPC's
``updated_at`` CAS), which is exactly the path Requirement 10.11 convergence
must absorb. No database is touched and no hosted write is performed.

Runnable via
``python -m unittest backend.pipeline_control.test_publish_idempotency_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.publish_worker import (
    PUBLISH_APPLY_ABORTED,
    RESULT_CONVERGED_NO_OP,
    HostedApplyConflict,
    PublicationSet,
    PublishWorker,
    load_publication_set,
)

# The real committed Publication_Set ledger (design D5). Loaded once so the
# generator draws only enumerated tables/columns and the property is checked
# against the authoritative allowlist.
_PUBLICATION_SET: PublicationSet = load_publication_set()
_TABLE_KEYS = sorted(_PUBLICATION_SET.tables)

# An active operator-approved schedule so the schedule gate never blocks apply;
# idempotent convergence is what this property exercises, not the gate.
_ACTIVE_SCHEDULE = {"approval": {"status": "approved"}}

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


def _identity_keys(table_key: str) -> tuple[str, ...]:
    return _PUBLICATION_SET.tables[table_key].identity_keys


def _sig(table_key: str, row: dict[str, Any]) -> tuple:
    return tuple(row.get(k) for k in _identity_keys(table_key))


def _projected(row: dict[str, Any]) -> dict[str, Any]:
    """Project a row exactly as the worker does: keys sorted, values unchanged."""

    return {key: row[key] for key in sorted(row.keys())}


class FakeHosted:
    """In-memory hosted model with batch compare-and-set semantics.

    Adapted from ``test_publish_apply_unittest.FakeHosted``. ``apply`` stores a
    batch keyed by identity signature and returns inserted/updated counts. A
    second, wholly-identical apply of a batch (every row's signature already
    present with an equal stored value) raises ``HostedApplyConflict`` — this
    mirrors the RPC's ``updated_at`` CAS and is the conflict the worker's
    convergence path must absorb. ``read`` returns the stored rows so the
    re-read finds the already-converged values.
    """

    def __init__(self, identity_keys_by_table: dict[str, tuple[str, ...]]) -> None:
        self.identity_keys = identity_keys_by_table
        self.store: dict[str, dict[tuple, dict]] = {}
        self.apply_calls: list[tuple[str, int]] = []

    def _sig(self, table_key: str, row: dict) -> tuple:
        return tuple(row.get(k) for k in self.identity_keys[table_key])

    def apply(self, table_key: str, rows: list[dict]) -> dict:
        self.apply_calls.append((table_key, len(rows)))
        table = self.store.setdefault(table_key, {})
        all_identical = bool(rows) and all(
            self._sig(table_key, r) in table
            and table[self._sig(table_key, r)] == dict(r)
            for r in rows
        )
        if all_identical:
            # A wholly-identical re-apply of this batch: the RPC's CAS rejects
            # it (design C6). The worker must re-read and converge.
            raise HostedApplyConflict()
        inserted = 0
        updated = 0
        for row in rows:
            sig = self._sig(table_key, row)
            if sig in table:
                updated += 1
            else:
                inserted += 1
            table[sig] = dict(row)
        return {
            "inserted_count": inserted,
            "updated_count": updated,
            "readback": [dict(r) for r in rows],
        }

    def read(self, table_key: str, signatures: list[tuple]) -> list[dict]:
        table = self.store.get(table_key, {})
        out: list[dict] = []
        for sig in signatures:
            row = table.get(sig)
            if row is not None:
                out.append(dict(row))
        return out

    def snapshot(self) -> dict[str, dict[tuple, dict]]:
        """Deep copy of the store: the observable hosted state image."""

        return copy.deepcopy(self.store)


@st.composite
def publish_inputs(draw: st.DrawFn) -> dict[str, Any]:
    """Generate an admitted publish input set across the real Publication_Set.

    Draws a non-empty subset of the enumerated tables. For each chosen table it
    draws a row count (spanning batch boundaries, 1..250) and builds rows with a
    unique integer identity key plus a random subset of published columns with
    benign scalar values. Unique identity keys keep the second apply a clean,
    wholly-identical re-apply so the compare-and-set convergence path is
    exercised unambiguously; the total row count is guaranteed to be at least 1.

    Returns a dict carrying the apply ``request``, the projected
    ``rows_by_table``, and the total ``row_count``.
    """

    chosen = draw(
        st.lists(st.sampled_from(_TABLE_KEYS), unique=True, min_size=1, max_size=len(_TABLE_KEYS))
    )

    table_entries: list[dict[str, Any]] = []
    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    total_rows = 0
    for table_key in sorted(chosen):
        pub_table = _PUBLICATION_SET.tables[table_key]
        published = sorted(pub_table.published_columns)
        row_count = draw(st.integers(min_value=1, max_value=250))
        rows: list[dict[str, Any]] = []
        for i in range(row_count):
            row: dict[str, Any] = {pub_table.identity_keys[0]: i + 1}
            if published:
                for col in draw(
                    st.lists(
                        st.sampled_from(published),
                        unique=True,
                        max_size=len(published),
                    )
                ):
                    row[col] = draw(_scalar_value)
            rows.append(row)
        rows_by_table[table_key] = [_projected(r) for r in rows]
        total_rows += row_count
        table_entries.append(
            {"schema": pub_table.schema, "table": pub_table.table, "rows": rows}
        )

    request = {"publishJobId": "job-idempotency-prop", "tables": table_entries}
    return {
        "request": request,
        "rows_by_table": rows_by_table,
        "row_count": total_rows,
    }


def _publication_column_image(
    store: dict[str, dict[tuple, dict]]
) -> dict[str, dict[tuple, dict]]:
    """The observable (identity key -> Publication_Set column values) mapping.

    A stored row already carries only identity + published columns (the worker
    projects before applying and ``updated_at`` is not in the Publication_Set),
    so the stored image is exactly the Publication_Set-column image.
    """

    return {
        table_key: {sig: dict(row) for sig, row in table.items()}
        for table_key, table in store.items()
    }


class PublishIdempotentConvergencePropertyTests(unittest.TestCase):
    # Feature: platform-modernization, Property 22: 게시 멱등 수렴
    # Validates: Requirement 10.11
    @settings(max_examples=100, deadline=None)
    @given(publish_input=publish_inputs())
    def test_property_22_idempotent_convergence(self, publish_input: dict[str, Any]) -> None:
        request = publish_input["request"]
        total_rows = publish_input["row_count"]

        worker = PublishWorker(publication_set=_PUBLICATION_SET)
        hosted = FakeHosted(
            {key: _identity_keys(key) for key in _PUBLICATION_SET.tables}
        )

        preview = worker.preview(request, now=0.0).preview
        self.assertIsNotNone(preview)

        # -- First apply: fresh inserts populate the hosted store ----------
        first = worker.apply(
            preview,
            request,
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )
        self.assertTrue(first.succeeded)
        self.assertIsNone(first.code)
        self.assertEqual(first.applied_insert_count, total_rows)
        self.assertEqual(first.converged_no_op_count, 0)

        # Hosted state is populated: per-table stored row count == distinct ids.
        for table_key, rows in publish_input["rows_by_table"].items():
            self.assertEqual(len(hosted.store.get(table_key, {})), len(rows))

        image_after_first = _publication_column_image(hosted.snapshot())

        # -- Second identical apply: converges, does not abort -------------
        # Re-preview against the untouched request; same input -> same hash.
        preview2 = worker.preview(request, now=2.0).preview
        self.assertEqual(preview2.preview_hash, preview.preview_hash)
        second = worker.apply(
            preview2,
            request,
            preview2.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=3.0,
        )

        # Convergence, not a spurious failure (Requirement 10.11, design C6).
        self.assertTrue(second.succeeded)
        self.assertIsNone(second.code)
        self.assertNotEqual(second.code, PUBLISH_APPLY_ABORTED)
        self.assertEqual(second.applied_insert_count, 0)
        self.assertEqual(second.applied_update_count, 0)
        self.assertEqual(second.converged_no_op_count, total_rows)
        # Every apply batch of the second run was recorded converged_no_op.
        for record in second.batch_records:
            self.assertEqual(record.result_code, RESULT_CONVERGED_NO_OP)
            self.assertEqual(record.converged_no_op_count, record.row_count)
        # Readback still runs over every applied key and matches (no drift).
        for readback in second.readback_records:
            self.assertEqual(readback.mismatched_row_count, 0)
            self.assertEqual(readback.matched_row_count, readback.readback_row_count)

        # -- One-apply image == two-apply image (idempotent convergence) ---
        image_after_second = _publication_column_image(hosted.snapshot())
        self.assertEqual(image_after_second, image_after_first)
        # Per-table row counts are identical after one and two applies.
        for table_key in image_after_first:
            self.assertEqual(
                len(image_after_second[table_key]), len(image_after_first[table_key])
            )

    # Feature: platform-modernization, Property 22: 게시 멱등 수렴
    # Validates: Requirement 10.11
    def test_second_apply_across_multiple_batches_converges(self) -> None:
        """Explicit example: a >200-row input converges on every batch."""

        worker = PublishWorker(publication_set=_PUBLICATION_SET)
        hosted = FakeHosted(
            {key: _identity_keys(key) for key in _PUBLICATION_SET.tables}
        )
        rows = [{"id": i + 1, "title": "t"} for i in range(450)]  # 3 batches
        request = {
            "publishJobId": "job-idem-multibatch",
            "tables": [{"schema": "public", "table": "videos", "rows": rows}],
        }

        preview = worker.preview(request, now=0.0).preview
        first = worker.apply(
            preview,
            request,
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )
        self.assertTrue(first.succeeded)
        self.assertEqual(first.applied_insert_count, 450)
        image_after_first = _publication_column_image(hosted.snapshot())

        second = worker.apply(
            worker.preview(request, now=2.0).preview,
            request,
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=3.0,
        )
        self.assertTrue(second.succeeded)
        self.assertIsNone(second.code)
        self.assertEqual(second.converged_no_op_count, 450)
        self.assertEqual(second.applied_insert_count, 0)
        self.assertEqual(second.completed_batch_count, 3)
        # All three batches converged as no-ops.
        self.assertEqual(len(second.batch_records), 3)
        for record in second.batch_records:
            self.assertEqual(record.result_code, RESULT_CONVERGED_NO_OP)
        # Idempotent: the hosted image is byte-for-byte unchanged.
        self.assertEqual(_publication_column_image(hosted.snapshot()), image_after_first)


if __name__ == "__main__":
    unittest.main()
