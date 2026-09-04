"""Property-based tests for the Publish_Worker payload allowlist subset (Property 19).

Feature: platform-modernization, Property 19: 게시 페이로드 허용목록 부분집합.
Validates: Requirements 9.8, 9.11, 10.2, 10.3.

Property 19 (design D-속성표 row 19). For every publish input set that mixes
Publication_Set-enumerated columns with non-enumerated columns and
``LOCAL_TEST_ONLY:NOT_PRODUCTION``-marked rows:

  * the key set of every payload row the Publish_Worker projects is always a
    subset of that table's Publication_Set allowed columns (identity keys ∪
    published columns), and the marker-carrying row count in the output is 0
    (Requirements 9.8, 9.11, 10.2); and
  * if the input carries any non-enumerated table or column, the worker returns
    the fixed code ``publication_target_not_admitted``, produces no preview, and
    admits zero rows (Requirement 10.3).

The test drives the real ``PublishWorker.preview`` (Task 13) against the real
committed ``backend/deploy/publication-set.v1.json`` ledger, and additionally
inspects the shared projection (``_project_tables``) so the subset invariant is
checked against the actual projected payload rows, not just the counts.

Runnable via ``python -m unittest backend.pipeline_control.test_publish_payload_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.bin.seed_fixture_guard import (
    LOCAL_TEST_ONLY_MARKER,
    record_carries_marker,
)
from backend.pipeline_control.publish_worker import (
    PUBLICATION_TARGET_NOT_ADMITTED,
    PublicationSet,
    PublishWorker,
    _project_tables,
)
from backend.pipeline_control.tests.publication_fixtures import (
    ACTIVE_TEST_SCHEDULE,
    APPROVED_TEST_PUBLICATION_SET,
)

# The real committed Publication_Set ledger (design D5). Loaded once: the
# generator draws admitted columns from it and refusal cases inject targets
# outside it, so the property is checked against the authoritative allowlist.
_PUBLICATION_SET: PublicationSet = APPROVED_TEST_PUBLICATION_SET
_TABLE_KEYS = sorted(_PUBLICATION_SET.tables)
_ACTIVE_SCHEDULE = ACTIVE_TEST_SCHEDULE

# A benign scalar alphabet that can never contain the marker token (no ':' and
# no uppercase run that would spell the token), so only rows we deliberately
# mark are treated as marker-carrying.
_BENIGN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "
_benign_text = st.text(alphabet=_BENIGN_ALPHABET, max_size=12)
_scalar_value = st.one_of(
    _benign_text,
    st.integers(min_value=-1_000_000, max_value=1_000_000),
    st.booleans(),
    st.none(),
)

# A column name that is not enumerated for any table in the ledger, used to
# inject a non-admitted column onto a kept (non-marker) row (Requirement 10.3).
_NON_ALLOWED_COLUMN = "definitely_not_an_enumerated_column"
# A schema.table pair that is not enumerated in the ledger (Requirement 10.3).
_UNENUMERATED_SCHEMA = "public"
_UNENUMERATED_TABLE = "definitely_not_an_enumerated_table"


def _assert_column_names_are_novel() -> None:
    """Guard: the injected non-admitted names must be outside the ledger.

    If a future ledger revision ever enumerated one of these names the refusal
    branch would silently stop testing what it claims to; fail loud instead.
    """

    for pub_table in _PUBLICATION_SET.tables.values():
        assert _NON_ALLOWED_COLUMN not in pub_table.allowed_columns
    assert (
        _PUBLICATION_SET.get(_UNENUMERATED_SCHEMA, _UNENUMERATED_TABLE) is None
    )


_assert_column_names_are_novel()


@st.composite
def publish_inputs(draw: st.DrawFn) -> dict[str, Any]:
    """Generate a publish request mixing admitted, non-admitted, and marker rows.

    The request always targets one enumerated table and carries a mix of:

      * ``valid`` rows — identity keys plus a random subset of published
        columns; no marker (these are the rows a preview must project);
      * ``marker`` rows — identity keys plus published columns, with the
        ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` token embedded in a value; these must
        be excluded before counting or projection (Requirement 9.8); and
      * optional refusal injections, each independently toggled:
          - a kept row carrying a non-enumerated column,
          - a kept row missing an identity key, and
          - an extra table entry naming a non-enumerated table.

    The returned metadata records whether the request should be admitted and,
    when admitted, the number of rows that must survive marker exclusion.
    """

    table_key = draw(st.sampled_from(_TABLE_KEYS))
    pub_table = _PUBLICATION_SET.tables[table_key]
    identity_keys = list(pub_table.identity_keys)
    published = sorted(pub_table.published_columns)

    identity_counter = 0

    def make_identity() -> dict[str, Any]:
        # Duplicate identities are not an unambiguous publish command. Keep
        # every generated row distinct so only the intended refusal injection
        # controls the expected outcome.
        nonlocal identity_counter
        identity_counter += 1
        return {key: identity_counter for key in identity_keys}

    def draw_published_subset() -> list[str]:
        if not published:
            return []
        return draw(
            st.lists(
                st.sampled_from(published),
                unique=True,
                min_size=1,
                max_size=len(published),
            )
        )

    def make_valid_row() -> dict[str, Any]:
        row = make_identity()
        for col in draw_published_subset():
            row[col] = draw(_scalar_value)
        return row

    def make_marker_row() -> dict[str, Any]:
        row = make_identity()
        subset = draw_published_subset()
        for col in subset:
            row[col] = draw(_scalar_value)
        # Embed the exact marker token in one string value. Prefer a published
        # column; fall back to an identity key so the marker is always present.
        marker_value = f"seed {LOCAL_TEST_ONLY_MARKER}"
        target_col = subset[0] if subset else identity_keys[0]
        row[target_col] = marker_value
        return row

    n_valid = draw(st.integers(min_value=0, max_value=4))
    n_marker = draw(st.integers(min_value=0, max_value=4))

    inject_non_allowed_column = draw(st.booleans())
    inject_missing_identity = draw(st.booleans())
    inject_unenumerated_table = draw(st.booleans())

    rows: list[dict[str, Any]] = []
    for _ in range(n_valid):
        rows.append(make_valid_row())
    for _ in range(n_marker):
        rows.append(make_marker_row())

    if inject_non_allowed_column:
        bad_row = make_valid_row()
        bad_row[_NON_ALLOWED_COLUMN] = draw(_scalar_value)
        rows.append(bad_row)

    if inject_missing_identity:
        # A kept (non-marker) row that omits an identity key is not an
        # identifiable enumerated target and must be refused (Requirement 10.3).
        missing_row: dict[str, Any] = {}
        for col in draw_published_subset():
            missing_row[col] = draw(_scalar_value)
        if identity_keys:
            missing_row.pop(identity_keys[0], None)
        rows.append(missing_row)

    # Shuffle so refusal-triggering rows are not always last.
    order = draw(st.permutations(list(range(len(rows)))))
    ordered_rows = [rows[i] for i in order]

    table_entries: list[dict[str, Any]] = [
        {
            "schema": pub_table.schema,
            "table": pub_table.table,
            "rows": ordered_rows,
        }
    ]

    if inject_unenumerated_table:
        table_entries.append(
            {
                "schema": _UNENUMERATED_SCHEMA,
                "table": _UNENUMERATED_TABLE,
                "rows": [make_valid_row()],
            }
        )
        # Non-enumerated table entries may appear before or after the admitted
        # one; order must not change the refusal outcome.
        table_entries = [
            table_entries[i] for i in draw(st.permutations(list(range(len(table_entries)))))
        ]

    request = {
        "publishJobId": "job-" + draw(st.text(alphabet="abcdef0123456789", min_size=4, max_size=8)),
        "tables": table_entries,
    }

    should_refuse = (
        inject_non_allowed_column or inject_missing_identity or inject_unenumerated_table
    )

    return {
        "request": request,
        "table_key": pub_table.key,
        "allowed_columns": frozenset(pub_table.allowed_columns),
        "expect_admitted": not should_refuse,
        "expected_kept_count": n_valid,
        "marker_row_count": n_marker,
    }


class PublishPayloadAllowlistPropertyTests(unittest.TestCase):
    # Feature: platform-modernization, Property 19: 게시 페이로드 허용목록 부분집합
    # Validates: Requirements 9.8, 9.11, 10.2, 10.3
    @settings(max_examples=100, deadline=None)
    @given(case=publish_inputs())
    def test_property_19_payload_keys_subset_and_markers_excluded(
        self, case: dict[str, Any]
    ) -> None:
        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        request = case["request"]

        result = worker.preview(request)

        if not case["expect_admitted"]:
            # Requirement 10.3: any non-enumerated table or column refuses with
            # the fixed code, produces no preview, and admits zero rows.
            self.assertFalse(result.admitted)
            self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)
            self.assertIsNone(result.preview)
            return

        # Admitted path (Requirements 9.8, 10.2).
        self.assertTrue(result.admitted)
        self.assertIsNone(result.code)
        self.assertIsNotNone(result.preview)
        preview = result.preview

        # Marker-carrying rows are excluded before counting: the surviving total
        # equals the number of valid (non-marker) rows, and the excluded count
        # equals the number of marker rows (Requirements 9.8, 9.11).
        self.assertEqual(preview.total_row_count, case["expected_kept_count"])
        self.assertEqual(result.excluded_marked_row_count, case["marker_row_count"])

        # Inspect the actual projected payload rows via the shared projection so
        # the subset invariant is checked against real payload keys, not counts.
        projection = _project_tables(_PUBLICATION_SET, request, None)
        self.assertIsNone(projection.code)

        allowed = case["allowed_columns"]
        projected_row_total = 0
        for table_key, projected_rows in projection.tables_rows.items():
            pub_table = _PUBLICATION_SET.tables[table_key]
            table_allowed = pub_table.allowed_columns
            for projected in projected_rows:
                projected_row_total += 1
                # Requirement 10.2: every projected key is an admitted column.
                self.assertTrue(set(projected.keys()).issubset(table_allowed))
                # Requirement 9.8/9.11: no projected row carries the marker.
                self.assertFalse(record_carries_marker(projected))

        # The single admitted table's allowed set matches what was generated.
        self.assertIn(case["table_key"], projection.tables_rows)
        self.assertTrue(
            set().union(
                *(set(r.keys()) for r in projection.tables_rows[case["table_key"]])
            ).issubset(allowed)
            if projection.tables_rows[case["table_key"]]
            else True
        )

        # Total projected rows equal the previewed total (marker rows excluded).
        self.assertEqual(projected_row_total, preview.total_row_count)

    # Feature: platform-modernization, Property 19: 게시 페이로드 허용목록 부분집합
    # Validates: Requirements 10.2, 10.3
    def test_non_allowed_column_on_kept_row_is_refused(self) -> None:
        """Explicit example: a non-enumerated column refuses with the fixed code."""

        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        request = {
            "publishJobId": "job-example-1",
            "tables": [
                {
                    "schema": "public",
                    "table": "videos",
                    "rows": [{"id": 1, "title": "ok", _NON_ALLOWED_COLUMN: "x"}],
                }
            ],
        }

        result = worker.preview(request)

        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)
        self.assertIsNone(result.preview)

    # Feature: platform-modernization, Property 19: 게시 페이로드 허용목록 부분집합
    # Validates: Requirements 9.8, 9.11
    def test_marker_row_excluded_and_never_counted(self) -> None:
        """Explicit example: a marker row is dropped and the valid row survives."""

        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        request = {
            "publishJobId": "job-example-2",
            "tables": [
                {
                    "schema": "public",
                    "table": "videos",
                    "rows": [
                        {"id": 1, "title": "kept"},
                        {"id": 2, "title": f"seed {LOCAL_TEST_ONLY_MARKER}"},
                    ],
                }
            ],
        }

        result = worker.preview(request)

        self.assertTrue(result.admitted)
        self.assertIsNotNone(result.preview)
        self.assertEqual(result.preview.total_row_count, 1)
        self.assertEqual(result.excluded_marked_row_count, 1)


if __name__ == "__main__":
    unittest.main()
