#!/usr/bin/env python3
"""Rename_Ledger checker for the platform-modernization spec (Requirement 7).

This is the ``C3. Rename_Ledger`` enforcement surface from the design (section
C3). It validates ``backend/naming-renames.v1.json`` -- the naming-refactor
ledger whose existing shape is ``oldPath`` / ``newPath`` / ``rationale`` /
``contractClassification`` / ``verification`` per entry, with a ledger-level
``schemaVersion`` ``1`` and a ``nonGoals`` list -- and enforces the naming-
change rules (rename scope, canonical-privacy exclusion, applied-rename
verification, target-test success, and the no-alias / zero-reachable-old-name
invariant).

It performs fail-closed checks, each returning a bounded fixed code and no
Forbidden_Log_Field (only names, paths, counts, and fixed codes):

1. **Ledger shape** (Requirements 7.1, 7.2, 7.7) -> ``rename_ledger_invalid``.
   The ledger carries ``schemaVersion`` ``1`` and a non-empty ``nonGoals`` list;
   every entry carries a non-empty ``oldPath`` / ``newPath`` / ``rationale``, a
   ``contractClassification`` that is a non-empty list drawn only from the
   closed five-value set, and a ``verification`` list of at least three
   non-empty items.

2. **Rename scope** (Requirement 7.4) -> ``rename_scope_violation``. A rename
   target that is a public route path, a public API response field, an applied
   Supabase migration object name, a Supabase RPC name, or a persistent data
   path is rejected.

3. **Canonical privacy contract** (Requirements 7.5, 7.8) ->
   ``privacy_contract_violation``. A rename target that is one of the seven
   canonical privacy objects or five canonical privacy RPCs, or an alias added
   for any of those names, is rejected. This takes precedence over the general
   scope check.

4. **Applied-rename verification** (Requirements 7.3, 7.6, 7.9) ->
   ``rename_verification_failed``. After an applied rename, the old-name
   reference count in the first-party tree (excluding ``.local-archive/``) must
   be ``0`` and the new-name definition count must be exactly ``1``; the
   zero-reachable-old-name state (no alias / compat wrapper / re-export shim /
   delegating export left behind) is exactly the ``old_reference_count == 0``
   condition.

5. **Target test suite** (Requirement 7.10) -> ``rename_test_failure``. The unit
   test suite that imports / loads / calls the renamed name must have run and
   reported zero failures; a non-run or a failing suite is rejected. The test
   runner is injected so the check is unit-testable with no live suite.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests (see ``backend/bin/check_layout_manifest.py``). Git
enumeration, the tree root, and the manifest path are injectable so the checks
are unit-testable with no live git state.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Bounded fixed codes (design C3 / error-code table). ``None`` means accepted.
# ---------------------------------------------------------------------------

RENAME_LEDGER_INVALID = "rename_ledger_invalid"  # 7.1, 7.2, 7.7 (shape)
RENAME_SCOPE_VIOLATION = "rename_scope_violation"  # 7.4
PRIVACY_CONTRACT_VIOLATION = "privacy_contract_violation"  # 7.5, 7.8
RENAME_VERIFICATION_FAILED = "rename_verification_failed"  # 7.3, 7.6, 7.9
RENAME_TEST_FAILURE = "rename_test_failure"  # 7.10

# The full closed set this checker may return. Any other value is a defect.
# ``Forbidden_Log_Field`` is intentionally absent from every emitted structure.
RENAME_CHECK_RESULT_CODES = frozenset(
    {
        None,
        RENAME_LEDGER_INVALID,
        RENAME_SCOPE_VIOLATION,
        PRIVACY_CONTRACT_VIOLATION,
        RENAME_VERIFICATION_FAILED,
        RENAME_TEST_FAILURE,
    }
)

# The order in which an aggregate run surfaces the first blocking code.
_CODE_PRECEDENCE = (
    RENAME_LEDGER_INVALID,
    PRIVACY_CONTRACT_VIOLATION,
    RENAME_SCOPE_VIOLATION,
    RENAME_VERIFICATION_FAILED,
    RENAME_TEST_FAILURE,
)

# ---------------------------------------------------------------------------
# Frozen constants (design C3, Requirement 7).
# ---------------------------------------------------------------------------

# Repo layout: backend/bin/check_rename_ledger.py -> bin -> backend -> <root>.
_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MANIFEST_PATH = _ROOT / "backend" / "naming-renames.v1.json"

SCHEMA_VERSION = 1

# The closed five-value contract-classification set (Requirement 7.2). A
# ``contractClassification`` list must be a non-empty subset of this set.
RENAME_CONTRACT_CLASSES = frozenset(
    {
        "internal-path",
        "runner-contract",
        "test-loader-contract",
        "operator-cli-contract",
        "regression-fixture-contract",
    }
)

# Each entry records the five non-empty fields (Requirement 7.1). ``oldPath`` /
# ``newPath`` are the "old name" / "new name" fields; ``rationale`` is the
# rationale; ``contractClassification`` is the contract classification; and
# ``verification`` is the verification record.
REQUIRED_ENTRY_STRING_FIELDS = ("oldPath", "newPath", "rationale")
MIN_VERIFICATION_ITEMS = 3

# The seven canonical privacy objects and five canonical privacy RPCs
# (Requirements 7.5, 7.8). These names are excluded from all renames and no
# alias may be added for them.
CANONICAL_PRIVACY_OBJECTS = frozenset(
    {
        "privacy_policy_versions",
        "privacy_onboarding_challenges",
        "privacy_age_profiles",
        "privacy_guardian_verifications",
        "privacy_consent_events",
        "privacy_consent_state",
        "privacy_audit_events",
    }
)
CANONICAL_PRIVACY_RPCS = frozenset(
    {
        "get_current_privacy_policy_version",
        "create_privacy_onboarding_challenge",
        "confirm_privacy_onboarding",
        "submit_privacy_consent",
        "record_privacy_guardian_verification",
    }
)
CANONICAL_PRIVACY_NAMES = CANONICAL_PRIVACY_OBJECTS | CANONICAL_PRIVACY_RPCS

# Default out-of-scope reference sets (Requirement 7.4). Public routes live
# under ``apps/web/app`` route files; persistent data paths cover applied
# migrations and their sibling data trees. Migration object names, RPC names,
# and public API response field names vary by call site and are injectable, so
# their defaults are seeded minimally and can be overridden by a caller (and by
# the Property 14 test) with a domain-specific pool.
_PUBLIC_ROUTE_ROOT = "apps/web/app/"
_PUBLIC_ROUTE_BASENAMES = (
    "page.tsx",
    "page.ts",
    "page.jsx",
    "page.js",
    "route.ts",
    "route.js",
    "layout.tsx",
    "layout.ts",
    "default.tsx",
    "template.tsx",
)
DEFAULT_PERSISTENT_DATA_PREFIXES = (
    "backend/supabase/migrations/",
    "backend/supabase/baselines/",
    "backend/supabase/local-inputs/",
)
DEFAULT_MIGRATION_OBJECTS: frozenset[str] = frozenset()
DEFAULT_RPC_NAMES: frozenset[str] = frozenset({"batch_upsert_restaurants"})
DEFAULT_PUBLIC_API_FIELDS: frozenset[str] = frozenset()


# ---------------------------------------------------------------------------
# Pure result helper (mirrors backend/bin + pipeline_control convention).
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _nonempty_str_list(value: Any, *, min_len: int = 1) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= min_len
        and all(_nonempty_str(item) for item in value)
    )


# A git-file enumerator returns POSIX-relative tracked file paths.
GitEnumerator = Callable[[Path], "list[str]"]


def _default_git_enumerator(root: Path) -> list[str]:
    """Return ``git ls-files`` output for ``root`` as POSIX-relative paths.

    Only the file path list reaches the checks; no other git state is read. A
    git failure returns an empty list, which the verification check treats as
    "nothing tracked" and fails closed (new-name definition count 0 != 1).
    """

    try:
        completed = subprocess.run(
            ["git", "ls-files"],
            cwd=str(root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
    except Exception:  # noqa: BLE001 - a missing git must read as "nothing tracked"
        return []
    if completed.returncode != 0:
        return []
    return [line for line in (completed.stdout or "").splitlines() if line]


def load_manifest(path: str | Path = _DEFAULT_MANIFEST_PATH) -> dict:
    """Load and JSON-parse the Rename_Ledger at ``path``."""

    return json.loads(Path(path).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Check 1: ledger shape (7.1, 7.2, 7.7).
# ---------------------------------------------------------------------------


def validate_ledger_shape(manifest: Mapping[str, Any]) -> dict:
    """Validate Rename_Ledger shape (Requirements 7.1, 7.2, 7.7).

    Returns ``rename_ledger_invalid`` with a bounded issue list when the ledger
    is not ``schemaVersion`` ``1``, is missing a non-empty ``nonGoals`` list, or
    when any entry is missing a non-empty ``oldPath`` / ``newPath`` /
    ``rationale``, carries a ``contractClassification`` that is not a non-empty
    subset of the closed five-value set, or a ``verification`` list with fewer
    than three non-empty items. Only names, indices, and offending values reach
    the issue list; no Forbidden_Log_Field.
    """

    issues: list[dict] = []

    if not isinstance(manifest, Mapping):
        return _result(
            False, RENAME_LEDGER_INVALID, issues=[{"kind": "manifest_not_object"}]
        )

    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        issues.append({"kind": "schema_version_invalid"})
    if not _nonempty_str_list(manifest.get("nonGoals")):
        issues.append({"kind": "non_goals_missing"})

    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        issues.append({"kind": "entries_missing"})
        return _result(False, RENAME_LEDGER_INVALID, issues=issues)

    seen_old: set[str] = set()
    seen_new: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, Mapping):
            issues.append({"kind": "entry_not_object", "index": index})
            continue

        for field_name in REQUIRED_ENTRY_STRING_FIELDS:
            if not _nonempty_str(entry.get(field_name)):
                issues.append(
                    {"kind": "field_empty", "index": index, "field": field_name}
                )

        old_path = entry.get("oldPath")
        new_path = entry.get("newPath")
        if _nonempty_str(old_path):
            if old_path in seen_old:
                issues.append({"kind": "duplicate_old_path", "oldPath": old_path})
            seen_old.add(old_path)
        if _nonempty_str(new_path):
            if new_path in seen_new:
                issues.append({"kind": "duplicate_new_path", "newPath": new_path})
            seen_new.add(new_path)

        classification = entry.get("contractClassification")
        if not isinstance(classification, list) or not classification:
            issues.append({"kind": "classification_empty", "index": index})
        else:
            outside = [c for c in classification if c not in RENAME_CONTRACT_CLASSES]
            if outside:
                issues.append(
                    {
                        "kind": "classification_out_of_set",
                        "index": index,
                        "values": outside,
                    }
                )

        if not _nonempty_str_list(
            entry.get("verification"), min_len=MIN_VERIFICATION_ITEMS
        ):
            issues.append({"kind": "verification_insufficient", "index": index})

    if issues:
        return _result(False, RENAME_LEDGER_INVALID, issues=issues)
    return _result(True, None, issues=[])


# ---------------------------------------------------------------------------
# Checks 2 & 3: rename scope + canonical privacy contract (7.4, 7.5, 7.8).
# ---------------------------------------------------------------------------


class RenameScopeRefs:
    """Reference collections used to classify a rename target's scope.

    Defaults cover the canonical privacy names (mandatory, per 7.5/7.8), public
    route detection under ``apps/web/app``, and persistent data path prefixes.
    Migration object names, RPC names, and public API response field names are
    call-site specific and injectable; a caller (and the Property 14 test) may
    supply a domain-specific pool.

    Implemented as a plain immutable-by-convention class (not a ``dataclass``)
    so the module loads cleanly by file path -- ``backend/bin`` scripts are not
    an importable package, and ``dataclass`` + ``from __future__ import
    annotations`` cannot resolve its string annotations for a module that is not
    registered in ``sys.modules``.
    """

    __slots__ = (
        "privacy_objects",
        "privacy_rpcs",
        "migration_objects",
        "rpc_names",
        "public_api_fields",
        "persistent_data_prefixes",
    )

    def __init__(
        self,
        *,
        privacy_objects: frozenset = CANONICAL_PRIVACY_OBJECTS,
        privacy_rpcs: frozenset = CANONICAL_PRIVACY_RPCS,
        migration_objects: frozenset = DEFAULT_MIGRATION_OBJECTS,
        rpc_names: frozenset = DEFAULT_RPC_NAMES,
        public_api_fields: frozenset = DEFAULT_PUBLIC_API_FIELDS,
        persistent_data_prefixes: tuple = DEFAULT_PERSISTENT_DATA_PREFIXES,
    ) -> None:
        self.privacy_objects = frozenset(privacy_objects)
        self.privacy_rpcs = frozenset(privacy_rpcs)
        self.migration_objects = frozenset(migration_objects)
        self.rpc_names = frozenset(rpc_names)
        self.public_api_fields = frozenset(public_api_fields)
        self.persistent_data_prefixes = tuple(persistent_data_prefixes)

    @property
    def privacy_names(self) -> frozenset:
        return self.privacy_objects | self.privacy_rpcs


DEFAULT_SCOPE_REFS = RenameScopeRefs()


def _normalize(path: Any) -> str:
    if not isinstance(path, str):
        return ""
    return path.strip().replace("\\", "/")


def is_public_route_path(path: Any) -> bool:
    """True iff ``path`` is a Next.js public route file under ``apps/web/app``.

    A route path is one under ``apps/web/app/`` whose basename is a Next.js
    route file (``page.*`` / ``route.*`` / ``layout.*`` / ...). Private folders
    (a segment beginning with ``_``) are not public routes.
    """

    normalized = _normalize(path)
    if not normalized.startswith(_PUBLIC_ROUTE_ROOT):
        return False
    tail = normalized[len(_PUBLIC_ROUTE_ROOT):]
    segments = tail.split("/")
    if any(seg.startswith("_") for seg in segments[:-1]):
        return False
    return segments[-1] in _PUBLIC_ROUTE_BASENAMES


def _is_persistent_data_path(path: Any, refs: RenameScopeRefs) -> bool:
    normalized = _normalize(path)
    if not normalized:
        return False
    return any(normalized.startswith(prefix) for prefix in refs.persistent_data_prefixes)


def classify_rename_scope(
    target: Mapping[str, Any],
    *,
    refs: RenameScopeRefs = DEFAULT_SCOPE_REFS,
) -> dict:
    """Classify a rename-candidate target (Requirements 7.4, 7.5, 7.8).

    ``target`` is a mapping describing the candidate:

      * ``oldName`` / ``newName`` — the old and new identifier (or path);
      * ``path`` — an optional target path being renamed;
      * ``aliasFor`` — an optional name this candidate adds an alias for.

    Returns:

      * ``privacy_contract_violation`` when ``oldName`` / ``newName`` /
        ``aliasFor`` is one of the seven canonical privacy objects or five
        canonical privacy RPCs (an alias added for any of those names is
        rejected here too). This takes precedence over the scope check.
      * ``rename_scope_violation`` when the target is a public route path, a
        public API response field, an applied migration object name, a Supabase
        RPC name, or a persistent data path.
      * accepted (``ok=True``, ``errorCode=None``) otherwise.

    Pure: reads no environment and performs no I/O.
    """

    old_name = target.get("oldName")
    new_name = target.get("newName")
    alias_for = target.get("aliasFor")
    path = target.get("path")

    names = [n for n in (old_name, new_name) if _nonempty_str(n)]

    # 7.5 / 7.8: canonical privacy names (and aliases for them) take precedence.
    if any(n in refs.privacy_names for n in names):
        return _result(
            False,
            PRIVACY_CONTRACT_VIOLATION,
            offendingNames=[n for n in names if n in refs.privacy_names],
        )
    if _nonempty_str(alias_for) and alias_for in refs.privacy_names:
        return _result(
            False, PRIVACY_CONTRACT_VIOLATION, offendingNames=[alias_for]
        )

    # 7.4: out-of-scope targets.
    if is_public_route_path(path) or any(is_public_route_path(n) for n in names):
        return _result(False, RENAME_SCOPE_VIOLATION, reason="public_route")
    if any(n in refs.public_api_fields for n in names):
        return _result(False, RENAME_SCOPE_VIOLATION, reason="public_api_field")
    if any(n in refs.migration_objects for n in names):
        return _result(False, RENAME_SCOPE_VIOLATION, reason="migration_object")
    if any(n in refs.rpc_names for n in names):
        return _result(False, RENAME_SCOPE_VIOLATION, reason="rpc_name")
    if _is_persistent_data_path(path, refs) or any(
        _is_persistent_data_path(n, refs) for n in names
    ):
        return _result(False, RENAME_SCOPE_VIOLATION, reason="persistent_data_path")

    return _result(True, None)


# ---------------------------------------------------------------------------
# Check 4: applied-rename verification (7.3, 7.6, 7.9).
# ---------------------------------------------------------------------------


def evaluate_rename_verification(
    old_reference_count: int,
    new_definition_count: int,
) -> dict:
    """Evaluate the applied-rename verification counts (7.3, 7.6, 7.9).

    After an applied rename the old-name reference count must be ``0`` and the
    new-name definition count exactly ``1``. Otherwise ``rename_verification_
    failed``. The ``old_reference_count == 0`` condition is also the zero-
    reachable-old-name invariant of 7.3 (no alias / compat wrapper / re-export
    shim / delegating export left behind).
    """

    if old_reference_count != 0 or new_definition_count != 1:
        return _result(
            False,
            RENAME_VERIFICATION_FAILED,
            oldReferenceCount=old_reference_count,
            newDefinitionCount=new_definition_count,
        )
    return _result(
        True,
        None,
        oldReferenceCount=old_reference_count,
        newDefinitionCount=new_definition_count,
    )


def verify_entry_paths(
    entry: Mapping[str, Any],
    tracked_files: Iterable[str],
) -> dict:
    """Verify an applied rename entry against the tracked tree (7.3, 7.6, 7.9).

    Uses the entry's ``oldPath`` / ``newPath`` as the path-level "old name" and
    "new name": the old path must be absent from the tracked tree (0 references
    / 0 reachable old-name entrypoints) and the new path present exactly once
    (new-name definition == 1). ``.local-archive/`` is excluded from the tree
    scope by the git enumerator scope. Returns ``rename_verification_failed``
    otherwise.
    """

    files = {
        raw.strip().replace("\\", "/")
        for raw in tracked_files
        if _nonempty_str(raw) and not raw.strip().replace("\\", "/").startswith(
            ".local-archive/"
        )
    }
    old_path = _normalize(entry.get("oldPath"))
    new_path = _normalize(entry.get("newPath"))

    old_count = 1 if old_path and old_path in files else 0
    new_count = 1 if new_path and new_path in files else 0

    result = evaluate_rename_verification(old_count, new_count)
    result["oldPath"] = old_path
    result["newPath"] = new_path
    return result


# ---------------------------------------------------------------------------
# Check 5: target test suite (7.10).
# ---------------------------------------------------------------------------

# A test runner returns a mapping with a ``ran`` boolean and a ``failures`` int.
TestRunner = Callable[[Mapping[str, Any]], Mapping[str, Any]]


def evaluate_rename_test_result(ran: Any, failures: Any) -> dict:
    """Evaluate a target unit-test run (Requirement 7.10).

    Returns ``rename_test_failure`` when the suite did not run (``ran`` is not
    exactly ``True``) or reported one or more failures (``failures`` not a
    non-negative int equal to 0). A suite that ran with zero failures passes.
    """

    if ran is not True:
        return _result(False, RENAME_TEST_FAILURE, reason="suite_not_run")
    if isinstance(failures, bool) or not isinstance(failures, int) or failures != 0:
        return _result(
            False, RENAME_TEST_FAILURE, reason="suite_failed", failures=failures
        )
    return _result(True, None, failures=0)


def check_entry_tests(
    entry: Mapping[str, Any],
    test_runner: TestRunner,
) -> dict:
    """Run the target test suite for an entry and evaluate the result (7.10).

    ``test_runner`` is injected (so the check is unit-testable with no live
    suite); it receives the entry and returns ``{"ran": bool, "failures": int}``.
    """

    report = test_runner(entry) or {}
    return evaluate_rename_test_result(report.get("ran"), report.get("failures"))


# ---------------------------------------------------------------------------
# Aggregate run (design C3).
# ---------------------------------------------------------------------------


def run_check(
    *,
    root: str | Path = _ROOT,
    manifest_path: str | Path = _DEFAULT_MANIFEST_PATH,
    git_enumerator: GitEnumerator = _default_git_enumerator,
    scope_refs: RenameScopeRefs = DEFAULT_SCOPE_REFS,
    test_runner: TestRunner | None = None,
) -> dict:
    """Run every Rename_Ledger check against the committed ledger.

    Validates the ledger shape, classifies each entry's rename scope (a file-
    path rename maps ``oldPath`` -> ``oldName`` and ``newPath`` -> ``newName``),
    and verifies each applied entry left the old path absent and the new path
    present exactly once. When ``test_runner`` is supplied, each entry's target
    test suite is evaluated too; when omitted, the test dimension is reported as
    skipped (the committed ledger's ``verification`` field already records the
    suite result out of band).

    The aggregate ``ok`` is true only when every included check passes;
    ``errorCode`` is the first failing code by ``_CODE_PRECEDENCE``. Each check's
    bounded result is included under ``checks``. No Forbidden_Log_Field is
    emitted: only names, paths, counts, and fixed codes.
    """

    root_path = Path(root)
    manifest = load_manifest(manifest_path)
    tracked_files = git_enumerator(root_path)

    shape = validate_ledger_shape(manifest)

    entries = manifest.get("entries") if isinstance(manifest, Mapping) else None
    entries = entries if isinstance(entries, list) else []

    scope_checks: list[dict] = []
    verification_checks: list[dict] = []
    test_checks: list[dict] = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        target = {
            "oldName": entry.get("oldPath"),
            "newName": entry.get("newPath"),
            "path": entry.get("newPath"),
        }
        scope_checks.append(classify_rename_scope(target, refs=scope_refs))
        verification_checks.append(verify_entry_paths(entry, tracked_files))
        if test_runner is not None:
            test_checks.append(check_entry_tests(entry, test_runner))

    scope_ok = all(c["ok"] for c in scope_checks)
    # A scope failure may be privacy or general scope; surface whichever occurred.
    privacy_ok = all(
        c["ok"] or c["errorCode"] != PRIVACY_CONTRACT_VIOLATION for c in scope_checks
    )
    general_scope_ok = all(
        c["ok"] or c["errorCode"] != RENAME_SCOPE_VIOLATION for c in scope_checks
    )
    verification_ok = all(c["ok"] for c in verification_checks)
    tests_ok = all(c["ok"] for c in test_checks)

    checks = {
        "shape": shape,
        "scope": scope_checks,
        "verification": verification_checks,
        "tests": test_checks if test_runner is not None else "skipped",
    }

    outcomes = {
        RENAME_LEDGER_INVALID: shape["ok"],
        PRIVACY_CONTRACT_VIOLATION: privacy_ok,
        RENAME_SCOPE_VIOLATION: general_scope_ok,
        RENAME_VERIFICATION_FAILED: verification_ok,
        RENAME_TEST_FAILURE: tests_ok if test_runner is not None else True,
    }

    error_code = None
    for code in _CODE_PRECEDENCE:
        if not outcomes[code]:
            error_code = code
            break

    return _result(
        error_code is None,
        error_code,
        entryCount=len(entries),
        checks=checks,
    )


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Rename_Ledger checker (platform-modernization Requirement 7).",
    )
    parser.add_argument(
        "--manifest",
        default=str(_DEFAULT_MANIFEST_PATH),
        help="Path to backend/naming-renames.v1.json.",
    )
    parser.add_argument(
        "--root",
        default=str(_ROOT),
        help="Repository root used for git enumeration and path resolution.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print only machine-readable JSON."
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    result = run_check(root=args.root, manifest_path=args.manifest)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        print(
            "rename-ledger ok={ok} code={code} entries={n}".format(
                ok=str(result["ok"]).lower(),
                code=result["errorCode"],
                n=result["entryCount"],
            )
        )
        if not result["ok"]:
            print(json.dumps(result["checks"], ensure_ascii=True, sort_keys=True))

    return 0 if result["ok"] else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
