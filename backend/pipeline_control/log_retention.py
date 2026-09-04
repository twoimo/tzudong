"""Log_Pipeline retention gate (design B "보존 분류", requirements 13.12, 13.16).

Retention is a *gated* concern. Requirements 13.12 and 13.16, together with
``AGENTS.md`` ("retention periods and legal bases come only from active
operator-approved classes; code must not invent periods"), require that this
module:

1. never define a retention period in code and never synthesize a default one;
2. read proposed classes only from the committed, read-only ledger
   ``backend/deploy/log-retention.proposed.json``; and
3. perform no retention / expiry / deletion work and return the bounded fixed
   code ``retention_class_unavailable`` whenever there is no *active*
   operator-approved retention class.

The committed ledger records **proposed** classes only. Activation is a named
human's operator-approval decision (design B). This source tree does not claim
that decision was made: every proposed class ships with
``activation.status = "unresolved"`` and ``approverName = null``. Because no
class is active, the gate below always fails closed today, which is the intended
state.

This module only *reads* the ledger. It never writes it, never activates a
class, and never fills ``approverName`` / ``approvedAt``. Only bounded fixed
codes are surfaced; provider and database error strings are never exposed
(``AGENTS.md``).
"""

from __future__ import annotations

import json
import os
from typing import Any, Mapping

# --- Fixed code (design fixed-code table, requirement 13.16) --------------
# No active operator-approved retention class exists, so no retention, expiry,
# or deletion is performed and no default period is applied.
CODE_RETENTION_CLASS_UNAVAILABLE = "retention_class_unavailable"

# Activation statuses that admit retention work. Mirrors the publish-schedule
# gate (``publish_worker._ACTIVE_SCHEDULE_STATUSES``): only an explicit
# operator ``approved`` activation opens the gate. Any other value -- including
# the design's default ``unresolved`` -- fails closed.
_ACTIVE_RETENTION_STATUSES: frozenset[str] = frozenset({"approved"})

# Committed, read-only ledger location. This module never writes it.
_DEFAULT_RETENTION_LEDGER_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "deploy",
        "log-retention.proposed.json",
    )
)


class LogRetentionError(Exception):
    """Bounded fixed-code error for the retention gate.

    ``code`` is always :data:`CODE_RETENTION_CLASS_UNAVAILABLE`; no provider or
    database diagnostics are ever attached.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def load_retention_proposal(path: str | None = None) -> Mapping[str, Any] | None:
    """Read the committed retention ledger, or ``None`` when absent/malformed.

    The reader invents nothing: a missing file, unreadable content, or a
    non-object document all return ``None`` (which fails the activation check
    below). The document is returned verbatim for the caller to inspect. No
    period value is ever synthesized here (requirement 13.12).
    """
    ledger_path = path or _DEFAULT_RETENTION_LEDGER_PATH
    try:
        with open(ledger_path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        # Fail closed on any read/parse problem; never surface the diagnostic.
        return None
    if not isinstance(doc, Mapping):
        return None
    return doc


def _is_active_class(proposed_class: Any) -> bool:
    """True only when a class carries an active operator-approved activation."""
    if not isinstance(proposed_class, Mapping):
        return False
    activation = proposed_class.get("activation")
    if not isinstance(activation, Mapping):
        return False
    if activation.get("status") not in _ACTIVE_RETENTION_STATUSES:
        return False
    # An active status without a named approver is not a valid activation; the
    # design requires a named human to fill ``approverName``.
    approver = activation.get("approverName")
    return isinstance(approver, str) and approver.strip() != ""


def active_retention_classes(
    proposal: Mapping[str, Any] | None,
) -> list[Mapping[str, Any]]:
    """Return the proposed classes that carry an active operator approval.

    Fails closed: a missing/malformed proposal, a missing ``proposedClasses``
    list, or classes without an active approved activation all yield an empty
    list. Given the committed ledger ships every class as ``unresolved`` with a
    null approver, this returns ``[]`` today (requirements 13.12, 13.16).
    """
    if not isinstance(proposal, Mapping):
        return []
    classes = proposal.get("proposedClasses")
    if not isinstance(classes, (list, tuple)):
        return []
    return [item for item in classes if _is_active_class(item)]


def retention_gate(path: str | None = None) -> dict[str, Any]:
    """Evaluate the retention gate against the committed ledger.

    Returns a bounded result mapping. When no active operator-approved class
    exists, retention / expiry / deletion is *not* performed and the result
    carries the fixed code ``retention_class_unavailable`` with no period value
    (requirement 13.16). When one or more active classes exist, the result
    reports the active class ids so a caller can act on the operator-approved
    periods read from the ledger -- this module never invents them
    (requirement 13.12).

    The gate itself performs no expiry/deletion; it only decides whether such
    work is admitted. A caller must treat ``admitted = False`` as "do nothing".
    """
    proposal = load_retention_proposal(path)
    active = active_retention_classes(proposal)
    if not active:
        return {
            "admitted": False,
            "code": CODE_RETENTION_CLASS_UNAVAILABLE,
            "activeClassIds": [],
        }
    class_ids = [
        str(item.get("classId"))
        for item in active
        if isinstance(item.get("classId"), str)
    ]
    return {
        "admitted": True,
        "code": None,
        "activeClassIds": class_ids,
    }


def require_active_retention(path: str | None = None) -> list[Mapping[str, Any]]:
    """Return active retention classes or raise the bounded fixed code.

    Convenience wrapper for callers that want a fail-closed guard: raises
    :class:`LogRetentionError` with ``retention_class_unavailable`` when no
    active operator-approved class exists, so no retention/expiry/deletion work
    proceeds and no default period is applied (requirement 13.16).
    """
    proposal = load_retention_proposal(path)
    active = active_retention_classes(proposal)
    if not active:
        raise LogRetentionError(CODE_RETENTION_CLASS_UNAVAILABLE)
    return active


__all__ = [
    "CODE_RETENTION_CLASS_UNAVAILABLE",
    "LogRetentionError",
    "active_retention_classes",
    "load_retention_proposal",
    "require_active_retention",
    "retention_gate",
]
