"""Shared structural-integrity validator for repo-owned ledger documents.

Pure-logic module for the platform-modernization feature (design Property 1,
"원장 구조 무결성"). It provides a single entry point,
``validate_ledger(kind, document)``, that decides whether a repo-owned ledger
document is structurally sound.

The validator follows the ``{"ok", "errorCode"}`` dict-return convention and
the bounded fixed-code discipline established by
``backend/pipeline_control/schedule.py`` and ``profiles.py``: ``errorCode`` is
drawn from a closed set of short, stable strings and is ``None`` on acceptance.

Per design Property 1 a document is accepted (``ok=True``) if and only if it
has *none* of the following defects:

  * a required field is empty (missing, ``None``, or blank), or
  * a closed-set field holds a value outside its permitted set, or
  * an identifier that must be unique is duplicated, or
  * a document-kind cardinality rule is violated (Tooling_Selection_Record
    category candidate count outside 2..6, Phase_Gate not carrying exactly one
    Rollback_Plan reference, or Performance_Evidence_Set repetition/sample
    count below 7 or a summary statistic other than ``p75``).

The seven repo-owned ledger kinds and their structural contracts derive from
the design Data Models and component sections (D1, D3, D4, D9, C3, C7, C10).

The module performs no I/O and reads no environment.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Closed sets and cardinality constants. These mirror the design Data Models
# and the constants declared in the Property 1 test.
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 1

MIGRATION_REPLACEMENT_SCOPES = ("partial_replacement", "full_replacement")
MIGRATION_ACTIVE_IMPLS = ("python", "rust")
LAYOUT_CLASSIFICATIONS = ("source", "build_artifact", "local_ephemeral")
RENAME_CONTRACT_CLASSES = (
    "internal-path",
    "runner-contract",
    "test-loader-contract",
    "operator-cli-contract",
    "regression-fixture-contract",
)

MIN_SAMPLE_COUNT = 7
SUMMARY_STATISTIC = "p75"
TOOLING_MIN_CANDIDATES = 2
TOOLING_MAX_CANDIDATES = 6

LEDGER_KINDS = (
    "migration_ledger",
    "performance_evidence_set",
    "layout_manifest",
    "rename_ledger",
    "tooling_selection_record",
    "deployment_descriptor_set",
    "phase_gate",
)

# ---------------------------------------------------------------------------
# Closed set of rejection codes. ``None`` means accepted.
# ---------------------------------------------------------------------------
ERROR_REQUIRED_FIELD_MISSING = "ledger_required_field_missing"
ERROR_CLOSED_SET_VIOLATION = "ledger_closed_set_violation"
ERROR_DUPLICATE_IDENTIFIER = "ledger_duplicate_identifier"
ERROR_CARDINALITY_VIOLATION = "ledger_cardinality_violation"
ERROR_KIND_UNKNOWN = "ledger_kind_unknown"
ERROR_SHAPE_INVALID = "ledger_shape_invalid"

# Migration_Ledger path-exclusivity rejection codes (design Property 2, D1
# invariants for requirements 1.1 and 1.7). Distinct from the structural
# Property 1 codes above so a caller can tell a duplicate replaced path from an
# excluded/replaced overlap.
ERROR_REPLACED_PATH_DUPLICATE = "migration_replaced_path_duplicate"
ERROR_EXCLUDED_PATH_OVERLAP = "migration_excluded_path_overlap"

LEDGER_ERROR_CODES = frozenset(
    {
        None,
        ERROR_REQUIRED_FIELD_MISSING,
        ERROR_CLOSED_SET_VIOLATION,
        ERROR_DUPLICATE_IDENTIFIER,
        ERROR_CARDINALITY_VIOLATION,
        ERROR_KIND_UNKNOWN,
        ERROR_SHAPE_INVALID,
        ERROR_REPLACED_PATH_DUPLICATE,
        ERROR_EXCLUDED_PATH_OVERLAP,
    }
)


# ---------------------------------------------------------------------------
# Small shared predicates.
# ---------------------------------------------------------------------------
def _is_blank(value: Any) -> bool:
    """A required scalar is blank when missing, ``None``, or whitespace-only."""

    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _nonempty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _duplicated(values: list) -> bool:
    return len(values) != len(set(values))


def _ok(kind: str) -> dict:
    return {"ok": True, "errorCode": None}


def _reject(code: str) -> dict:
    return {"ok": False, "errorCode": code}


# ---------------------------------------------------------------------------
# Per-kind validators. Each returns a fixed-code result dict. The accept/reject
# boolean must agree with the Property 1 test oracle for every document.
# ---------------------------------------------------------------------------
def _validate_migration_ledger(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return _reject(ERROR_SHAPE_INVALID)
    slices = doc.get("slices")
    if not _nonempty_list(slices):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    ids = []
    for item in slices:
        if not isinstance(item, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(item.get("sliceId")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        ids.append(item.get("sliceId"))
        if not _nonempty_list(item.get("replacedPythonPaths")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if not _nonempty_list(item.get("rustArtifactPaths")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if item.get("replacementScope") not in MIGRATION_REPLACEMENT_SCOPES:
            return _reject(ERROR_CLOSED_SET_VIOLATION)
        if item.get("activeImplementation") not in MIGRATION_ACTIVE_IMPLS:
            return _reject(ERROR_CLOSED_SET_VIOLATION)

    if _duplicated(ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("migration_ledger")


def _validate_performance_evidence_set(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    for field in ("evidenceSetId", "sliceId", "metricKey"):
        if _is_blank(doc.get(field)):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
    rep = doc.get("repetitionCount")
    if isinstance(rep, bool) or not isinstance(rep, int) or rep < MIN_SAMPLE_COUNT:
        return _reject(ERROR_CARDINALITY_VIOLATION)
    if doc.get("summaryStatistic") != SUMMARY_STATISTIC:
        return _reject(ERROR_CLOSED_SET_VIOLATION)
    return _ok("performance_evidence_set")


def _validate_layout_manifest(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return _reject(ERROR_SHAPE_INVALID)
    entries = doc.get("entries")
    if not _nonempty_list(entries):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    paths = []
    for entry in entries:
        if not isinstance(entry, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(entry.get("path")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        paths.append(entry.get("path"))
        if _is_blank(entry.get("ownership")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if not _nonempty_list(entry.get("allowedContents")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if not _nonempty_list(entry.get("forbiddenContents")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if entry.get("classification") not in LAYOUT_CLASSIFICATIONS:
            return _reject(ERROR_CLOSED_SET_VIOLATION)

    if _duplicated(paths):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("layout_manifest")


def _validate_rename_ledger(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return _reject(ERROR_SHAPE_INVALID)
    entries = doc.get("entries")
    if not _nonempty_list(entries):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    ids = []
    for entry in entries:
        if not isinstance(entry, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(entry.get("renameId")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        ids.append(entry.get("renameId"))
        if _is_blank(entry.get("oldName")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if _is_blank(entry.get("newName")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if entry.get("contractClass") not in RENAME_CONTRACT_CLASSES:
            return _reject(ERROR_CLOSED_SET_VIOLATION)

    if _duplicated(ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("rename_ledger")


def _validate_tooling_selection_record(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    categories = doc.get("categories")
    if not _nonempty_list(categories):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    category_ids = []
    candidate_ids = []
    for category in categories:
        if not isinstance(category, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(category.get("categoryId")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        category_ids.append(category.get("categoryId"))
        candidates = category.get("candidates")
        if not isinstance(candidates, list):
            return _reject(ERROR_SHAPE_INVALID)
        if not (TOOLING_MIN_CANDIDATES <= len(candidates) <= TOOLING_MAX_CANDIDATES):
            return _reject(ERROR_CARDINALITY_VIOLATION)
        for candidate in candidates:
            if not isinstance(candidate, dict):
                return _reject(ERROR_SHAPE_INVALID)
            if _is_blank(candidate.get("candidateId")):
                return _reject(ERROR_REQUIRED_FIELD_MISSING)
            candidate_ids.append(candidate.get("candidateId"))

    if _duplicated(category_ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    if _duplicated(candidate_ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("tooling_selection_record")


def _validate_deployment_descriptor_set(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    components = doc.get("components")
    if not _nonempty_list(components):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    ids = []
    for component in components:
        if not isinstance(component, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(component.get("componentId")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        ids.append(component.get("componentId"))
        if _is_blank(component.get("imageRef")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if _is_blank(component.get("resourceRequest")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if not _nonempty_list(component.get("envVars")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        if not _nonempty_list(component.get("secretRefs")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)

    if _duplicated(ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("deployment_descriptor_set")


def _validate_phase_gate(doc: Any) -> dict:
    if not isinstance(doc, dict):
        return _reject(ERROR_SHAPE_INVALID)
    if doc.get("schemaVersion") != SCHEMA_VERSION:
        return _reject(ERROR_SHAPE_INVALID)
    if _is_blank(doc.get("phaseId")):
        return _reject(ERROR_REQUIRED_FIELD_MISSING)

    entry = doc.get("entryConditions")
    exit_conditions = doc.get("exitConditions")
    if not _nonempty_list(entry):
        return _reject(ERROR_CARDINALITY_VIOLATION)
    if not _nonempty_list(exit_conditions):
        return _reject(ERROR_CARDINALITY_VIOLATION)
    if not _nonempty_list(doc.get("verificationCommands")):
        return _reject(ERROR_REQUIRED_FIELD_MISSING)

    refs = doc.get("rollbackPlanRefs")
    if not isinstance(refs, list) or len(refs) != 1 or _is_blank(refs[0]):
        return _reject(ERROR_CARDINALITY_VIOLATION)

    condition_ids = []
    for condition in list(entry) + list(exit_conditions):
        if not isinstance(condition, dict):
            return _reject(ERROR_SHAPE_INVALID)
        if _is_blank(condition.get("conditionId")):
            return _reject(ERROR_REQUIRED_FIELD_MISSING)
        condition_ids.append(condition.get("conditionId"))

    if _duplicated(condition_ids):
        return _reject(ERROR_DUPLICATE_IDENTIFIER)
    return _ok("phase_gate")


_VALIDATORS = {
    "migration_ledger": _validate_migration_ledger,
    "performance_evidence_set": _validate_performance_evidence_set,
    "layout_manifest": _validate_layout_manifest,
    "rename_ledger": _validate_rename_ledger,
    "tooling_selection_record": _validate_tooling_selection_record,
    "deployment_descriptor_set": _validate_deployment_descriptor_set,
    "phase_gate": _validate_phase_gate,
}


def _string_paths(value: Any) -> list:
    """Return the string entries of ``value`` when it is a list, else ``[]``."""

    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def validate_migration_slice_paths(document: Any) -> dict:
    """Validate Migration_Slice path exclusivity (design Property 2, D1).

    Independent of the Property 1 structural check, this enforces the two D1
    cross-slice invariants that Property 2 encodes (requirements 1.1 and 1.7):

      * the union of every slice's ``replacedPythonPaths`` contains zero
        duplicate paths — no python module path may appear in more than one
        slice (or twice within one slice); and
      * the set of ``exclusions[].excludedPaths`` is disjoint from the set of
        replaced paths — a path may not be both migrated and excluded.

    Returns ``{"ok": bool, "errorCode": str|None}`` with ``errorCode`` drawn
    from the closed set :data:`LEDGER_ERROR_CODES`:
    ``migration_replaced_path_duplicate`` when the replaced-path union has a
    duplicate, ``migration_excluded_path_overlap`` when an excluded path also
    appears as a replaced path, and ``None`` on acceptance. Duplicate detection
    takes precedence over overlap detection.

    This check is intentionally silent about empty path lists and structural
    completeness — those defects belong to Property 1
    (:func:`validate_ledger`). The function is pure: no I/O, no environment.
    """

    if not isinstance(document, dict):
        return _reject(ERROR_SHAPE_INVALID)
    slices = document.get("slices")
    if not isinstance(slices, list):
        return _reject(ERROR_SHAPE_INVALID)

    replaced_union: list = []
    for item in slices:
        if not isinstance(item, dict):
            return _reject(ERROR_SHAPE_INVALID)
        replaced_union.extend(_string_paths(item.get("replacedPythonPaths")))

    if _duplicated(replaced_union):
        return _reject(ERROR_REPLACED_PATH_DUPLICATE)

    replaced_set = set(replaced_union)
    excluded_paths: list = []
    for exclusion in document.get("exclusions") or []:
        if isinstance(exclusion, dict):
            excluded_paths.extend(_string_paths(exclusion.get("excludedPaths")))

    if replaced_set & set(excluded_paths):
        return _reject(ERROR_EXCLUDED_PATH_OVERLAP)

    return _ok("migration_ledger")


def validate_ledger(kind: Any, document: Any) -> dict:
    """Validate a repo-owned ledger document of the given ``kind``.

    Returns ``{"ok": bool, "errorCode": str|None}`` where ``errorCode`` is drawn
    from the closed set :data:`LEDGER_ERROR_CODES` and is ``None`` on acceptance.

    Per design Property 1, a document is accepted if and only if it has no empty
    required field, no out-of-set closed-field value, no duplicated identifier,
    and no document-kind cardinality violation.

    The function is pure: it reads no environment and performs no I/O.
    """

    validator = _VALIDATORS.get(kind)
    if validator is None:
        return _reject(ERROR_KIND_UNKNOWN)
    return validator(document)
