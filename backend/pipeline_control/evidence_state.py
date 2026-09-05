"""Pure evidence-state helper for the Migration_Readiness_Manifest.

Feature: platform-modernization (Requirements 14.8, 14.13). This module holds
the closed-set status vocabulary and the fail-closed admission rule for the
external-evidence gate that the Migration_Readiness_Manifest records:

  * Status is one of exactly two values: ``unresolved`` or
    ``external_evidence_confirmed`` (design section C10 "증거 게이트",
    Requirement 14.13).
  * An item may be ``external_evidence_confirmed`` ONLY when it carries a
    non-empty external-evidence reference identifier. No reference implies the
    item can never be confirmed; it fails closed to ``unresolved`` (Requirements
    14.8, 14.13).

The functions here are pure (no I/O, no logging, no persistence) so Task 48 can
reuse them when it materializes ``backend/deploy/migration-readiness.v1.json``.
No Forbidden_Log_Field value is read, produced, or embedded; rejection uses a
single bounded fixed code.
"""

from __future__ import annotations

from typing import Any, Mapping

# Closed-set status vocabulary (Requirement 14.13, design C10).
STATUS_UNRESOLVED = "unresolved"
STATUS_EXTERNAL_EVIDENCE_CONFIRMED = "external_evidence_confirmed"
STATUS_VALUES = frozenset({STATUS_UNRESOLVED, STATUS_EXTERNAL_EVIDENCE_CONFIRMED})

# Canonical manifest field names Task 48 reuses.
STATUS_KEY = "status"
REFERENCE_KEY = "evidenceReference"

# Single bounded fixed code for callers that want rejection rather than the
# fail-closed downgrade. Bounded, non-empty, carries no diagnostic detail.
EVIDENCE_REFERENCE_MISSING = "evidence_reference_missing"


def is_valid_status(status: Any) -> bool:
    """True only for the two admitted status literals."""

    return status in STATUS_VALUES


def has_external_reference(reference: Any) -> bool:
    """True only when a non-empty external-evidence reference is present.

    Absent (``None``), non-string, or blank/whitespace-only references do not
    count as a reference. This is the sole predicate that can license a
    confirmed status.
    """

    return isinstance(reference, str) and bool(reference.strip())


def is_confirmed_admissible(status: Any, reference: Any) -> bool:
    """True IFF ``status`` is confirmed AND a non-empty reference is present.

    Encodes the invariant "no reference implies not confirmed": whenever the
    reference is absent/empty this returns ``False`` regardless of the claimed
    status, so a confirmed status is admissible only with a real reference.
    """

    return status == STATUS_EXTERNAL_EVIDENCE_CONFIRMED and has_external_reference(reference)


def resolve_evidence_status(item: Mapping[str, Any]) -> str:
    """Return the admissible status for an evidence item, failing closed.

    Reads the claimed status and reference from the item and returns
    ``external_evidence_confirmed`` only when the claimed status is exactly that
    value and a non-empty external-evidence reference is present. Every other
    case (unknown/invalid status, confirmed-without-reference, or an explicit
    ``unresolved``) fails closed to ``unresolved``.
    """

    if not isinstance(item, Mapping):
        return STATUS_UNRESOLVED
    status = item.get(STATUS_KEY)
    reference = item.get(REFERENCE_KEY)
    if is_confirmed_admissible(status, reference):
        return STATUS_EXTERNAL_EVIDENCE_CONFIRMED
    return STATUS_UNRESOLVED


def admit_confirmation(status: Any, reference: Any) -> dict[str, Any]:
    """Reject-style admission with a bounded fixed code.

    Returns ``{"ok": True, "code": None, "status": <resolved>}`` when the
    confirmation is admissible, otherwise ``{"ok": False, ...}`` carrying the
    single bounded fixed code and the fail-closed ``unresolved`` status. The
    fixed code never carries request-specific or Forbidden_Log_Field detail.
    """

    if is_confirmed_admissible(status, reference):
        return {"ok": True, "code": None, "status": STATUS_EXTERNAL_EVIDENCE_CONFIRMED}
    return {"ok": False, "code": EVIDENCE_REFERENCE_MISSING, "status": STATUS_UNRESOLVED}
