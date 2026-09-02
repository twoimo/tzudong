"""Property-based tests for Publish_Worker readback round-trip (Property 23).

Feature: platform-modernization, Property 23: 게시 리드백 라운드트립.
Validates: Requirements 10.7, 10.12, 10.15.

Property 23 (design C6). For every admitted publish input set, after the apply
phase runs against a faithful in-memory hosted model, the Publish_Readback that
re-reads every applied row-identity key reports a clean round-trip: the readback
value for each identity key equals the Local_Database source value for the same
identity key across every Publication_Set column. Concretely the property
asserts, for every generated input set:

  * Apply succeeds and readback matches (Requirements 10.7, 10.12). Every table
    readback record reports ``matched_row_count == readback_row_count`` and
    ``mismatched_row_count == 0``; the job succeeds (``succeeded=True``,
    ``code=None``).
  * Round-trip equality (Requirement 10.12). Re-reading the hosted store for
    each applied identity key yields, across every Publication_Set column,
    exactly the projected Local_Database source row that was published — the
    ``(identity key -> Publication_Set column values)`` image read back equals
    the projected source image.
  * Mutation branch (Requirement 10.15). When the hosted model is tampered so a
    single stored value drifts from the source before readback, the readback
    reports the mismatch (``mismatched_row_count >= 1``), the job returns the
    fixed code ``publish_readback_mismatch``, and it is never marked a success.

The generator ``publish_inputs()`` draws admitted rows (identity + published
columns only, unique identity keys, no ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` marker
rows) across the real committed ``backend/deploy/publication-set.v1.json``
ledger. The hosted side is an in-memory model adapted from
``test_publish_apply_unittest.FakeHosted``: ``apply`` stores each batch keyed by
identity signature and ``read`` returns the stored rows, with an optional
``tamper`` override that simulates hosted drift on the readback re-read only. No
database is touched and no hosted write is performed.

Runnable via
``python -m unittest backend.pipeline_control.test_publish_readback_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.publish_worker import (
    PUBLISH_READBACK_MISMATCH,
    RESULT_READBACK_MATCHED,
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
# the readback round-trip is what this property exercises, not the gate.
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

# A sentinel that cannot be produced by ``_scalar_value`` (contains ':' and
# uppercase, exceeds the benign text max size), so drifting any stored value to
# it is guaranteed to differ from the Local_Database source value.
_DRIFT_SENTINEL = "DRIFTED::NOT_THE_SOURCE_VALUE"


def _identity_keys(table_key: str) -> tuple[str, ...]:
    return _PUBLICATION_SET.tables[table_key].identity_keys


def _sig(table_key: str, row: dict[str, Any]) -> tuple:
    return tuple(row.get(k) for k in _identity_keys(table_key))


def _projected(row: dict[str, Any]) -> dict[str, Any]:
    """Project a row exactly as the worker does: keys sorted, values unchanged."""

    return {key: row[key] for key in sorted(row.keys())}


class FakeHosted:
    """In-memory hosted model with an optional readback-drift override.

    Adapted from ``test_publish_apply_unittest.FakeHosted``. ``apply`` stores a
    batch keyed by identity signature and returns inserted/updated counts.
    ``read`` returns the stored rows, optionally overridden by ``tamper`` to
    simulate hosted drift on the readback re-read only — the ``store`` written
    by ``apply`` is left intact, so the drift models a value diverging after the
    write, which the Publish_Readback must detect (Requirement 10.15).
    """

    def __init__(self, identity_keys_by_table: dict[str, tuple[str, ...]]) -> None:
        self.identity_keys = identity_keys_by_table
        self.store: dict[str, dict[tuple, dict]] = {}
        self.apply_calls: list[tuple[str, int]] = []
        self.tamper: dict[str, dict[tuple, dict]] = {}

    def _sig(self, table_key: str, row: dict) -> tuple:
        return tuple(row.get(k) for k in self.identity_keys[table_key])

    def apply(self, table_key: str, rows: list[dict]) -> dict:
        self.apply_calls.append((table_key, len(rows)))
        table = self.store.setdefault(table_key, {})
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
        overrides = self.tamper.get(table_key, {})
        out: list[dict] = []
        for sig in signatures:
            row = overrides[sig] if sig in overrides else table.get(sig)
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
    benign scalar values. Unique identity keys keep the readback signatures
    unambiguous; the total row count is guaranteed to be at least 1.

    Returns a dict carrying the apply ``request``, the projected
    ``rows_by_table``, and the total ``row_count``.
    """

    chosen = draw(
        st.lists(
            st.sampled_from(_TABLE_KEYS),
            unique=True,
            min_size=1,
            max_size=len(_TABLE_KEYS),
        )
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

    request = {"publishJobId": "job-readback-prop", "tables": table_entries}
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


def _projected_source_image(
    rows_by_table: dict[str, list[dict[str, Any]]]
) -> dict[str, dict[tuple, dict]]:
    """The projected Local_Database source image keyed by identity signature."""

    image: dict[str, dict[tuple, dict]] = {}
    for table_key, rows in rows_by_table.items():
        image[table_key] = {_sig(table_key, row): dict(row) for row in rows}
    return image


def _drifted_row(table_key: str, source_row: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``source_row`` with one column drifted from the source.

    Prefers drifting a published column so the drift is a genuine value change;
    when the row carries only its identity key, the identity value itself is
    drifted so the readback re-read compares unequal for that key. Either way
    the result is guaranteed to differ from the Local_Database source value.
    """

    drifted = dict(source_row)
    identity = set(_identity_keys(table_key))
    published_present = [k for k in sorted(drifted) if k not in identity]
    target = published_present[0] if published_present else sorted(identity)[0]
    drifted[target] = _DRIFT_SENTINEL
    return drifted


class PublishReadbackRoundTripPropertyTests(unittest.TestCase):
    # Feature: platform-modernization, Property 23: 게시 리드백 라운드트립
    # Validates: Requirements 10.7, 10.12, 10.15
    @settings(max_examples=100, deadline=None)
    @given(publish_input=publish_inputs())
    def test_property_23_readback_round_trip(self, publish_input: dict[str, Any]) -> None:
        request = publish_input["request"]
        rows_by_table = publish_input["rows_by_table"]
        total_rows = publish_input["row_count"]

        worker = PublishWorker(publication_set=_PUBLICATION_SET)
        hosted = FakeHosted(
            {key: _identity_keys(key) for key in _PUBLICATION_SET.tables}
        )

        preview = worker.preview(request, now=0.0).preview
        self.assertIsNotNone(preview)

        # -- Apply against the faithful in-memory hosted model -------------
        result = worker.apply(
            preview,
            request,
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )

        # Clean apply + readback (Requirements 10.7, 10.12).
        self.assertTrue(result.succeeded)
        self.assertIsNone(result.code)

        # Every table readback reports matched == readback rows, mismatched 0.
        applied_by_table = {rec.table_key: rec for rec in result.readback_records}
        for table_key, rows in rows_by_table.items():
            record = applied_by_table.get(table_key)
            self.assertIsNotNone(record)
            self.assertEqual(record.readback_row_count, len(rows))
            self.assertEqual(record.matched_row_count, len(rows))
            self.assertEqual(record.mismatched_row_count, 0)
            # Every readback audit event marks the matched result code.
        readback_audit = [e for e in result.audit_events if e["stage"] == "readback"]
        for event in readback_audit:
            self.assertEqual(event["result_code"], RESULT_READBACK_MATCHED)

        # -- Round-trip equality across every Publication_Set column -------
        # Re-read the hosted store for each applied identity key and compare the
        # readback image to the projected Local_Database source image (10.12).
        readback_image: dict[str, dict[tuple, dict]] = {}
        for table_key, rows in rows_by_table.items():
            signatures = [_sig(table_key, row) for row in rows]
            hosted_rows = hosted.read(table_key, signatures)
            readback_image[table_key] = {
                _sig(table_key, row): dict(row) for row in hosted_rows
            }
        self.assertEqual(readback_image, _projected_source_image(rows_by_table))
        # The hosted store image equals the projected source image too.
        self.assertEqual(
            _publication_column_image(hosted.snapshot()),
            _projected_source_image(rows_by_table),
        )

    # Feature: platform-modernization, Property 23: 게시 리드백 라운드트립
    # Validates: Requirements 10.7, 10.12, 10.15
    @settings(max_examples=100, deadline=None)
    @given(publish_input=publish_inputs())
    def test_property_23_tampered_readback_reports_mismatch(
        self, publish_input: dict[str, Any]
    ) -> None:
        request = publish_input["request"]
        rows_by_table = publish_input["rows_by_table"]

        worker = PublishWorker(publication_set=_PUBLICATION_SET)
        hosted = FakeHosted(
            {key: _identity_keys(key) for key in _PUBLICATION_SET.tables}
        )

        # Tamper exactly one applied identity key so its stored value drifts
        # from the Local_Database source before readback (Requirement 10.15).
        tamper_table = sorted(rows_by_table)[0]
        tamper_row = rows_by_table[tamper_table][0]
        tamper_sig = _sig(tamper_table, tamper_row)
        hosted.tamper[tamper_table] = {
            tamper_sig: _drifted_row(tamper_table, tamper_row)
        }

        preview = worker.preview(request, now=0.0).preview
        result = worker.apply(
            preview,
            request,
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=1.0,
        )

        # Readback detects the drift: the job fails closed and is never a
        # success; the fixed code is publish_readback_mismatch (10.15).
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_READBACK_MISMATCH)

        tampered_record = next(
            rec for rec in result.readback_records if rec.table_key == tamper_table
        )
        self.assertGreaterEqual(tampered_record.mismatched_row_count, 1)
        # The mismatch table name and count are on the append-only audit surface.
        mismatch_audit = [
            e
            for e in result.audit_events
            if e["stage"] == "readback"
            and e["result_code"] == PUBLISH_READBACK_MISMATCH
        ]
        self.assertTrue(mismatch_audit)
        self.assertIn(tamper_table, {e["target_table"] for e in mismatch_audit})


if __name__ == "__main__":
    unittest.main()
