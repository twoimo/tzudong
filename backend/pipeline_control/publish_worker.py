"""Publish_Worker — preview, confirm, apply, readback, audit (Requirement 10; design C6, D6).

Feature: platform-modernization, Tasks 13 and 14.

This module owns the local -> hosted publication flow end to end:

  * Preview  (Requirements 10.2, 10.3, 10.4).
    Validate a publish request against the operator-approved Publication_Set
    ledger, drop marker-carrying local-test rows from the input, count the rows
    that would be inserted and updated per target table, and derive a stable
    hash from the row-identity keys and published-column values only.

  * Confirm  (Requirements 10.5, 10.6).
    Admit the apply phase only when a presented hash equals the preview hash and
    the preview is at most 900 seconds old; otherwise return the fixed code
    ``preview_hash_mismatch`` or ``preview_expired`` and admit no apply.

  * Apply  (Requirements 10.9, 10.16, and idempotent convergence per 10.11).
    Split the confirmed input into sequential batches of at most 200 rows
    (reusing ``batch_upsert.BATCH_LIMIT``), apply them through an injected
    hosted-apply callable, and converge a second identical apply: a
    ``compare_and_set_conflict`` triggers a re-read, and when the hosted
    Publication_Set values already equal the intended values the batch is
    recorded ``converged_no_op`` and treated as success; otherwise apply aborts
    with ``publish_apply_aborted`` and no subsequent batch starts.

  * Readback  (Requirements 10.7, 10.15).
    Re-read every applied row-identity key, count read / matched / mismatched
    rows per table, and fail with ``publish_readback_mismatch`` (never marking
    the job a success) when any value differs.

  * Audit  (Requirement 10.8).
    Under one publish-job identifier, emit append-only stage records for
    preview, confirm, apply, and readback carrying the stage, target table, row
    counts, and exit code only. Records are never mutated or deleted and never
    carry a Forbidden_Log_Field.

Schedule gate (Requirements 10.14, 10.17). Apply reads the operator-approved
``backend/deploy/publish-schedule.approved.json`` and starts no work when the
approval is unresolved or inactive, returning ``publish_schedule_not_approved``.
Code only reads the schedule; it never generates a cadence or substitutes a
default.

Execution boundary (Requirement 10.10). Apply and readback reach the hosted
database only through injected callables that a Backend_Runtime worker supplies;
this module is never driven from a Route_Handler_Boundary. The injectable shape
also keeps the whole flow unit-testable without a live database, and this module
performs no hosted write of its own.

Boundaries this module keeps.

  * Fail closed with a closed set of fixed codes. Every rejection returns a
    short, stable code; no provider diagnostics, database error strings, or
    free-form error text ever leave this module.
  * The stable hash reuses the exact normalization rules of
    ``backend.pipeline_control.state_machine.payload_hash`` (design D6): a
    canonical ``json.dumps`` with sorted keys, compact separators, and ASCII
    escaping, hashed with SHA-256.
  * Rows carrying ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` are excluded from publish
    input before any counting or hashing (Requirement 9.8), reusing
    ``backend.bin.seed_fixture_guard.exclude_marked_from_publication``.
  * Non-enumerated tables and columns are refused; no hosted value is touched
    (Requirements 10.2, 10.3). Because this module performs no apply, refusal
    simply yields no preview and zero admitted rows.

All five phases take injectable inputs — the Publication_Set, existing hosted
identity keys, a clock, the schedule ledger, and the hosted apply/read
callables — so the whole flow is unit-testable without a live database.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence

from backend.bin.seed_fixture_guard import exclude_marked_from_publication
from backend.pipeline_control.batch_upsert import BATCH_LIMIT
from backend.pipeline_control.state_machine import payload_hash

# ---------------------------------------------------------------------------
# Fixed codes (design error-code catalog). The whole publication flow returns
# only the seven-value closed set below on failure; provider diagnostics,
# database error strings, and free-form error text never leave this module
# (Requirement 10.13).
# ---------------------------------------------------------------------------

# A publish request referenced a table or column not enumerated in the
# Publication_Set (Requirement 10.3). No hosted value is changed; zero rows are
# admitted.
PUBLICATION_TARGET_NOT_ADMITTED = "publication_target_not_admitted"

# The confirm phase was presented a hash that does not equal the preview hash
# (Requirement 10.6). No apply starts.
PREVIEW_HASH_MISMATCH = "preview_hash_mismatch"

# The preview was older than the validity window when confirm was requested
# (Requirement 10.6). No apply starts.
PREVIEW_EXPIRED = "preview_expired"

# The closed set of codes the preview + confirm phases may return.
PUBLISH_PREVIEW_CONFIRM_CODES = frozenset(
    {
        PUBLICATION_TARGET_NOT_ADMITTED,
        PREVIEW_HASH_MISMATCH,
        PREVIEW_EXPIRED,
    }
)

# A single apply call was handed more than 200 rows (Requirement 10.9). The
# worker splits input into <=200 batches so this is a defensive guard; if a
# hosted apply reports it, no row of that call is applied.
BATCH_UPSERT_LIMIT = "batch_upsert_limit"

# Readback found at least one applied row whose hosted Publication_Set value
# differs from the intended value (Requirement 10.15). The job is not a success.
PUBLISH_READBACK_MISMATCH = "publish_readback_mismatch"

# An apply batch failed, or a compare-and-set conflict could not be shown to
# have converged (Requirement 10.16). No subsequent batch starts.
PUBLISH_APPLY_ABORTED = "publish_apply_aborted"

# No active operator-approved publish schedule (Requirements 10.14, 10.17).
# Neither preview nor apply starts.
PUBLISH_SCHEDULE_NOT_APPROVED = "publish_schedule_not_approved"

# The seven-value closed set of failure codes the whole publication flow may
# return (Requirement 10.13). Nothing outside this set ever leaves the module.
PUBLISH_FAILURE_CODES = frozenset(
    {
        PUBLICATION_TARGET_NOT_ADMITTED,
        PREVIEW_HASH_MISMATCH,
        PREVIEW_EXPIRED,
        BATCH_UPSERT_LIMIT,
        PUBLISH_READBACK_MISMATCH,
        PUBLISH_APPLY_ABORTED,
        PUBLISH_SCHEDULE_NOT_APPROVED,
    }
)

# Preview validity window (Requirements 10.5, 10.6). Confirm admits the apply
# phase only when the preview age is at most this many seconds.
PREVIEW_TTL_SECONDS = 900.0

# Audit / history stage labels (design D6; local_analytics.publish_history).
STAGE_PREVIEW = "preview"
STAGE_CONFIRM = "confirm"
STAGE_APPLY = "apply"
STAGE_READBACK = "readback"

# Result codes recorded for successful stage outcomes in history / audit. These
# are outcomes, not failure codes, and are never returned as the job code.
RESULT_PREVIEW_GENERATED = "preview_generated"
RESULT_CONFIRM_ADMITTED = "confirm_admitted"
RESULT_APPLY_COMPLETED = "apply_completed"
RESULT_CONVERGED_NO_OP = "converged_no_op"
RESULT_READBACK_MATCHED = "readback_matched"
RESULT_PUBLISH_SUCCEEDED = "publish_succeeded"

# Schedule-approval statuses that admit a publish run (Requirement 10.14). Any
# other value — or a missing schedule — fails closed.
_ACTIVE_SCHEDULE_STATUSES = frozenset({"approved"})
_APPROVAL_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
_TIME_OF_DAY_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_SCHEDULE_UNSET = object()

# Default committed publish-schedule ledger location (created in Task 12).
_DEFAULT_PUBLISH_SCHEDULE_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "deploy",
        "publish-schedule.approved.json",
    )
)

# Default committed Publication_Set ledger location (created in Task 11).
_DEFAULT_PUBLICATION_SET_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "deploy",
        "publication-set.v1.json",
    )
)


class PublishWorkerError(ValueError):
    """Raised for caller misuse (a structurally invalid request container).

    Business-rule refusals never raise; they return a bounded result carrying a
    fixed code. This exception is reserved for programmer errors such as passing
    a non-mapping request or a malformed Publication_Set ledger.
    """


# ---------------------------------------------------------------------------
# Publication_Set model.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PublicationTable:
    """One enumerated publication target (design D5 ``tables[]`` entry).

    Attributes:
        schema: the target schema (e.g. ``public``).
        table: the target table (e.g. ``restaurants``).
        identity_keys: ordered row-identity key columns.
        cas_keys: ordered columns read from hosted state and supplied as the
            compare-and-set precondition. CAS-only columns are never admitted
            into the publication payload unless separately published.
        published_columns: the columns admitted for publication.
        allowed_columns: identity keys ∪ published columns — the exact set of
            keys a publish row may carry.
    """

    schema: str
    table: str
    identity_keys: tuple[str, ...]
    published_columns: frozenset[str]
    allowed_columns: frozenset[str]
    cas_keys: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.table}"


@dataclass(frozen=True)
class PublicationSet:
    """The enumerated set of publication targets keyed by ``schema.table``."""

    tables: Mapping[str, PublicationTable]
    approval_status: str = "unresolved"
    approval_reference_valid: bool = False

    def get(self, schema: str, table: str) -> PublicationTable | None:
        return self.tables.get(f"{schema}.{table}")

    @property
    def is_approved(self) -> bool:
        return self.approval_status == "approved" and self.approval_reference_valid


def _has_named_approval(approval: Any) -> bool:
    if (
        not isinstance(approval, Mapping)
        or approval.get("status") not in _ACTIVE_SCHEDULE_STATUSES
    ):
        return False
    name = approval.get("approverName")
    approved_at = approval.get("approvedAt")
    return (
        isinstance(name, str)
        and 0 < len(name.strip()) <= 128
        and isinstance(approved_at, str)
        and bool(_APPROVAL_TIMESTAMP_RE.fullmatch(approved_at))
    )


def load_publication_set(path: str | None = None) -> PublicationSet:
    """Load and honor the committed Publication_Set ledger (Requirement 10.1).

    The ledger enumerates tables and columns with no wildcards. This reader
    computes, per table, the ``allowed_columns`` set (identity keys plus
    published columns) that a publish row may carry. The parsed approval is
    retained on the model so preview and apply can both fail closed.
    """

    ledger_path = path or _DEFAULT_PUBLICATION_SET_PATH
    with open(ledger_path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    return _publication_set_from_document(doc)


def _publication_set_from_document(doc: Any) -> PublicationSet:
    if (
        not isinstance(doc, Mapping)
        or doc.get("schemaVersion") != 1
        or doc.get("kind") != "publication_set"
    ):
        raise PublishWorkerError("publication_set_shape_invalid")
    approval = doc.get("approval")
    if not isinstance(approval, Mapping):
        raise PublishWorkerError("publication_set_shape_invalid")
    raw_tables = doc.get("tables")
    if not isinstance(raw_tables, Sequence) or isinstance(raw_tables, (str, bytes)):
        raise PublishWorkerError("publication_set_shape_invalid")

    tables: dict[str, PublicationTable] = {}
    for entry in raw_tables:
        if not isinstance(entry, Mapping):
            raise PublishWorkerError("publication_set_shape_invalid")
        schema = entry.get("schema")
        table = entry.get("table")
        identity = entry.get("rowIdentityKeyColumns")
        cas = entry.get("casKeyColumns")
        published = entry.get("publishedColumns")
        if (
            not isinstance(schema, str)
            or not _IDENTIFIER_RE.fullmatch(schema)
            or not isinstance(table, str)
            or not _IDENTIFIER_RE.fullmatch(table)
        ):
            raise PublishWorkerError("publication_set_shape_invalid")
        if not isinstance(identity, Sequence) or isinstance(identity, (str, bytes)):
            raise PublishWorkerError("publication_set_shape_invalid")
        if not isinstance(cas, Sequence) or isinstance(cas, (str, bytes)):
            raise PublishWorkerError("publication_set_shape_invalid")
        if not isinstance(published, Sequence) or isinstance(published, (str, bytes)):
            raise PublishWorkerError("publication_set_shape_invalid")
        if (
            not identity
            or not cas
            or not published
            or any(not isinstance(col, str) or not _IDENTIFIER_RE.fullmatch(col) for col in identity)
            or any(not isinstance(col, str) or not _IDENTIFIER_RE.fullmatch(col) for col in cas)
            or any(not isinstance(col, str) or not _IDENTIFIER_RE.fullmatch(col) for col in published)
            or len(set(identity)) != len(identity)
            or len(set(cas)) != len(cas)
            or len(set(published)) != len(published)
            or not set(identity).issubset(set(cas))
        ):
            raise PublishWorkerError("publication_set_shape_invalid")
        identity_keys = tuple(identity)
        cas_keys = tuple(cas)
        published_columns = frozenset(published)
        allowed_columns = published_columns | set(identity_keys)
        pub_table = PublicationTable(
            schema=schema,
            table=table,
            identity_keys=identity_keys,
            published_columns=published_columns,
            allowed_columns=allowed_columns,
            cas_keys=cas_keys,
        )
        if pub_table.key in tables:
            raise PublishWorkerError("publication_set_shape_invalid")
        tables[pub_table.key] = pub_table
    if not tables:
        raise PublishWorkerError("publication_set_shape_invalid")
    status = approval.get("status")
    return PublicationSet(
        tables=tables,
        approval_status=status if isinstance(status, str) else "invalid",
        approval_reference_valid=_has_named_approval(approval),
    )


# ---------------------------------------------------------------------------
# Preview / confirm result types.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TablePreview:
    """Per-table row-count summary for a preview (Requirement 10.4).

    Carries counts only — never row values — so it is safe to persist to
    ``local_analytics.publish_history`` and audit records.
    """

    schema: str
    table: str
    insert_row_count: int
    update_row_count: int
    total_row_count: int

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.table}"


@dataclass(frozen=True)
class PublishPreview:
    """A generated Publish_Preview (Requirement 10.4).

    Attributes:
        publish_job_id: the single publish-job identifier this preview belongs
            to (design D6 ``publish_job_id``).
        preview_hash: the stable hash derived from identity keys and published
            column values (design D6). Same input set -> same hash; any value
            change -> different hash.
        created_at: the clock reading at preview creation, used to enforce the
            900-second confirm window.
        tables: per-table insert/update/total counts.
    """

    publish_job_id: str
    preview_hash: str
    created_at: float
    tables: tuple[TablePreview, ...]

    @property
    def total_row_count(self) -> int:
        return sum(t.total_row_count for t in self.tables)

    def history_rows(self) -> list[dict[str, Any]]:
        """Bounded ``publish_history`` stage rows for the preview phase.

        One row per target table, matching the ``local_analytics.publish_history``
        columns. Contains counts and the fixed result code only. Task 14 persists
        these from the Backend_Runtime worker.
        """

        return [
            {
                "publish_job_id": self.publish_job_id,
                "stage": STAGE_PREVIEW,
                "target_table": t.key,
                "insert_row_count": t.insert_row_count,
                "update_row_count": t.update_row_count,
                "total_row_count": t.total_row_count,
                "preview_hash": self.preview_hash,
                "result_code": RESULT_PREVIEW_GENERATED,
            }
            for t in self.tables
        ]

    def audit_events(self) -> list[dict[str, Any]]:
        """Bounded append-only ``publish_audit_events`` rows for the preview.

        One event per target table. No row values, provider diagnostics, or
        free-form error strings (Requirement 10.8).
        """

        return [
            {
                "publish_job_id": self.publish_job_id,
                "stage": STAGE_PREVIEW,
                "target_table": t.key,
                "row_count": t.total_row_count,
                "result_code": RESULT_PREVIEW_GENERATED,
            }
            for t in self.tables
        ]


@dataclass(frozen=True)
class PreviewResult:
    """Outcome of a preview request.

    ``admitted`` is True only when a preview was generated. On refusal,
    ``preview`` is ``None`` and ``code`` carries the fixed refusal code
    (``publication_target_not_admitted``). No hosted value is changed and zero
    rows are admitted on refusal (Requirement 10.3).
    """

    admitted: bool
    code: str | None
    preview: PublishPreview | None = None
    # Number of marker-carrying rows dropped from the publish input (9.8).
    excluded_marked_row_count: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "admitted": self.admitted,
            "code": self.code,
            "publishJobId": self.preview.publish_job_id if self.preview else None,
            "previewHash": self.preview.preview_hash if self.preview else None,
            "excludedMarkedRowCount": self.excluded_marked_row_count,
        }


@dataclass(frozen=True)
class ConfirmResult:
    """Outcome of a confirm request (Requirements 10.5, 10.6).

    ``admitted`` is True only when the presented hash matched and the preview
    was within the validity window; Task 14's apply phase may then start. On
    refusal, ``code`` is ``preview_hash_mismatch`` or ``preview_expired`` and no
    apply starts.
    """

    admitted: bool
    code: str | None
    publish_job_id: str
    preview_hash: str
    elapsed_seconds: float

    def history_row(self) -> dict[str, Any]:
        """Bounded ``publish_history`` stage row for the confirm phase."""

        return {
            "publish_job_id": self.publish_job_id,
            "stage": STAGE_CONFIRM,
            "target_table": "",
            "insert_row_count": 0,
            "update_row_count": 0,
            "total_row_count": 0,
            "preview_hash": self.preview_hash,
            "result_code": RESULT_CONFIRM_ADMITTED if self.admitted else self.code,
        }

    def as_dict(self) -> dict[str, Any]:
        return {
            "admitted": self.admitted,
            "code": self.code,
            "publishJobId": self.publish_job_id,
            "previewHash": self.preview_hash,
        }


# ---------------------------------------------------------------------------
# Stable hash (design D6). Reuses state_machine.payload_hash normalization.
# ---------------------------------------------------------------------------


def _hashable_identity_value(value: Any) -> Any:
    """Return a hashable representation of an identity-key value.

    Identity keys are scalars in practice (bigint / text). This guards against a
    non-hashable value by falling back to its canonical JSON form, so identity
    signatures can always be placed in a set.
    """

    try:
        hash(value)
    except TypeError:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return value


def _identity_signature(row: Mapping[str, Any], identity_keys: tuple[str, ...]) -> tuple:
    return tuple(_hashable_identity_value(row.get(key)) for key in identity_keys)


def _canonical_row_key(row: Mapping[str, Any]) -> str:
    """Canonical JSON of a row, used to order rows deterministically.

    Ordering rows by this key makes the preview hash invariant to input row
    order while remaining sensitive to any value change.
    """

    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def stable_publish_hash(tables_rows: Mapping[str, Sequence[Mapping[str, Any]]]) -> str:
    """Derive the stable Publish_Preview hash (Requirement 10.4, design D6).

    ``tables_rows`` maps ``schema.table`` to the validated rows (each already
    projected to identity + published columns). Rows are ordered by their
    canonical JSON so the hash is independent of input order, then the whole
    structure is hashed via ``state_machine.payload_hash`` — the same
    canonical-JSON + SHA-256 normalization used across the control plane.

    The result is deterministic: the same input set yields the same hash, and
    changing any identity-key or published-column value yields a different hash.
    """

    canonical: dict[str, list[Mapping[str, Any]]] = {}
    for table_key in sorted(tables_rows):
        rows = list(tables_rows[table_key])
        canonical[table_key] = sorted(rows, key=_canonical_row_key)
    return payload_hash({"tables": canonical})


# ---------------------------------------------------------------------------
# Publish_Worker (preview, confirm, apply, readback, audit).
# ---------------------------------------------------------------------------


@dataclass
class PublishWorker:
    """Owns the full preview -> confirm -> apply -> readback -> audit flow.

    The worker is constructed with a Publication_Set and an optional monotonic
    clock (injected for deterministic tests). ``apply`` takes injected hosted
    apply/read callables and the schedule ledger, so no phase touches a live
    database directly; every phase emits bounded, append-only audit-ready stage
    records (Requirement 10.8).
    """

    publication_set: PublicationSet
    schedule: Mapping[str, Any] | None = None
    clock: Callable[[], float] = time.monotonic

    @classmethod
    def from_ledger(
        cls,
        path: str | None = None,
        *,
        schedule_path: str | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> "PublishWorker":
        return cls(
            publication_set=load_publication_set(path),
            schedule=load_publish_schedule(schedule_path),
            clock=clock,
        )

    # -- Preview -----------------------------------------------------------

    def preview(
        self,
        request: Mapping[str, Any],
        *,
        existing_identity_keys: Mapping[str, Iterable[tuple]] | None = None,
        now: float | None = None,
    ) -> PreviewResult:
        """Generate a Publish_Preview or refuse a non-admitted request.

        ``request`` is a mapping of the form::

            {"publishJobId": str,
             "tables": [{"schema": str, "table": str, "rows": [ {col: val}, ... ]}, ...]}

        ``existing_identity_keys`` maps ``schema.table`` to the identity
        signatures already present in the Hosted_Database, used to classify each
        row as an insert or an update (Requirement 10.4). When omitted, every
        row is counted as an insert. The signature for a table is a tuple built
        from the ledger's identity-key columns in order.

        Behavior:

          * Marker-carrying rows (``LOCAL_TEST_ONLY:NOT_PRODUCTION``) are dropped
            from the input before counting or hashing (Requirement 9.8).
          * If any table or any row column is not enumerated in the
            Publication_Set, the request is refused with
            ``publication_target_not_admitted`` and no preview is produced
            (Requirements 10.2, 10.3).
          * Otherwise a preview with per-table insert/update/total counts and a
            stable hash is returned (Requirement 10.4).
        """

        publish_job_id = _require_publish_job_id(request)
        if not self.publication_set.is_approved:
            return PreviewResult(admitted=False, code=PUBLICATION_TARGET_NOT_ADMITTED)
        if not is_publish_schedule_active(self.schedule):
            return PreviewResult(admitted=False, code=PUBLISH_SCHEDULE_NOT_APPROVED)
        projection = _project_tables(
            self.publication_set, request, existing_identity_keys
        )
        if projection.code is not None:
            return PreviewResult(admitted=False, code=projection.code)

        preview_hash = stable_publish_hash(projection.tables_rows)
        created_at = self.clock() if now is None else now
        preview = PublishPreview(
            publish_job_id=publish_job_id,
            preview_hash=preview_hash,
            created_at=created_at,
            tables=tuple(projection.table_previews),
        )
        return PreviewResult(
            admitted=True,
            code=None,
            preview=preview,
            excluded_marked_row_count=projection.excluded_marked_row_count,
        )

    # -- Confirm -----------------------------------------------------------

    def confirm(
        self,
        preview: PublishPreview,
        presented_hash: str,
        *,
        now: float | None = None,
    ) -> ConfirmResult:
        """Decide whether the apply phase may start (Requirements 10.5, 10.6).

        The apply phase is admitted only when the presented hash equals the
        preview hash and the preview age is at most ``PREVIEW_TTL_SECONDS``.

        When both an expiry and a mismatch would apply, expiry takes precedence:
        a stale preview is refused with ``preview_expired`` before its hash is
        compared, since the preview is no longer a valid basis for apply.
        """

        current = self.clock() if now is None else now
        elapsed = current - preview.created_at

        if elapsed > PREVIEW_TTL_SECONDS:
            return ConfirmResult(
                admitted=False,
                code=PREVIEW_EXPIRED,
                publish_job_id=preview.publish_job_id,
                preview_hash=preview.preview_hash,
                elapsed_seconds=elapsed,
            )
        if presented_hash != preview.preview_hash:
            return ConfirmResult(
                admitted=False,
                code=PREVIEW_HASH_MISMATCH,
                publish_job_id=preview.publish_job_id,
                preview_hash=preview.preview_hash,
                elapsed_seconds=elapsed,
            )
        return ConfirmResult(
            admitted=True,
            code=None,
            publish_job_id=preview.publish_job_id,
            preview_hash=preview.preview_hash,
            elapsed_seconds=elapsed,
        )

    # -- Apply / readback / audit -----------------------------------------

    def apply(
        self,
        preview: "PublishPreview",
        request: Mapping[str, Any],
        presented_hash: str,
        *,
        hosted_apply: "HostedApplyFn",
        hosted_read: "HostedReadFn",
        schedule: Mapping[str, Any] | None | object = _SCHEDULE_UNSET,
        schedule_path: str | None = None,
        now: float | None = None,
    ) -> "PublishJobResult":
        """Run the apply, readback, and audit phases of a confirmed publish.

        The flow gates are applied in order and each fails closed with a code in
        the seven-value closed set (Requirement 10.13):

          1. Schedule (Requirements 10.14, 10.17). If the operator-approved
             schedule is missing or inactive, no work starts and the job returns
             ``publish_schedule_not_approved``.
          2. Confirm (Requirements 10.5, 10.6). ``presented_hash`` must equal the
             preview hash within the 900-second window, otherwise the job
             returns ``preview_hash_mismatch`` / ``preview_expired``.
          3. Target admission (Requirements 10.2, 10.3). The request is
             re-validated against the Publication_Set; a non-enumerated table or
             column returns ``publication_target_not_admitted`` with zero rows
             applied. The re-projected rows must reproduce the preview hash, so
             the rows applied are exactly those that were previewed.
          4. Apply (Requirements 10.9, 10.16, 10.11). Rows are split into
             sequential batches of at most ``BATCH_LIMIT`` and applied through
             ``hosted_apply``. A ``compare_and_set_conflict`` triggers a re-read
             via ``hosted_read``; a batch whose hosted values already equal the
             intended values is ``converged_no_op`` (success), otherwise apply
             aborts with ``publish_apply_aborted`` and no later batch starts.
          5. Readback (Requirements 10.7, 10.15). Every applied identity key is
             re-read and compared; any mismatch yields
             ``publish_readback_mismatch`` and the job is not a success.

        ``hosted_apply(table_key, rows)`` applies one batch and returns a mapping
        with ``inserted_count``, ``updated_count``, and ``readback``; it raises
        ``HostedApplyConflict`` on a compare-and-set conflict,
        ``HostedBatchLimitError`` when handed more than ``BATCH_LIMIT`` rows, and
        ``HostedApplyFailure`` for any other batch failure.
        ``hosted_read(table_key, identity_signatures)`` returns the current
        hosted rows for the given identity signatures. Both are injected so a
        Backend_Runtime worker supplies live-database access and tests supply an
        in-memory model; this module performs no hosted write of its own and is
        never driven from a Route_Handler_Boundary (Requirement 10.10).
        """

        # Gate 1: operator-approved schedule must be active (10.14, 10.17).
        if schedule is _SCHEDULE_UNSET:
            resolved_schedule = (
                self.schedule
                if self.schedule is not None
                else load_publish_schedule(schedule_path)
            )
        else:
            resolved_schedule = schedule
        if not is_publish_schedule_active(resolved_schedule):
            return _failure_result(
                preview, PUBLISH_SCHEDULE_NOT_APPROVED, stage=STAGE_APPLY
            )

        # Gate 2: hash match within the validity window (10.5, 10.6).
        confirm_result = self.confirm(preview, presented_hash, now=now)
        if not confirm_result.admitted:
            return _failure_result(
                preview,
                confirm_result.code,
                stage=STAGE_CONFIRM,
                confirm_result=confirm_result,
            )

        # Gate 3: re-validate targets and bind the applied rows to the preview.
        projection = _project_tables(self.publication_set, request, None)
        if projection.code is not None:
            return _failure_result(
                preview,
                projection.code,
                stage=STAGE_APPLY,
                confirm_result=confirm_result,
            )
        if stable_publish_hash(projection.tables_rows) != preview.preview_hash:
            return _failure_result(
                preview,
                PREVIEW_HASH_MISMATCH,
                stage=STAGE_APPLY,
                confirm_result=confirm_result,
            )

        # Plan sequential batches of at most BATCH_LIMIT rows (10.9).
        planned: list[tuple[str, int, list[Mapping[str, Any]]]] = []
        for table_key in sorted(projection.tables_rows):
            rows = projection.tables_rows[table_key]
            for batch_index, start in enumerate(range(0, len(rows), BATCH_LIMIT)):
                batch_rows = rows[start : start + BATCH_LIMIT]
                if len(batch_rows) > BATCH_LIMIT:
                    # Defensive: a single call must never exceed the limit (10.9).
                    return _failure_result(
                        preview,
                        BATCH_UPSERT_LIMIT,
                        stage=STAGE_APPLY,
                        confirm_result=confirm_result,
                    )
                planned.append((table_key, batch_index, batch_rows))

        total_batches = len(planned)
        batch_records: list[BatchApplyRecord] = []
        intended_by_table: dict[str, dict[tuple, Mapping[str, Any]]] = {}
        applied_sigs_by_table: dict[str, list[tuple]] = {}
        completed_batches = 0
        insert_total = 0
        update_total = 0
        converged_total = 0
        abort_code: str | None = None

        for table_key, batch_index, batch_rows in planned:
            pub_table = self.publication_set.tables[table_key]
            signatures = [
                _identity_signature(row, pub_table.identity_keys)
                for row in batch_rows
            ]
            try:
                outcome = hosted_apply(table_key, list(batch_rows))
            except HostedApplyConflict:
                # 10.11 convergence: re-read and accept when hosted values
                # already equal the intended values, else abort (10.16).
                try:
                    hosted_rows = hosted_read(table_key, list(signatures))
                    hosted_by_sig = _index_hosted_rows(hosted_rows, pub_table)
                except Exception:
                    hosted_by_sig = {}
                converged = all(
                    _row_matches_hosted(row, hosted_by_sig.get(sig), pub_table)
                    for row, sig in zip(batch_rows, signatures)
                )
                if not converged:
                    abort_code = PUBLISH_APPLY_ABORTED
                    batch_records.append(
                        BatchApplyRecord(
                            table_key=table_key,
                            batch_index=batch_index,
                            applied=False,
                            inserted_count=0,
                            updated_count=0,
                            converged_no_op_count=0,
                            row_count=len(batch_rows),
                            result_code=PUBLISH_APPLY_ABORTED,
                        )
                    )
                    break
                converged_total += len(batch_rows)
                batch_records.append(
                    BatchApplyRecord(
                        table_key=table_key,
                        batch_index=batch_index,
                        applied=True,
                        inserted_count=0,
                        updated_count=0,
                        converged_no_op_count=len(batch_rows),
                        row_count=len(batch_rows),
                        result_code=RESULT_CONVERGED_NO_OP,
                    )
                )
            except HostedBatchLimitError:
                abort_code = BATCH_UPSERT_LIMIT
                batch_records.append(
                    BatchApplyRecord(
                        table_key=table_key,
                        batch_index=batch_index,
                        applied=False,
                        inserted_count=0,
                        updated_count=0,
                        converged_no_op_count=0,
                        row_count=len(batch_rows),
                        result_code=BATCH_UPSERT_LIMIT,
                    )
                )
                break
            except HostedApplyFailure:
                abort_code = PUBLISH_APPLY_ABORTED
                batch_records.append(
                    BatchApplyRecord(
                        table_key=table_key,
                        batch_index=batch_index,
                        applied=False,
                        inserted_count=0,
                        updated_count=0,
                        converged_no_op_count=0,
                        row_count=len(batch_rows),
                        result_code=PUBLISH_APPLY_ABORTED,
                    )
                )
                break
            except Exception:
                # Provider/database diagnostics are deliberately discarded.
                # Every unexpected adapter failure collapses to the fixed
                # apply-aborted code and no later batch starts.
                abort_code = PUBLISH_APPLY_ABORTED
                batch_records.append(
                    BatchApplyRecord(
                        table_key=table_key,
                        batch_index=batch_index,
                        applied=False,
                        inserted_count=0,
                        updated_count=0,
                        converged_no_op_count=0,
                        row_count=len(batch_rows),
                        result_code=PUBLISH_APPLY_ABORTED,
                    )
                )
                break
            else:
                counts = _validated_apply_counts(outcome, len(batch_rows))
                if counts is None:
                    abort_code = PUBLISH_APPLY_ABORTED
                    batch_records.append(
                        BatchApplyRecord(
                            table_key=table_key,
                            batch_index=batch_index,
                            applied=False,
                            inserted_count=0,
                            updated_count=0,
                            converged_no_op_count=0,
                            row_count=len(batch_rows),
                            result_code=PUBLISH_APPLY_ABORTED,
                        )
                    )
                    break
                inserted, updated = counts
                insert_total += inserted
                update_total += updated
                batch_records.append(
                    BatchApplyRecord(
                        table_key=table_key,
                        batch_index=batch_index,
                        applied=True,
                        inserted_count=inserted,
                        updated_count=updated,
                        converged_no_op_count=0,
                        row_count=len(batch_rows),
                        result_code=RESULT_APPLY_COMPLETED,
                    )
                )

            # Record intended values + applied signatures for readback (10.7).
            table_intended = intended_by_table.setdefault(table_key, {})
            table_sigs = applied_sigs_by_table.setdefault(table_key, [])
            for row, sig in zip(batch_rows, signatures):
                table_intended[sig] = row
                table_sigs.append(sig)
            completed_batches += 1

        if abort_code is not None:
            # 10.16: no subsequent batch started; record completed / uncompleted
            # batch counts. No readback on abort; the job is not a success.
            return _apply_aborted_result(
                preview,
                abort_code,
                confirm_result=confirm_result,
                batch_records=batch_records,
                completed_batches=completed_batches,
                uncompleted_batches=total_batches - completed_batches,
                insert_total=insert_total,
                update_total=update_total,
                converged_total=converged_total,
            )

        # Gate 5: readback every applied identity key (10.7, 10.15).
        readback_records: list[TableReadbackRecord] = []
        mismatch_found = False
        for table_key in sorted(applied_sigs_by_table):
            pub_table = self.publication_set.tables[table_key]
            signatures = applied_sigs_by_table[table_key]
            try:
                hosted_rows = hosted_read(table_key, list(signatures))
                hosted_by_sig = _index_hosted_rows(hosted_rows, pub_table)
                readback_row_count = len(hosted_rows)
            except Exception:
                # An unavailable or malformed readback is a mismatch, never a
                # success and never a provider diagnostic surface.
                hosted_by_sig = {}
                readback_row_count = 0
            matched = 0
            mismatched = 0
            for sig in signatures:
                intended = intended_by_table[table_key][sig]
                if _row_matches_hosted(intended, hosted_by_sig.get(sig), pub_table):
                    matched += 1
                else:
                    mismatched += 1
            if mismatched:
                mismatch_found = True
            readback_records.append(
                TableReadbackRecord(
                    table_key=table_key,
                    readback_row_count=readback_row_count,
                    matched_row_count=matched,
                    mismatched_row_count=mismatched,
                )
            )

        final_code = PUBLISH_READBACK_MISMATCH if mismatch_found else None
        return _completed_job_result(
            preview,
            code=final_code,
            confirm_result=confirm_result,
            batch_records=batch_records,
            readback_records=readback_records,
            completed_batches=completed_batches,
            insert_total=insert_total,
            update_total=update_total,
            converged_total=converged_total,
        )


# ---------------------------------------------------------------------------
# Injectable hosted-database callables (Requirement 10.10). A Backend_Runtime
# worker supplies live-database access; tests supply an in-memory model.
# ---------------------------------------------------------------------------

# hosted_apply(table_key, rows) -> {"inserted_count", "updated_count", "readback"}
HostedApplyFn = Callable[[str, list[Mapping[str, Any]]], Mapping[str, Any]]
# hosted_read(table_key, identity_signatures) -> current hosted rows
HostedReadFn = Callable[[str, list[tuple]], Sequence[Mapping[str, Any]]]


class HostedApplyConflict(Exception):
    """A batch hit a compare-and-set conflict (design C6 convergence path)."""


class HostedApplyFailure(Exception):
    """A batch failed for a non-convergent reason; apply must abort (10.16)."""


class HostedBatchLimitError(Exception):
    """A single apply call was handed more than ``BATCH_LIMIT`` rows (10.9)."""


# ---------------------------------------------------------------------------
# Apply / readback result types (bounded; audit-ready).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BatchApplyRecord:
    """Outcome of one apply batch. Carries counts and a fixed code only."""

    table_key: str
    batch_index: int
    applied: bool
    inserted_count: int
    updated_count: int
    converged_no_op_count: int
    row_count: int
    result_code: str

    def history_row(self, publish_job_id: str) -> dict[str, Any]:
        return {
            "publish_job_id": publish_job_id,
            "stage": STAGE_APPLY,
            "target_table": self.table_key,
            "batch_index": self.batch_index,
            "insert_row_count": self.inserted_count,
            "update_row_count": self.updated_count,
            "total_row_count": self.row_count,
            "result_code": self.result_code,
        }

    def audit_event(self, publish_job_id: str) -> dict[str, Any]:
        return {
            "publish_job_id": publish_job_id,
            "stage": STAGE_APPLY,
            "target_table": self.table_key,
            "row_count": self.row_count,
            "result_code": self.result_code,
        }


@dataclass(frozen=True)
class TableReadbackRecord:
    """Per-table readback summary (Requirements 10.7, 10.15). Counts only."""

    table_key: str
    readback_row_count: int
    matched_row_count: int
    mismatched_row_count: int

    @property
    def has_mismatch(self) -> bool:
        return self.mismatched_row_count > 0

    def history_row(self, publish_job_id: str) -> dict[str, Any]:
        return {
            "publish_job_id": publish_job_id,
            "stage": STAGE_READBACK,
            "target_table": self.table_key,
            "readback_rows": self.readback_row_count,
            "matched_rows": self.matched_row_count,
            "mismatched_rows": self.mismatched_row_count,
            "result_code": (
                PUBLISH_READBACK_MISMATCH
                if self.has_mismatch
                else RESULT_READBACK_MATCHED
            ),
        }

    def audit_event(self, publish_job_id: str) -> dict[str, Any]:
        # 10.15: for a mismatched table, record the table name and the mismatch
        # row count; a matched table records the read row count.
        return {
            "publish_job_id": publish_job_id,
            "stage": STAGE_READBACK,
            "target_table": self.table_key,
            "row_count": (
                self.mismatched_row_count
                if self.has_mismatch
                else self.readback_row_count
            ),
            "result_code": (
                PUBLISH_READBACK_MISMATCH
                if self.has_mismatch
                else RESULT_READBACK_MATCHED
            ),
        }


@dataclass(frozen=True)
class PublishJobResult:
    """Outcome of an apply run under one publish-job identifier.

    ``succeeded`` is True only when apply and readback both completed cleanly.
    ``code`` is ``None`` on success or a member of ``PUBLISH_FAILURE_CODES`` on
    failure. ``audit_events`` and ``history_rows`` are append-only, bounded
    stage records (Requirement 10.8) a Backend_Runtime worker persists to
    ``local_analytics.publish_audit_events`` / ``publish_history``.
    """

    publish_job_id: str
    succeeded: bool
    code: str | None
    completed_batch_count: int
    uncompleted_batch_count: int
    applied_insert_count: int
    applied_update_count: int
    converged_no_op_count: int
    batch_records: tuple[BatchApplyRecord, ...]
    readback_records: tuple[TableReadbackRecord, ...]
    audit_events: tuple[dict[str, Any], ...]
    history_rows: tuple[dict[str, Any], ...]

    def __post_init__(self) -> None:
        # Fail-closed invariant: any failure code is inside the closed set.
        if self.code is not None and self.code not in PUBLISH_FAILURE_CODES:
            raise PublishWorkerError("publish_code_out_of_set")

    def as_dict(self) -> dict[str, Any]:
        return {
            "publishJobId": self.publish_job_id,
            "succeeded": self.succeeded,
            "code": self.code,
            "completedBatchCount": self.completed_batch_count,
            "uncompletedBatchCount": self.uncompleted_batch_count,
            "appliedInsertCount": self.applied_insert_count,
            "appliedUpdateCount": self.applied_update_count,
            "convergedNoOpCount": self.converged_no_op_count,
        }


# ---------------------------------------------------------------------------
# Schedule ledger reader (Requirements 10.14, 10.17). Read-only; never
# generates a cadence or substitutes a default.
# ---------------------------------------------------------------------------


def load_publish_schedule(path: str | None = None) -> Mapping[str, Any] | None:
    """Read the committed publish-schedule ledger, or ``None`` when absent.

    The reader never invents a schedule: a missing file returns ``None`` (which
    fails the activation check), and the document is returned verbatim for the
    caller to inspect. It substitutes no default cadence (Requirement 10.14).
    """

    ledger_path = path or _DEFAULT_PUBLISH_SCHEDULE_PATH
    try:
        with open(ledger_path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
    except FileNotFoundError:
        return None
    if not isinstance(doc, Mapping):
        return None
    return doc


def is_publish_schedule_active(schedule: Mapping[str, Any] | None) -> bool:
    """Return True only when the schedule carries an active operator approval.

    Fails closed: a missing schedule, a malformed approval block, or any status
    other than an active one yields False, so the caller returns
    ``publish_schedule_not_approved`` (Requirement 10.17).
    """

    if not isinstance(schedule, Mapping):
        return False
    if schedule.get("schemaVersion") != 1:
        return False
    if schedule.get("timezone") != "Asia/Seoul":
        return False
    if schedule.get("utcOffsetMinutes") != 540 or schedule.get("cadence") != "daily":
        return False
    start = schedule.get("kstWindowStart")
    end = schedule.get("kstWindowEnd")
    cron = schedule.get("utcCron")
    buffer_minutes = schedule.get("minBufferMinutesAfterHeavyLocal")
    if (
        not isinstance(start, str)
        or not _TIME_OF_DAY_RE.fullmatch(start)
        or not isinstance(end, str)
        or not _TIME_OF_DAY_RE.fullmatch(end)
        or not isinstance(cron, str)
        or len(cron) > 64
        or not isinstance(buffer_minutes, int)
        or isinstance(buffer_minutes, bool)
        or not 0 <= buffer_minutes <= 1440
    ):
        return False
    fields = cron.split()
    if len(fields) != 5 or fields[2:] != ["*", "*", "*"]:
        return False
    try:
        cron_minute, cron_hour = (int(fields[0]), int(fields[1]))
        local_hour, local_minute = (int(part) for part in start.split(":"))
    except ValueError:
        return False
    expected_utc_minutes = (local_hour * 60 + local_minute - 540) % (24 * 60)
    if cron_hour * 60 + cron_minute != expected_utc_minutes:
        return False
    approval = schedule.get("approval")
    return _has_named_approval(approval)


# ---------------------------------------------------------------------------
# Result assembly helpers (append-only audit; single job identifier).
# ---------------------------------------------------------------------------


def _confirm_audit_event(confirm_result: "ConfirmResult") -> dict[str, Any]:
    return {
        "publish_job_id": confirm_result.publish_job_id,
        "stage": STAGE_CONFIRM,
        "target_table": "",
        "row_count": 0,
        "result_code": (
            RESULT_CONFIRM_ADMITTED if confirm_result.admitted else confirm_result.code
        ),
    }


def _failure_result(
    preview: "PublishPreview",
    code: str,
    *,
    stage: str,
    confirm_result: "ConfirmResult | None" = None,
) -> PublishJobResult:
    """Assemble a fail-closed job result for a pre-apply gate rejection."""

    audit: list[dict[str, Any]] = list(preview.audit_events())
    history: list[dict[str, Any]] = list(preview.history_rows())
    if confirm_result is not None:
        audit.append(_confirm_audit_event(confirm_result))
        history.append(confirm_result.history_row())
    audit.append(
        {
            "publish_job_id": preview.publish_job_id,
            "stage": stage,
            "target_table": "",
            "row_count": 0,
            "result_code": code,
        }
    )
    return PublishJobResult(
        publish_job_id=preview.publish_job_id,
        succeeded=False,
        code=code,
        completed_batch_count=0,
        uncompleted_batch_count=0,
        applied_insert_count=0,
        applied_update_count=0,
        converged_no_op_count=0,
        batch_records=(),
        readback_records=(),
        audit_events=tuple(audit),
        history_rows=tuple(history),
    )


def _apply_aborted_result(
    preview: "PublishPreview",
    code: str,
    *,
    confirm_result: "ConfirmResult",
    batch_records: list["BatchApplyRecord"],
    completed_batches: int,
    uncompleted_batches: int,
    insert_total: int,
    update_total: int,
    converged_total: int,
) -> PublishJobResult:
    job_id = preview.publish_job_id
    audit = list(preview.audit_events())
    history = list(preview.history_rows())
    audit.append(_confirm_audit_event(confirm_result))
    history.append(confirm_result.history_row())
    for record in batch_records:
        audit.append(record.audit_event(job_id))
        history.append(record.history_row(job_id))
    return PublishJobResult(
        publish_job_id=job_id,
        succeeded=False,
        code=code,
        completed_batch_count=completed_batches,
        uncompleted_batch_count=uncompleted_batches,
        applied_insert_count=insert_total,
        applied_update_count=update_total,
        converged_no_op_count=converged_total,
        batch_records=tuple(batch_records),
        readback_records=(),
        audit_events=tuple(audit),
        history_rows=tuple(history),
    )


def _completed_job_result(
    preview: "PublishPreview",
    *,
    code: str | None,
    confirm_result: "ConfirmResult",
    batch_records: list["BatchApplyRecord"],
    readback_records: list["TableReadbackRecord"],
    completed_batches: int,
    insert_total: int,
    update_total: int,
    converged_total: int,
) -> PublishJobResult:
    job_id = preview.publish_job_id
    audit = list(preview.audit_events())
    history = list(preview.history_rows())
    audit.append(_confirm_audit_event(confirm_result))
    history.append(confirm_result.history_row())
    for record in batch_records:
        audit.append(record.audit_event(job_id))
        history.append(record.history_row(job_id))
    for record in readback_records:
        audit.append(record.audit_event(job_id))
        history.append(record.history_row(job_id))
    return PublishJobResult(
        publish_job_id=job_id,
        succeeded=code is None,
        code=code,
        completed_batch_count=completed_batches,
        uncompleted_batch_count=0,
        applied_insert_count=insert_total,
        applied_update_count=update_total,
        converged_no_op_count=converged_total,
        batch_records=tuple(batch_records),
        readback_records=tuple(readback_records),
        audit_events=tuple(audit),
        history_rows=tuple(history),
    )


def _index_hosted_rows(
    hosted_rows: Sequence[Mapping[str, Any]], pub_table: "PublicationTable"
) -> dict[tuple, Mapping[str, Any]]:
    indexed: dict[tuple, Mapping[str, Any]] = {}
    for row in hosted_rows:
        if not isinstance(row, Mapping):
            continue
        indexed[_identity_signature(row, pub_table.identity_keys)] = row
    return indexed


def _row_matches_hosted(
    intended: Mapping[str, Any],
    hosted_row: Mapping[str, Any] | None,
    pub_table: "PublicationTable",
) -> bool:
    """True when every intended identity/published value equals the hosted value.

    Only the columns the intended row carries (identity keys + published
    columns, already projected) are compared; hosted-owned columns outside the
    Publication_Set are ignored (design C6: ``updated_at`` is not compared).
    """

    if hosted_row is None:
        return False
    for key in intended:
        if key not in hosted_row:
            return False
        if hosted_row[key] != intended[key]:
            return False
    return True


def _validated_apply_counts(
    outcome: Any, expected_row_count: int
) -> tuple[int, int] | None:
    if not isinstance(outcome, Mapping):
        return None
    inserted = outcome.get("inserted_count")
    updated = outcome.get("updated_count")
    if (
        not isinstance(inserted, int)
        or isinstance(inserted, bool)
        or not isinstance(updated, int)
        or isinstance(updated, bool)
        or inserted < 0
        or updated < 0
        or inserted + updated != expected_row_count
    ):
        return None
    return inserted, updated


# ---------------------------------------------------------------------------
# Request-shape helpers. Structural misuse raises; business refusals do not.
# ---------------------------------------------------------------------------


def _require_publish_job_id(request: Mapping[str, Any]) -> str:
    if not isinstance(request, Mapping):
        raise PublishWorkerError("publish_request_shape_invalid")
    publish_job_id = request.get("publishJobId")
    if not isinstance(publish_job_id, str) or not publish_job_id.strip():
        raise PublishWorkerError("publish_request_shape_invalid")
    return publish_job_id


def _require_table_entries(request: Mapping[str, Any]) -> Sequence[Any]:
    entries = request.get("tables")
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        raise PublishWorkerError("publish_request_shape_invalid")
    return entries


def _read_table_entry(entry: Any) -> tuple[str, str, Sequence[Any]]:
    if not isinstance(entry, Mapping):
        raise PublishWorkerError("publish_request_shape_invalid")
    schema = entry.get("schema")
    table = entry.get("table")
    rows = entry.get("rows", [])
    if not isinstance(schema, str) or not isinstance(table, str):
        raise PublishWorkerError("publish_request_shape_invalid")
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        raise PublishWorkerError("publish_request_shape_invalid")
    return schema, table, rows


def _normalize_existing_keys(
    existing_identity_keys: Mapping[str, Iterable[tuple]] | None, table_key: str
) -> set[tuple]:
    if not existing_identity_keys:
        return set()
    raw = existing_identity_keys.get(table_key)
    if not raw:
        return set()
    return {tuple(signature) for signature in raw}


# ---------------------------------------------------------------------------
# Shared table projection (preview + apply). Validates each table/column
# against the Publication_Set, drops marker-carrying rows, projects each row to
# its identity + published columns, and classifies inserts vs updates.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ProjectionResult:
    """Outcome of validating and projecting a publish request.

    On a non-admitted target ``code`` is ``publication_target_not_admitted`` and
    the other fields are empty. Otherwise ``code`` is ``None``, ``tables_rows``
    maps ``schema.table`` to projected rows (identity + published columns only),
    and ``table_previews`` carries per-table insert/update/total counts.
    """

    code: str | None
    tables_rows: dict[str, list[Mapping[str, Any]]]
    table_previews: list[TablePreview]
    excluded_marked_row_count: int


def _project_tables(
    publication_set: PublicationSet,
    request: Mapping[str, Any],
    existing_identity_keys: Mapping[str, Iterable[tuple]] | None,
) -> _ProjectionResult:
    """Validate and project a publish request against the Publication_Set.

    Marker-carrying local-test rows are dropped before any column validation,
    counting, or projection (Requirement 9.8). A table or column not enumerated
    in the Publication_Set, or a row missing an identity key, yields
    ``publication_target_not_admitted`` with no projected rows (Requirements
    10.2, 10.3). This is the single validation path shared by ``preview`` (which
    hashes ``tables_rows`` and reports the counts) and ``apply`` (which batches
    ``tables_rows`` and re-derives the hash to bind the applied rows to the
    confirmed preview).
    """

    table_entries = _require_table_entries(request)
    table_previews: list[TablePreview] = []
    tables_rows: dict[str, list[Mapping[str, Any]]] = {}
    excluded_total = 0
    seen_table_keys: set[str] = set()

    for entry in table_entries:
        schema, table, rows = _read_table_entry(entry)
        pub_table = publication_set.get(schema, table)
        if pub_table is None:
            # Table not enumerated in the Publication_Set (10.3).
            return _ProjectionResult(
                code=PUBLICATION_TARGET_NOT_ADMITTED,
                tables_rows={},
                table_previews=[],
                excluded_marked_row_count=0,
            )
        if pub_table.key in seen_table_keys:
            return _ProjectionResult(
                code=PUBLICATION_TARGET_NOT_ADMITTED,
                tables_rows={},
                table_previews=[],
                excluded_marked_row_count=0,
            )
        seen_table_keys.add(pub_table.key)

        # Drop marker-carrying local-test rows before any validation of columns,
        # counting, or projection (9.8).
        exclusion = exclude_marked_from_publication(rows)
        excluded_total += exclusion.excludedRecordCount
        kept_rows = exclusion.kept

        existing = _normalize_existing_keys(existing_identity_keys, pub_table.key)

        insert_count = 0
        update_count = 0
        projected_rows: list[Mapping[str, Any]] = []
        seen_signatures: set[tuple] = set()
        for row in kept_rows:
            if not isinstance(row, Mapping):
                return _ProjectionResult(
                    code=PUBLICATION_TARGET_NOT_ADMITTED,
                    tables_rows={},
                    table_previews=[],
                    excluded_marked_row_count=0,
                )
            row_keys = set(row.keys())
            # Any column outside the enumerated allowed set -> not admitted
            # (10.3). Every identity key must be present so the row is an
            # identifiable, enumerated target.
            if (
                not row_keys.issubset(pub_table.allowed_columns)
                or row_keys.isdisjoint(pub_table.published_columns)
            ):
                return _ProjectionResult(
                    code=PUBLICATION_TARGET_NOT_ADMITTED,
                    tables_rows={},
                    table_previews=[],
                    excluded_marked_row_count=0,
                )
            if not set(pub_table.identity_keys).issubset(row_keys):
                return _ProjectionResult(
                    code=PUBLICATION_TARGET_NOT_ADMITTED,
                    tables_rows={},
                    table_previews=[],
                    excluded_marked_row_count=0,
                )

            signature = _identity_signature(row, pub_table.identity_keys)
            if any(value is None for value in signature) or signature in seen_signatures:
                return _ProjectionResult(
                    code=PUBLICATION_TARGET_NOT_ADMITTED,
                    tables_rows={},
                    table_previews=[],
                    excluded_marked_row_count=0,
                )
            seen_signatures.add(signature)

            projected = {key: row[key] for key in sorted(row_keys)}
            projected_rows.append(projected)

            if signature in existing:
                update_count += 1
            else:
                insert_count += 1

        tables_rows[pub_table.key] = projected_rows
        table_previews.append(
            TablePreview(
                schema=schema,
                table=table,
                insert_row_count=insert_count,
                update_row_count=update_count,
                total_row_count=len(projected_rows),
            )
        )

    return _ProjectionResult(
        code=None,
        tables_rows=tables_rows,
        table_previews=table_previews,
        excluded_marked_row_count=excluded_total,
    )
