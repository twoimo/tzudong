"""Property-based tests for Publish_Preview hash determinism and the confirm gate (Property 20).

Feature: platform-modernization, Property 20: 미리보기 해시 결정성·게이트.
Validates: Requirements 10.4, 10.5, 10.6.

Property 20 (design D6 / C6). For every admitted publish input set the
Publish_Worker preview hash and confirm gate satisfy three invariants:

  * Order invariance (Requirement 10.4). Shuffling the row order of an
    otherwise identical publish request yields the same preview hash, because
    the stable hash orders rows by their canonical JSON before hashing.
  * Value sensitivity (Requirement 10.4). Mutating any single identity-key or
    published-column value yields a different preview hash.
  * Confirm gate exactness (Requirements 10.5, 10.6). Confirm admits the apply
    phase exactly when the presented hash equals the preview hash AND the
    elapsed time since preview creation is at most ``PREVIEW_TTL_SECONDS``
    (900s). For elapsed > 900s the gate returns ``preview_expired`` regardless
    of the presented hash (expiry takes precedence over mismatch); otherwise a
    mismatched hash returns ``preview_hash_mismatch``.

The test drives the real ``PublishWorker.preview`` / ``PublishWorker.confirm``
and ``stable_publish_hash`` (Task 13) against the real committed
``backend/deploy/publication-set.v1.json`` ledger. Elapsed time is injected
through the ``now`` parameter so the 900-second window is exercised
deterministically without a real clock.

Runnable via ``python -m unittest backend.pipeline_control.test_publish_hash_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import copy
import unittest
from typing import Any

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from backend.pipeline_control.publish_worker import (
    PREVIEW_EXPIRED,
    PREVIEW_HASH_MISMATCH,
    PREVIEW_TTL_SECONDS,
    PublicationSet,
    PublishWorker,
    stable_publish_hash,
)
from backend.pipeline_control.tests.publication_fixtures import (
    ACTIVE_TEST_SCHEDULE,
    APPROVED_TEST_PUBLICATION_SET,
)

# The real committed Publication_Set ledger (design D5). Loaded once so the
# generator draws only enumerated columns and the property is checked against
# the authoritative allowlist.
_PUBLICATION_SET: PublicationSet = APPROVED_TEST_PUBLICATION_SET
_TABLE_KEYS = sorted(_PUBLICATION_SET.tables)
_ACTIVE_SCHEDULE = ACTIVE_TEST_SCHEDULE

# A benign scalar alphabet that can never contain the marker token
# ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` (no ':' and no uppercase), so no generated
# row is ever excluded as a local-test marker row.
_BENIGN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "
_scalar_value = st.one_of(
    st.text(alphabet=_BENIGN_ALPHABET, max_size=12),
    st.integers(min_value=-1_000_000, max_value=1_000_000),
    st.booleans(),
    st.none(),
)


@st.composite
def publish_hash_cases(draw: st.DrawFn) -> dict[str, Any]:
    """Generate an admitted publish request plus a reorder, a mutation, and a gate probe.

    The request targets one enumerated table and carries between one and five
    valid rows (identity keys plus a random subset of published columns; never a
    marker). Alongside the original request the case carries:

      * ``reordered_rows`` — the same rows under a random permutation (order
        invariance, Requirement 10.4);
      * ``mutated_rows`` — a deep copy with exactly one identity/published value
        changed to a genuinely different value (value sensitivity, 10.4); and
      * ``elapsed_seconds`` in ``0..3600`` and ``use_correct_hash`` — inputs for
        the confirm gate probe (Requirements 10.5, 10.6).
    """

    table_key = draw(st.sampled_from(_TABLE_KEYS))
    pub_table = _PUBLICATION_SET.tables[table_key]
    identity_keys = list(pub_table.identity_keys)
    published = sorted(pub_table.published_columns)

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

    n_rows = draw(st.integers(min_value=1, max_value=5))
    identity_values = draw(
        st.lists(
            st.integers(min_value=1, max_value=10_000),
            min_size=n_rows,
            max_size=n_rows,
            unique=True,
        )
    )

    def make_valid_row(identity_value: int) -> dict[str, Any]:
        # Identity keys are always present so every row is an identifiable,
        # enumerated target, and are unique because duplicate commands are
        # rejected before preview.
        row: dict[str, Any] = {
            key: identity_value for key in identity_keys
        }
        for col in draw_published_subset():
            row[col] = draw(_scalar_value)
        return row

    rows = [make_valid_row(value) for value in identity_values]

    # A random permutation of the same rows (order invariance).
    perm = draw(st.permutations(list(range(n_rows))))
    reordered_rows = [copy.deepcopy(rows[i]) for i in perm]

    # A single-value mutation on one row. The mutated key is drawn from the
    # row's own keys, which are all enumerated columns, so the change is always
    # reflected in the projected payload and therefore in the hash.
    mutated_rows = copy.deepcopy(rows)
    target_index = draw(st.integers(min_value=0, max_value=n_rows - 1))
    target_row = mutated_rows[target_index]
    mutate_key = draw(
        st.sampled_from(sorted(set(target_row) - set(identity_keys)))
    )
    original_value = target_row[mutate_key]
    # ``v != original_value`` (Python equality) guarantees a distinct canonical
    # JSON for our scalar alphabet: the only cross-type equality (bool vs int,
    # e.g. ``True == 1``) is filtered out here, so any surviving replacement
    # serializes differently and yields a different hash.
    new_value = draw(_scalar_value.filter(lambda v: v != original_value))
    target_row[mutate_key] = new_value

    elapsed_seconds = draw(st.integers(min_value=0, max_value=3600))
    use_correct_hash = draw(st.booleans())

    return {
        "table_schema": pub_table.schema,
        "table_name": pub_table.table,
        "rows": rows,
        "reordered_rows": reordered_rows,
        "mutated_rows": mutated_rows,
        "elapsed_seconds": elapsed_seconds,
        "use_correct_hash": use_correct_hash,
    }


def _request(schema: str, table: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "publishJobId": "job-hash-prop",
        "tables": [{"schema": schema, "table": table, "rows": rows}],
    }


class PublishHashDeterminismPropertyTests(unittest.TestCase):
    # Feature: platform-modernization, Property 20: 미리보기 해시 결정성·게이트
    # Validates: Requirements 10.4, 10.5, 10.6
    @settings(max_examples=100, deadline=None)
    @given(case=publish_hash_cases())
    def test_property_20_hash_determinism_and_confirm_gate(
        self, case: dict[str, Any]
    ) -> None:
        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        schema = case["table_schema"]
        table = case["table_name"]

        base = worker.preview(_request(schema, table, case["rows"]), now=0.0)
        self.assertTrue(base.admitted)
        self.assertIsNotNone(base.preview)
        preview = base.preview

        # -- Order invariance (Requirement 10.4) --------------------------
        reordered = worker.preview(
            _request(schema, table, case["reordered_rows"]), now=0.0
        )
        self.assertTrue(reordered.admitted)
        self.assertEqual(preview.preview_hash, reordered.preview.preview_hash)

        # -- Value sensitivity (Requirement 10.4) -------------------------
        mutated = worker.preview(_request(schema, table, case["mutated_rows"]), now=0.0)
        self.assertTrue(mutated.admitted)
        self.assertNotEqual(preview.preview_hash, mutated.preview.preview_hash)

        # -- Confirm gate exactness (Requirements 10.5, 10.6) -------------
        elapsed = case["elapsed_seconds"]
        if case["use_correct_hash"]:
            presented = preview.preview_hash
        else:
            # A hash that is guaranteed to differ from the real one.
            presented = preview.preview_hash[::-1] + "z"
            assume(presented != preview.preview_hash)

        result = worker.confirm(preview, presented, now=float(elapsed))
        self.assertEqual(result.elapsed_seconds, float(elapsed))

        if elapsed > PREVIEW_TTL_SECONDS:
            # Expiry precedence: a stale preview is refused before its hash is
            # compared, so the code is ``preview_expired`` even on mismatch.
            self.assertFalse(result.admitted)
            self.assertEqual(result.code, PREVIEW_EXPIRED)
        elif case["use_correct_hash"]:
            self.assertTrue(result.admitted)
            self.assertIsNone(result.code)
        else:
            self.assertFalse(result.admitted)
            self.assertEqual(result.code, PREVIEW_HASH_MISMATCH)

    # Feature: platform-modernization, Property 20: 미리보기 해시 결정성·게이트
    # Validates: Requirement 10.4
    def test_stable_hash_invariant_under_row_reorder(self) -> None:
        """Explicit example: reordering rows within a table does not change the hash."""

        rows = [
            {"id": 1, "title": "alpha", "view_count": 10},
            {"id": 2, "title": "beta", "view_count": 20},
            {"id": 3, "title": "gamma", "view_count": 30},
        ]
        forward = stable_publish_hash({"public.videos": list(rows)})
        reversed_hash = stable_publish_hash({"public.videos": list(reversed(rows))})
        self.assertEqual(forward, reversed_hash)

    # Feature: platform-modernization, Property 20: 미리보기 해시 결정성·게이트
    # Validates: Requirement 10.4
    def test_stable_hash_differs_on_single_value_change(self) -> None:
        """Explicit example: changing one published value changes the hash."""

        rows = [{"id": 1, "title": "alpha", "view_count": 10}]
        original = stable_publish_hash({"public.videos": copy.deepcopy(rows)})
        changed = copy.deepcopy(rows)
        changed[0]["view_count"] = 11
        self.assertNotEqual(original, stable_publish_hash({"public.videos": changed}))

    # Feature: platform-modernization, Property 20: 미리보기 해시 결정성·게이트
    # Validates: Requirements 10.5, 10.6
    def test_confirm_gate_boundary_and_precedence(self) -> None:
        """Explicit examples pinning the 900s boundary and expiry precedence."""

        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        request = _request("public", "videos", [{"id": 1, "title": "ok"}])
        preview = worker.preview(request, now=0.0).preview

        # Exactly at the TTL boundary with a matching hash: admitted.
        at_boundary = worker.confirm(
            preview, preview.preview_hash, now=PREVIEW_TTL_SECONDS
        )
        self.assertTrue(at_boundary.admitted)
        self.assertIsNone(at_boundary.code)

        # One second past the TTL with a matching hash: expired.
        past_ttl = worker.confirm(
            preview, preview.preview_hash, now=PREVIEW_TTL_SECONDS + 1.0
        )
        self.assertFalse(past_ttl.admitted)
        self.assertEqual(past_ttl.code, PREVIEW_EXPIRED)

        # Within the window with a wrong hash: mismatch.
        mismatch = worker.confirm(preview, "not-the-hash", now=10.0)
        self.assertFalse(mismatch.admitted)
        self.assertEqual(mismatch.code, PREVIEW_HASH_MISMATCH)

        # Past the TTL with a wrong hash: expiry takes precedence over mismatch.
        expired_and_wrong = worker.confirm(
            preview, "not-the-hash", now=PREVIEW_TTL_SECONDS + 5.0
        )
        self.assertFalse(expired_and_wrong.admitted)
        self.assertEqual(expired_and_wrong.code, PREVIEW_EXPIRED)


if __name__ == "__main__":
    unittest.main()
