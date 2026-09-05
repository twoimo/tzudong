#!/usr/bin/env python3
"""Seed-fixture marker enforcement and applied-migration immutability guard.

Feature: platform-modernization, Task 7 (design section C5, "시드 픽스처 표기").

This module owns two fail-closed contracts from Requirement 9:

  * Seed-fixture marker (Requirements 9.8, 9.11).
    Every Local_Database seed-fixture record must carry the exact marker token
    ``LOCAL_TEST_ONLY:NOT_PRODUCTION``. Records that carry the marker are
    EXCLUDED from Publication_Set publish input (9.8). A request to load a seed
    fixture where ANY record lacks the marker loads NO rows at all and returns
    the fixed code ``seed_fixture_marker_missing`` (9.11).

  * Applied-migration immutability (Requirement 9.2).
    A request to change the CONTENT or the FILENAME of an already-applied
    Supabase migration is rejected with the fixed code
    ``applied_migration_immutable``. Correction is admitted only by ADDING a new
    migration file (a filename not already present in the applied set).

The two contracts share this module because both express the same principle:
the local test surface never masquerades as production, and applied schema is
never mutated in place. Nothing here writes to a database or runs migrations;
the logic is pure and inputs are injectable so it is unit-testable without a
live stack. Every result is a bounded dict of counts and fixed codes — it never
carries row values, provider diagnostics, database error strings, free-form
error text, or any Forbidden_Log_Field.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its callers/tests.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Iterable, Mapping, NamedTuple, Sequence

# ---------------------------------------------------------------------------
# Marker token (design C5). The exact, machine-readable provenance that marks a
# record as local-test-only and never-production. It is matched verbatim; no
# case folding, prefix stripping, or normalization is applied.
# ---------------------------------------------------------------------------

LOCAL_TEST_ONLY_MARKER = "LOCAL_TEST_ONLY:NOT_PRODUCTION"

# ---------------------------------------------------------------------------
# Fixed codes (design C5; error-code catalog rows 9.2 / 9.11).
# ---------------------------------------------------------------------------

# A seed-fixture load was requested where at least one record lacks the marker
# (Requirement 9.11). Fail closed: load zero rows.
SEED_FIXTURE_MARKER_MISSING = "seed_fixture_marker_missing"

# A change to the content or filename of an already-applied migration was
# requested (Requirement 9.2). Correction is admitted only via a new file.
APPLIED_MIGRATION_IMMUTABLE = "applied_migration_immutable"

# Bounded recursion depth when scanning a record for the marker token. Seed
# fixtures are shallow rows; this cap guards against pathological nesting
# without changing the outcome for well-formed fixtures.
MARKER_SCAN_MAX_DEPTH = 6

# Default location of the applied Supabase migration set.
MIGRATIONS_DIR = "backend/supabase/migrations"


# ---------------------------------------------------------------------------
# Marker detection.
# ---------------------------------------------------------------------------


def _contains_marker(value: Any, *, depth: int) -> bool:
    """Return True if the marker token appears in any string within ``value``.

    Recurses through mappings and non-string sequences up to
    ``MARKER_SCAN_MAX_DEPTH``. The comparison is a verbatim substring test
    against ``LOCAL_TEST_ONLY_MARKER``.
    """

    if depth < 0:
        return False
    if isinstance(value, str):
        return LOCAL_TEST_ONLY_MARKER in value
    if isinstance(value, Mapping):
        return any(_contains_marker(item, depth=depth - 1) for item in value.values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_contains_marker(item, depth=depth - 1) for item in value)
    return False


def record_carries_marker(record: Any) -> bool:
    """Return whether a single seed-fixture record carries the marker token.

    A record carries the marker when the exact token
    ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` appears as a substring of any string
    value in the record (searched to a bounded depth). This matches how the
    local seed embeds the marker in provenance fields such as ``source`` and
    ``operator_approval_ref``.
    """

    return _contains_marker(record, depth=MARKER_SCAN_MAX_DEPTH)


# ---------------------------------------------------------------------------
# Seed-fixture load evaluation (Requirement 9.11).
# ---------------------------------------------------------------------------


class SeedLoadDecision(NamedTuple):
    """Bounded outcome of a seed-fixture load evaluation.

    Attributes:
        admitted: True only when every record carries the marker.
        code: ``seed_fixture_marker_missing`` when rejected, else ``None``.
        totalRecordCount: number of records in the request.
        unmarkedRecordCount: number of records lacking the marker.
        loadedRowCount: rows the caller may load — 0 unless admitted.
    """

    admitted: bool
    code: str | None
    totalRecordCount: int
    unmarkedRecordCount: int
    loadedRowCount: int

    def as_dict(self) -> dict:
        """Return a JSON-safe bounded dict (counts and fixed code only)."""

        return {
            "admitted": self.admitted,
            "code": self.code,
            "totalRecordCount": self.totalRecordCount,
            "unmarkedRecordCount": self.unmarkedRecordCount,
            "loadedRowCount": self.loadedRowCount,
        }


def evaluate_seed_fixture_load(records: Sequence[Any]) -> SeedLoadDecision:
    """Decide whether a seed fixture may be loaded (Requirement 9.11).

    Fail closed and atomic: if ANY record lacks the marker, NO rows are
    admitted (``loadedRowCount`` is 0) and the fixed code
    ``seed_fixture_marker_missing`` is returned. Only when every record carries
    the marker is the full set admitted.
    """

    materialized = list(records)
    total = len(materialized)
    unmarked = sum(1 for record in materialized if not record_carries_marker(record))

    if unmarked:
        return SeedLoadDecision(
            admitted=False,
            code=SEED_FIXTURE_MARKER_MISSING,
            totalRecordCount=total,
            unmarkedRecordCount=unmarked,
            loadedRowCount=0,
        )
    return SeedLoadDecision(
        admitted=True,
        code=None,
        totalRecordCount=total,
        unmarkedRecordCount=0,
        loadedRowCount=total,
    )


def admit_seed_fixture_rows(records: Sequence[Any]) -> tuple[tuple[Any, ...], SeedLoadDecision]:
    """Return the rows the caller may load together with the decision.

    When the decision is not admitted the row tuple is EMPTY, enforcing the
    "load no rows" contract at the call site (Requirement 9.11).
    """

    decision = evaluate_seed_fixture_load(records)
    if not decision.admitted:
        return (), decision
    return tuple(records), decision


# ---------------------------------------------------------------------------
# Publication exclusion (Requirement 9.8).
# ---------------------------------------------------------------------------


class PublicationExclusion(NamedTuple):
    """Result of excluding marked seed rows from publish input.

    Attributes:
        kept: records that do NOT carry the marker (eligible publish input).
        excludedRecordCount: number of marked records removed.
        keptRecordCount: number of records retained.
    """

    kept: tuple[Any, ...]
    excludedRecordCount: int
    keptRecordCount: int


def exclude_marked_from_publication(records: Iterable[Any]) -> PublicationExclusion:
    """Exclude marker-carrying records from Publication_Set publish input.

    Any record carrying ``LOCAL_TEST_ONLY:NOT_PRODUCTION`` is dropped from the
    publish input (Requirement 9.8). Because every Local_Database seed fixture
    record carries the marker, a seed-derived input yields zero kept records.
    """

    kept: list[Any] = []
    excluded = 0
    for record in records:
        if record_carries_marker(record):
            excluded += 1
        else:
            kept.append(record)
    return PublicationExclusion(
        kept=tuple(kept),
        excludedRecordCount=excluded,
        keptRecordCount=len(kept),
    )


# ---------------------------------------------------------------------------
# Applied-migration immutability (Requirement 9.2).
# ---------------------------------------------------------------------------

# The set of change kinds a request may express. Only ``add_new_file`` can be
# admitted; the mutating kinds against an applied file are always rejected.
CHANGE_CONTENT = "content_change"
CHANGE_FILENAME = "filename_change"
CHANGE_DELETE = "delete"
CHANGE_ADD_NEW_FILE = "add_new_file"

MUTATING_CHANGE_KINDS: frozenset[str] = frozenset(
    {CHANGE_CONTENT, CHANGE_FILENAME, CHANGE_DELETE}
)
ALL_CHANGE_KINDS: frozenset[str] = MUTATING_CHANGE_KINDS | {CHANGE_ADD_NEW_FILE}


class MigrationChangeDecision(NamedTuple):
    """Bounded outcome of a migration-change evaluation.

    Attributes:
        admitted: True only for a new-file addition.
        code: ``applied_migration_immutable`` when rejected, else ``None``.
        targetFilename: the migration filename the request targeted.
        changeKind: the requested change kind.
    """

    admitted: bool
    code: str | None
    targetFilename: str
    changeKind: str

    def as_dict(self) -> dict:
        return {
            "admitted": self.admitted,
            "code": self.code,
            "targetFilename": self.targetFilename,
            "changeKind": self.changeKind,
        }


def load_applied_migration_filenames(
    *,
    repo_root: Path | None = None,
    migrations_dir: str = MIGRATIONS_DIR,
) -> frozenset[str]:
    """Return the applied migration filenames present in the migrations dir.

    The applied set is the ``*.sql`` files already committed under
    ``backend/supabase/migrations/``. An absent directory yields an empty set.
    Only bare filenames (not full paths) are returned.
    """

    root = repo_root or _repo_root()
    path = root / migrations_dir
    if not path.is_dir():
        return frozenset()
    return frozenset(entry.name for entry in path.glob("*.sql") if entry.is_file())


def _basename(target: str) -> str:
    """Return the bare filename for a target that may be a path."""

    return Path(target).name if target else ""


def evaluate_migration_change(
    *,
    target_filename: str,
    change_kind: str,
    applied_filenames: Iterable[str],
) -> MigrationChangeDecision:
    """Evaluate a requested change against the applied migration set (9.2).

    Rejection with ``applied_migration_immutable`` occurs when:

      * a content change, filename change, or deletion targets a filename that
        is already in the applied set; or
      * an ``add_new_file`` reuses a filename already in the applied set (which
        would overwrite applied content).

    Admission occurs only when ``add_new_file`` targets a filename NOT already
    in the applied set. Any unknown change kind is rejected (fail closed).
    """

    applied = {_basename(name) for name in applied_filenames}
    target = _basename(target_filename)
    is_applied = target in applied

    if change_kind == CHANGE_ADD_NEW_FILE:
        admitted = not is_applied
        return MigrationChangeDecision(
            admitted=admitted,
            code=None if admitted else APPLIED_MIGRATION_IMMUTABLE,
            targetFilename=target,
            changeKind=change_kind,
        )

    # Mutating kinds against an applied file, and every unknown kind, are
    # rejected. A mutating kind against a non-applied file is also rejected:
    # there is no applied object to mutate, and correction is only via a new
    # file, so we never admit an in-place mutation.
    return MigrationChangeDecision(
        admitted=False,
        code=APPLIED_MIGRATION_IMMUTABLE,
        targetFilename=target,
        changeKind=change_kind,
    )


def evaluate_migration_content_change(
    *,
    target_filename: str,
    new_content: str,
    applied_hashes: Mapping[str, str],
) -> MigrationChangeDecision:
    """Reject a content edit of an applied migration by hash comparison (9.2).

    ``applied_hashes`` maps applied filenames to their recorded SHA-256 hashes.
    When the target is an applied file and the new content's hash differs from
    the recorded hash, the change is a content mutation and is rejected. An
    identical hash is a no-op (admitted, nothing changes). A target absent from
    the applied set is a new file and is admitted.
    """

    target = _basename(target_filename)
    recorded = applied_hashes.get(target)
    if recorded is None:
        # Not an applied migration: this is a new file addition.
        return MigrationChangeDecision(
            admitted=True,
            code=None,
            targetFilename=target,
            changeKind=CHANGE_ADD_NEW_FILE,
        )

    new_hash = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
    if new_hash == recorded:
        # Byte-identical: not a mutation.
        return MigrationChangeDecision(
            admitted=True,
            code=None,
            targetFilename=target,
            changeKind=CHANGE_CONTENT,
        )
    return MigrationChangeDecision(
        admitted=False,
        code=APPLIED_MIGRATION_IMMUTABLE,
        targetFilename=target,
        changeKind=CHANGE_CONTENT,
    )


# ---------------------------------------------------------------------------
# Repo-root resolution.
# ---------------------------------------------------------------------------


def _repo_root() -> Path:
    # backend/bin/seed_fixture_guard.py -> backend/bin -> backend -> <repo>
    return Path(__file__).resolve().parents[2]
