"""Property-based tests for the Publish_Worker failure-code closed set (Property 24).

Feature: platform-modernization, Property 24: 게시 실패 코드 닫힌 집합.
Validates: Requirement 10.13.

Property 24 (design C6). For *every* publish failure path the whole
preview -> confirm -> apply -> readback flow can take, two invariants hold:

  * Closed set (코드 ∈ 7값). Any failure code the flow returns is a member of the
    seven-value closed set ``PUBLISH_FAILURE_CODES`` — exactly
    ``publication_target_not_admitted``, ``preview_hash_mismatch``,
    ``preview_expired``, ``batch_upsert_limit``, ``publish_readback_mismatch``,
    ``publish_apply_aborted``, ``publish_schedule_not_approved`` — and nothing
    else. A failing outcome is never marked a success.
  * No free-form leak (자유 문자열 부재). No provider diagnostic, database error
    string, or free-form error text ever reaches the returned result or the
    bounded audit / history surface. Every ``result_code`` on those surfaces is
    a fixed code (a failure code or a fixed success-outcome code), and an
    injected provider/DB diagnostic sentinel — whether carried by a rejected
    non-enumerated column value or by an injected hosted exception message —
    never appears anywhere in the serialized result, audit events, or history.

The generator ``failure_scenarios()`` draws one of every distinct failure path
against the real committed ``backend/deploy/publication-set.v1.json`` ledger and
constructs the request, hash, clock, schedule, and injected hosted-callable
conditions that force it:

  * ``schedule_not_approved`` — a missing / inactive operator schedule.
  * ``hash_mismatch`` — a presented hash that differs from the preview hash.
  * ``preview_expired`` — a confirm requested past the 900-second window.
  * ``non_admitted_apply`` / ``non_admitted_preview`` — a non-enumerated table or
    column (the latter carrying a DB-diagnostic-shaped value).
  * ``batch_limit`` — a hosted apply that reports a batch-size overflow.
  * ``apply_aborted_failure`` / ``apply_aborted_conflict`` — a batch failure, or a
    compare-and-set conflict that cannot be shown to have converged.
  * ``readback_mismatch`` — a hosted value that drifts before readback.

Injected hosted exceptions carry a provider/DB-diagnostic sentinel in their
message so the "no free-form leak" invariant is exercised against a real
diagnostic string the module must never surface. No database is touched and no
hosted write is performed.

Runnable via ``python -m unittest backend.pipeline_control.test_publish_codes_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control.publish_worker import (
    BATCH_UPSERT_LIMIT,
    PREVIEW_EXPIRED,
    PREVIEW_HASH_MISMATCH,
    PREVIEW_TTL_SECONDS,
    PUBLICATION_TARGET_NOT_ADMITTED,
    PUBLISH_APPLY_ABORTED,
    PUBLISH_FAILURE_CODES,
    PUBLISH_READBACK_MISMATCH,
    PUBLISH_SCHEDULE_NOT_APPROVED,
    RESULT_APPLY_COMPLETED,
    RESULT_CONFIRM_ADMITTED,
    RESULT_CONVERGED_NO_OP,
    RESULT_PREVIEW_GENERATED,
    RESULT_PUBLISH_SUCCEEDED,
    RESULT_READBACK_MATCHED,
    HostedApplyConflict,
    HostedApplyFailure,
    HostedBatchLimitError,
    PublicationSet,
    PublishWorker,
)
from backend.pipeline_control.tests.publication_fixtures import (
    ACTIVE_TEST_SCHEDULE,
    APPROVED_TEST_PUBLICATION_SET,
)

# The real committed Publication_Set ledger (design D5). Loaded once so the
# generator draws only enumerated tables/columns and the property is checked
# against the authoritative allowlist.
_PUBLICATION_SET: PublicationSet = APPROVED_TEST_PUBLICATION_SET
_TABLE_KEYS = sorted(_PUBLICATION_SET.tables)

# An active operator-approved schedule for every path except the schedule-gate
# scenario; the gate must never be the reason a non-gate scenario fails.
_ACTIVE_SCHEDULE = ACTIVE_TEST_SCHEDULE

# The seven-value closed set expressed independently of the module constant, so
# the test pins the exact membership rather than echoing the import.
_EXPECTED_FAILURE_CODES = frozenset(
    {
        "publication_target_not_admitted",
        "preview_hash_mismatch",
        "preview_expired",
        "batch_upsert_limit",
        "publish_readback_mismatch",
        "publish_apply_aborted",
        "publish_schedule_not_approved",
    }
)

# Fixed success-outcome codes the bounded surface may also carry (never as the
# job code). Together with the failure codes they form the complete set of codes
# the audit / history result_code field is allowed to contain.
_KNOWN_RESULT_CODES = frozenset(
    {
        RESULT_PREVIEW_GENERATED,
        RESULT_CONFIRM_ADMITTED,
        RESULT_APPLY_COMPLETED,
        RESULT_CONVERGED_NO_OP,
        RESULT_READBACK_MATCHED,
        RESULT_PUBLISH_SUCCEEDED,
    }
)
_ALLOWED_CODE_FIELD_VALUES = _EXPECTED_FAILURE_CODES | _KNOWN_RESULT_CODES

# A provider/DB-diagnostic-shaped sentinel. It is injected as a rejected column
# value and as injected hosted exception messages; the module must never surface
# it in a result, audit event, or history row (Requirement 10.13, Forbidden_Log_Field).
_DIAGNOSTIC_SENTINEL = "ERROR: duplicate key value violates unique constraint pg_23505 provider-diag"

# A benign scalar alphabet that can never contain the marker token
# ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` (no ':' and no uppercase) or the diagnostic
# sentinel, so no generated row is dropped and no benign value collides with the
# sentinel leak check.
_BENIGN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "
_scalar_value = st.one_of(
    st.text(alphabet=_BENIGN_ALPHABET, max_size=8),
    st.integers(min_value=-1_000, max_value=1_000),
    st.booleans(),
    st.none(),
)


def _identity_keys(table_key: str) -> tuple[str, ...]:
    return _PUBLICATION_SET.tables[table_key].identity_keys


class FakeHosted:
    """In-memory hosted model with injectable failure knobs.

    Adapted from ``test_publish_apply_unittest.FakeHosted``. ``apply`` stores a
    batch keyed by identity signature; the knobs force each failure branch:

      * ``limit_on_batch`` raises ``HostedBatchLimitError`` on that apply index.
      * ``fail_on_batch`` raises ``HostedApplyFailure`` on that apply index.
      * ``force_conflict`` raises ``HostedApplyConflict`` on every apply.
      * ``tamper`` overrides the readback re-read for given identity signatures.

    Injected exceptions carry the provider/DB-diagnostic sentinel in their
    message so the "no free-form leak" invariant is exercised against a real
    diagnostic string that the worker must never surface.
    """

    def __init__(self, identity_keys_by_table: dict[str, tuple[str, ...]]) -> None:
        self.identity_keys = identity_keys_by_table
        self.store: dict[str, dict[tuple, dict]] = {}
        self.apply_calls: list[tuple[str, int]] = []
        self.force_conflict = False
        self.fail_on_batch: int | None = None
        self.limit_on_batch: int | None = None
        self.tamper: dict[str, dict[tuple, dict]] = {}

    def _sig(self, table_key: str, row: dict) -> tuple:
        return tuple(row.get(k) for k in self.identity_keys[table_key])

    def apply(self, table_key: str, rows: list[dict]) -> dict:
        index = len(self.apply_calls)
        self.apply_calls.append((table_key, len(rows)))
        if self.limit_on_batch is not None and index == self.limit_on_batch:
            raise HostedBatchLimitError(_DIAGNOSTIC_SENTINEL)
        if self.fail_on_batch is not None and index == self.fail_on_batch:
            raise HostedApplyFailure(_DIAGNOSTIC_SENTINEL)
        if self.force_conflict:
            raise HostedApplyConflict(_DIAGNOSTIC_SENTINEL)
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


@st.composite
def _admitted_request(draw: st.DrawFn) -> dict[str, Any]:
    """Build an admitted publish request across the real Publication_Set.

    Draws a non-empty subset of enumerated tables and, for each, rows with a
    unique integer identity key plus a random subset of published columns with
    benign scalar values. Row counts span the batch boundary (1..250) so the
    apply-phase scenarios exercise multi-batch plans.
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
                        min_size=1,
                        max_size=len(published),
                    )
                ):
                    row[col] = draw(_scalar_value)
            rows.append(row)
        table_entries.append(
            {"schema": pub_table.schema, "table": pub_table.table, "rows": rows}
        )
    return {"publishJobId": "job-codes-prop", "tables": table_entries}


@st.composite
def failure_scenarios(draw: st.DrawFn) -> dict[str, Any]:
    """Draw one of every distinct publish failure path.

    Returns a scenario dict describing the ``mode`` and everything the test needs
    to force that failure: the admitted base request, and the mutated request /
    hash / clock / schedule / hosted knobs specific to the mode.
    """

    request = draw(_admitted_request())
    mode = draw(
        st.sampled_from(
            (
                "schedule_not_approved",
                "hash_mismatch",
                "preview_expired",
                "non_admitted_apply",
                "non_admitted_preview",
                "batch_limit",
                "apply_aborted_failure",
                "apply_aborted_conflict",
                "readback_mismatch",
            )
        )
    )
    scenario: dict[str, Any] = {"mode": mode, "request": request}

    if mode == "schedule_not_approved":
        # A missing schedule, or an inactive/malformed approval block.
        scenario["schedule"] = draw(
            st.sampled_from(
                (
                    None,
                    {},
                    {"approval": {}},
                    {"approval": {"status": "unresolved"}},
                    {"approval": {"status": "pending"}},
                    {"approval": "malformed"},
                )
            )
        )
    elif mode == "hash_mismatch":
        scenario["presented_hash"] = draw(
            st.sampled_from(("", "deadbeef", "not-the-hash", _DIAGNOSTIC_SENTINEL))
        )
    elif mode == "preview_expired":
        scenario["age_seconds"] = draw(
            st.floats(
                min_value=PREVIEW_TTL_SECONDS + 0.001,
                max_value=PREVIEW_TTL_SECONDS + 10_000.0,
            )
        )
    elif mode in ("non_admitted_apply", "non_admitted_preview"):
        # A non-enumerated table, or a rejected extra column carrying a
        # diagnostic-shaped value that must never leak.
        scenario["bad_kind"] = draw(st.sampled_from(("table", "column")))
    elif mode == "batch_limit":
        scenario["limit_on_batch"] = 0
    elif mode == "apply_aborted_failure":
        scenario["fail_on_batch"] = 0
    # apply_aborted_conflict and readback_mismatch need no extra draw.
    return scenario


def _bad_request(request: dict[str, Any], bad_kind: str) -> dict[str, Any]:
    """Return a copy of ``request`` mutated into a non-admitted target."""

    tables = [dict(t) for t in request["tables"]]
    if bad_kind == "table":
        # A schema.table not enumerated in the Publication_Set.
        tables[0] = {"schema": "public", "table": "not_a_published_table", "rows": [{"id": 1}]}
        return {**request, "tables": tables}
    # A rejected extra column carrying a DB-diagnostic-shaped value (10.3, 10.13).
    first = dict(tables[0])
    rows = [dict(r) for r in first.get("rows", [])]
    if not rows:
        rows = [{}]
    key = _PUBLICATION_SET.tables[
        f"{first['schema']}.{first['table']}"
    ].identity_keys[0]
    rows[0] = {**rows[0], key: 1, "db_error_message": _DIAGNOSTIC_SENTINEL}
    first["rows"] = rows
    tables[0] = first
    return {**request, "tables": tables}


def _serialize_surface(*parts: Any) -> str:
    """Serialize result surfaces to a single string for the leak assertion."""

    return json.dumps(parts, ensure_ascii=True, sort_keys=True, default=str)


def _bounded_result_codes(audit_events: Any, history_rows: Any) -> list[str]:
    """Collect every ``result_code`` on the bounded audit / history surface."""

    codes: list[str] = []
    for event in audit_events or ():
        if isinstance(event, dict) and "result_code" in event:
            codes.append(event["result_code"])
    for row in history_rows or ():
        if isinstance(row, dict) and "result_code" in row:
            codes.append(row["result_code"])
    return codes


class PublishFailureCodeClosedSetPropertyTests(unittest.TestCase):
    def test_closed_set_has_exactly_seven_members(self) -> None:
        # 코드 ∈ 7값: the closed set is exactly the seven enumerated codes.
        self.assertEqual(len(PUBLISH_FAILURE_CODES), 7)
        self.assertEqual(PUBLISH_FAILURE_CODES, _EXPECTED_FAILURE_CODES)

    # Feature: platform-modernization, Property 24: 게시 실패 코드 닫힌 집합
    # Validates: Requirement 10.13
    @settings(max_examples=100, deadline=None)
    @given(scenario=failure_scenarios())
    def test_property_24_failure_codes_closed_and_no_free_form_leak(
        self, scenario: dict[str, Any]
    ) -> None:
        mode = scenario["mode"]
        request = scenario["request"]
        worker = PublishWorker(publication_set=_PUBLICATION_SET, schedule=_ACTIVE_SCHEDULE)
        hosted = FakeHosted(
            {key: _identity_keys(key) for key in _PUBLICATION_SET.tables}
        )

        # -- non_admitted_preview terminates at the preview phase -----------
        if mode == "non_admitted_preview":
            bad = _bad_request(request, scenario["bad_kind"])
            preview_result = worker.preview(bad, now=0.0)
            self.assertFalse(preview_result.admitted)
            self.assertEqual(preview_result.code, PUBLICATION_TARGET_NOT_ADMITTED)
            self.assertIn(preview_result.code, PUBLISH_FAILURE_CODES)
            self.assertIsNone(preview_result.preview)
            surface = _serialize_surface(preview_result.as_dict())
            self.assertNotIn(_DIAGNOSTIC_SENTINEL, surface)
            return

        # Every apply-phase scenario starts from a valid, admitted preview.
        preview = worker.preview(request, now=0.0).preview
        self.assertIsNotNone(preview)

        # Defaults: active schedule, matching hash, in-window clock, no knobs.
        apply_request: Any = request
        presented_hash = preview.preview_hash
        schedule: Any = _ACTIVE_SCHEDULE
        now = 1.0

        if mode == "schedule_not_approved":
            schedule = scenario["schedule"]
        elif mode == "hash_mismatch":
            presented_hash = scenario["presented_hash"]
        elif mode == "preview_expired":
            now = preview.created_at + scenario["age_seconds"]
        elif mode == "non_admitted_apply":
            apply_request = _bad_request(request, scenario["bad_kind"])
        elif mode == "batch_limit":
            hosted.limit_on_batch = scenario["limit_on_batch"]
        elif mode == "apply_aborted_failure":
            hosted.fail_on_batch = scenario["fail_on_batch"]
        elif mode == "apply_aborted_conflict":
            # Force a compare-and-set conflict on every apply. The store is empty,
            # so the convergence re-read finds no matching hosted row and cannot
            # show convergence, and apply aborts (10.16).
            hosted.force_conflict = True
        elif mode == "readback_mismatch":
            # Drift one applied identity key on the readback re-read only.
            first_table = sorted(
                f"{t['schema']}.{t['table']}" for t in request["tables"]
            )[0]
            pub_table = _PUBLICATION_SET.tables[first_table]
            drift_sig = (1,)
            # Drift the identity value itself so the re-read signature no longer
            # matches the applied key — a guaranteed mismatch regardless of which
            # published columns the applied row carried.
            hosted.tamper[first_table] = {
                drift_sig: {pub_table.identity_keys[0]: 999_999}
            }

        result = worker.apply(
            preview,
            apply_request,
            presented_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=schedule,
            now=now,
        )

        # -- 코드 ∈ 7값: the failure code is in the seven-value closed set ---
        self.assertIsNotNone(result.code)
        self.assertIn(result.code, PUBLISH_FAILURE_CODES)
        # A failing outcome is never a success.
        self.assertFalse(result.succeeded)

        # Each mode maps to its specific fixed code (target-vs-hash ordering for
        # the non-admitted apply path may resolve either way; both are in-set).
        expected_by_mode = {
            "schedule_not_approved": {PUBLISH_SCHEDULE_NOT_APPROVED},
            "hash_mismatch": {PREVIEW_HASH_MISMATCH},
            "preview_expired": {PREVIEW_EXPIRED},
            "non_admitted_apply": {
                PUBLICATION_TARGET_NOT_ADMITTED,
                PREVIEW_HASH_MISMATCH,
            },
            "batch_limit": {BATCH_UPSERT_LIMIT},
            "apply_aborted_failure": {PUBLISH_APPLY_ABORTED},
            "apply_aborted_conflict": {PUBLISH_APPLY_ABORTED},
            "readback_mismatch": {PUBLISH_READBACK_MISMATCH},
        }
        self.assertIn(result.code, expected_by_mode[mode])

        # -- 자유 문자열 부재: no provider/DB/free-form text on any surface ---
        # Every result_code on the bounded audit / history surface is a fixed
        # code (a failure code or a fixed success-outcome code).
        for code in _bounded_result_codes(result.audit_events, result.history_rows):
            self.assertIn(code, _ALLOWED_CODE_FIELD_VALUES)

        # The injected provider/DB diagnostic sentinel never appears in the
        # serialized result, audit events, or history rows.
        surface = _serialize_surface(
            result.as_dict(),
            result.audit_events,
            result.history_rows,
            [rec.result_code for rec in result.batch_records],
        )
        self.assertNotIn(_DIAGNOSTIC_SENTINEL, surface)


if __name__ == "__main__":
    unittest.main()
