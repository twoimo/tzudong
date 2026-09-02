#!/usr/bin/env python3
"""P5 (P5-layout-naming) Phase_Gate verification runner (Task 38).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P5 phase from design's "단계 순서와
Phase_Gate" table (sequence 5, requirements 6 and 7). It:

  * Defines the P5 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/docs/phases/P5-layout-naming-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    P5-specific additional verifications Task 38 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the P5 layout/rename property-based tests, run with the venv python:
        ``backend/bin/tests/test_layout_move_pbt.py`` (Property 13) and
        ``backend/bin/tests/test_rename_scope_pbt.py`` (Property 14).
      - the Task 35/36 checker unit tests, run with the venv python:
        ``backend/bin/tests/test_check_layout_manifest_unittest.py`` and
        ``backend/bin/tests/test_check_rename_ledger_unittest.py``.
  * Establishes the two P5-specific completion conditions from real in-process
    static checks (pure, secret-free — they genuinely pass now that Tasks
    34/35/36 completed the move + manifest + ledger):
      - X1 (Layout_Manifest all entries correspond + 0 stale references) via
        ``backend/bin/check_layout_manifest.py`` ``run_check`` over the frozen
        ``backend/layout-manifest.v1.json`` and the current git-tracked tree —
        satisfied only when ``ok`` is true (which already implies bidirectional
        correspondence) AND the stale-reference count is exactly 0;
      - X2 (Rename_Ledger valid + each entry records ≥3 verification items) via
        ``backend/bin/check_rename_ledger.py`` ``run_check`` /
        ``validate_ledger_shape`` over the frozen
        ``backend/naming-renames.v1.json`` — satisfied only when ``ok`` is true
        (shape validation already requires exactly the ``schemaVersion`` 1
        ledger with each entry carrying a ≥3-item verification list).
  * Writes the D9 report to ``backend/log/phases/P5-layout-naming-report.json``.

Completion condition (design table row P5): every Layout_Manifest entry
corresponds to the tracked tree with zero unresolved references, the
Rename_Ledger is valid with each entry recording at least three verification
items, all seven verification commands pass, and every enumerated public route
responds within 5s without a server error.

Environment reality honoured honestly (no fabrication), same as P1-P4:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The P5 PBTs and the two checker unit tests need ``hypothesis`` (the PBTs)
    and the ``backend/bin`` modules. The repo's system ``python3`` lacks
    ``hypothesis``; the project ``.venv/bin/python`` has it. They are therefore
    run with the venv interpreter when present, and the interpreter's
    repo-relative path is recorded. ``backend/bin/tests`` is not a package (no
    ``__init__.py``), so each test is invoked by file path — matching how the
    tests load their target modules.
  * When the operator-secret precondition fails closed, P5's live completion
    evidence (the four ``apps/web`` verification commands, which need a real
    build) cannot be established, so those commands are NOT executed (this also
    avoids writing Next.js build artifacts into the worktree). They are recorded
    as not-executed (``passed: null``) and the gate result is an honest
    ``phase_verification_failed`` / not-satisfied — never a fabricated pass. The
    layout-manifest and rename-ledger static checks are pure, secret-free
    verifications and are always run for real.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate``,
``check_layout_manifest``, and ``check_rename_ledger`` are loaded by file path,
matching the sibling PBT and unit tests. The report contains only bounded status
fields — never cookies, headers, local storage, admin body/table content,
Supabase payloads, provider diagnostics, or any Forbidden_Log_Field.
``unexplainedWorktreeChanges`` is a path list only.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Callable, Sequence

# ---------------------------------------------------------------------------
# Load sibling backend/bin modules by file path (no __init__.py in backend/bin).
# ---------------------------------------------------------------------------

_THIS = Path(__file__).resolve()


def _repo_root() -> Path:
    # backend/bin/run_p5_gate.py -> backend/bin -> backend -> <repo root>
    return _THIS.parents[2]


def _load_sibling(module_name: str, filename: str):
    path = _THIS.parent / filename
    spec = importlib.util.spec_from_file_location(module_name, path)
    if not spec or not spec.loader:  # pragma: no cover - defensive
        raise ImportError(f"cannot load backend/bin/{filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase_gate = _load_sibling("phase_gate", "phase_gate.py")

# ---------------------------------------------------------------------------
# P5 configuration (design "단계 순서와 Phase_Gate", row 5; D9 example).
# ---------------------------------------------------------------------------

P5_PHASE_ID = "P5-layout-naming"
P5_SEQUENCE = 5
P5_ASSIGNED_REQUIREMENTS = [6, 7]
P5_ROLLBACK_PLAN_REF = "backend/docs/phases/P5-layout-naming-rollback.json"

# Canonical inputs the P5-specific static checks are anchored to.
_LAYOUT_MANIFEST_REF = "backend/layout-manifest.v1.json"
_RENAME_LEDGER_REF = "backend/naming-renames.v1.json"

# Minimum verification items each Rename_Ledger entry must record (Requirement
# 7.1; design table row P5 "Rename_Ledger 검증 3항목 기록").
_MIN_VERIFICATION_ITEMS = 3

# Entry conditions (each with a decidable statement and a unique id). P5 enters
# only after P4 completed (design table: "진입: P4 완료").
P5_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P5-E1",
        "statement": "P4-supply-chain 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P5.
_EXIT_LAYOUT = "P5-X1"
_EXIT_RENAME = "P5-X2"
_EXIT_COMMANDS = "P5-X3"
_EXIT_ROUTES = "P5-X4"

P5_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_LAYOUT: "Layout_Manifest 전 항목이 트리와 대응하고 미해석 참조가 0이다",
    _EXIT_RENAME: "Rename_Ledger가 유효하고 각 항목이 검증 내역 3항목 이상을 기록한다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P5 gate's route check
# (Requirement 16.10). Bounded route strings only.
P5_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Fixed, bounded note recorded against a verification command that was not
# executed because a P5 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The P5 layout/rename property-based tests (Property 13-14) and the two Task
# 35/36 checker unit tests, as repo-relative file paths. ``backend/bin/tests``
# is not a package (no ``__init__.py``), so each is invoked by file path — the
# same way the tests load their target modules.
_P5_LAYOUT_PBT_FILE = "backend/bin/tests/test_layout_move_pbt.py"
_P5_RENAME_PBT_FILE = "backend/bin/tests/test_rename_scope_pbt.py"
_P5_LAYOUT_UNIT_FILE = "backend/bin/tests/test_check_layout_manifest_unittest.py"
_P5_RENAME_UNIT_FILE = "backend/bin/tests/test_check_rename_ledger_unittest.py"


# ---------------------------------------------------------------------------
# Small helpers.
# ---------------------------------------------------------------------------


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _current_tree_id(repo_root: Path) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        if completed.returncode == 0:
            return completed.stdout.strip() or None
    except Exception:  # pragma: no cover - environment dependent
        return None
    return None


def _worktree_id(repo_root: Path) -> str:
    """Return a bounded identifier for the current worktree (Requirement 16.8).

    Uses ``git rev-parse --show-toplevel`` basename, which names the isolated
    recovery-candidate worktree without leaking an absolute path.
    """

    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(repo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        if completed.returncode == 0:
            top = completed.stdout.strip()
            if top:
                return Path(top).name
    except Exception:  # pragma: no cover - environment dependent
        pass
    return repo_root.name


def _venv_python(repo_root: Path) -> str:
    """Return the interpreter to run the PBTs/unit tests with (hypothesis here).

    The repo ``.venv/bin/python`` carries ``hypothesis``; the system ``python3``
    does not. Fall back to the current interpreter when the venv is absent.
    """

    candidate = repo_root / ".venv" / "bin" / "python"
    if candidate.exists():
        return str(candidate)
    return sys.executable or "python3"


def _rel(repo_root: Path, path: str) -> str:
    """Return a bounded interpreter identifier.

    Repo-relative when the path lives under the repo root (symlinks are NOT
    followed, so the venv is reported as ``.venv/bin/python`` rather than its
    resolved target), otherwise just the basename. This keeps the recorded
    interpreter informative without emitting an absolute home-directory path.
    """

    candidate = Path(path)
    try:
        return str(candidate.relative_to(repo_root))
    except ValueError:
        return candidate.name


# ---------------------------------------------------------------------------
# Additional P5 verification commands (Task 38): env-contract + P5 PBTs + units.
# ---------------------------------------------------------------------------

# A runner takes ``(cwd, argv)`` and returns ``(returncode, stdout)``. stderr is
# discarded so provider diagnostics never enter the bounded record.
AdditionalRunner = Callable[[str, Sequence[str]], "tuple[int, str]"]


def _default_additional_runner(cwd: str, argv: Sequence[str]) -> tuple[int, str]:
    root = _repo_root()
    workdir = root if cwd in (".", "", None) else root / cwd
    try:
        completed = subprocess.run(
            list(argv),
            cwd=str(workdir),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        return completed.returncode, completed.stdout or ""
    except Exception:  # pragma: no cover - environment dependent
        return 127, ""


def run_additional_verifications(
    *,
    repo_root: Path,
    runner: AdditionalRunner | None = None,
    now: Callable[[], str] | None = None,
) -> tuple[list[dict], dict]:
    """Run the P5-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    ``check_env_contract`` is run with ``--json`` so only the missing-required
    COUNT is recorded — never env var names, values, or any Forbidden_Log_Field.
    The two P5 PBTs and the two Task 35/36 checker unit tests are run by file
    path with the venv interpreter (hypothesis) when available. None of the four
    writes a Next.js build artifact.
    """

    run = runner or _default_additional_runner
    clock = now or _utc_now_iso

    records: list[dict] = []

    # 1) Operator env-contract (expected to fail closed when secrets absent).
    env_interp = sys.executable or "python3"
    env_argv = (
        env_interp,
        "backend/bin/check_env_contract.py",
        "--profile",
        "daily",
        "--json",
    )
    env_rc, env_out = run(".", env_argv)
    missing_count: int | None = None
    try:
        parsed = json.loads(env_out) if env_out.strip() else {}
        missing = parsed.get("missingRequired")
        if isinstance(missing, list):
            missing_count = len(missing)
    except (ValueError, TypeError):
        missing_count = None
    records.append(
        {
            "label": "check_env_contract_daily",
            "cwd": ".",
            "command": "python backend/bin/check_env_contract.py --profile daily",
            "interpreter": _rel(repo_root, env_interp),
            "passed": env_rc == 0,
            "ranAt": clock(),
        }
    )
    operator_secrets_present = env_rc == 0

    # 2-5) P5 PBTs (Property 13-14) and the Task 35/36 checker unit tests. Each
    #      needs hypothesis / the backend/bin modules => venv python, invoked by
    #      file path (backend/bin/tests is not a package).
    pbt_interp = _venv_python(repo_root)
    for label, test_file in (
        ("layout_move_p5_pbt", _P5_LAYOUT_PBT_FILE),
        ("rename_scope_p5_pbt", _P5_RENAME_PBT_FILE),
        ("check_layout_manifest_unit", _P5_LAYOUT_UNIT_FILE),
        ("check_rename_ledger_unit", _P5_RENAME_UNIT_FILE),
    ):
        rc, _ = run(".", (pbt_interp, test_file))
        records.append(
            {
                "label": label,
                "cwd": ".",
                "command": f"python {test_file}",
                "interpreter": _rel(repo_root, pbt_interp),
                "passed": rc == 0,
                "ranAt": clock(),
            }
        )

    precondition = {
        "operatorSecretsPresent": operator_secrets_present,
        "missingRequiredCount": missing_count,
    }
    return records, precondition


# ---------------------------------------------------------------------------
# Exit-condition evidence gathering (bounded, in-process static checks).
# ---------------------------------------------------------------------------

# An evaluator returns a bounded summary dict; execution is injectable so tests
# need not depend on the live modules or on git state.
Evaluator = Callable[[], dict]


def _default_layout_evaluator() -> dict:
    """X1: verify the Layout_Manifest corresponds with zero stale references.

    Loads ``backend/bin/check_layout_manifest.py`` by path and runs
    ``run_check`` over the frozen ``backend/layout-manifest.v1.json`` and the
    current git-tracked tree. The aggregate ``ok`` already requires bidirectional
    tree<->manifest correspondence and no stale path reference; ``satisfied`` is
    True only when ``ok`` is true AND the stale-reference count is exactly 0.
    Returns a bounded summary
    ``{satisfied, ok, trackedDirectoryCount, staleReferenceCount, code}``.
    Never emits a provider/database diagnostic.
    """

    root = _repo_root()
    try:
        module = _load_sibling("check_layout_manifest", "check_layout_manifest.py")
        outcome = module.run_check(
            root=root, manifest_path=root / _LAYOUT_MANIFEST_REF
        )
    except Exception:  # pragma: no cover - defensive
        return {
            "satisfied": None,
            "ok": None,
            "trackedDirectoryCount": None,
            "staleReferenceCount": None,
            "code": None,
        }

    ok = bool(outcome.get("ok"))
    tracked = outcome.get("trackedDirectoryCount")
    tracked = tracked if isinstance(tracked, int) else None
    checks = outcome.get("checks") if isinstance(outcome.get("checks"), dict) else {}
    stale = checks.get("staleReferences") if isinstance(checks, dict) else {}
    stale_count = stale.get("unresolvedCount") if isinstance(stale, dict) else None
    stale_count = stale_count if isinstance(stale_count, int) else None
    code = outcome.get("errorCode")
    code = code if isinstance(code, str) else None
    satisfied = ok and stale_count == 0
    return {
        "satisfied": satisfied,
        "ok": ok,
        "trackedDirectoryCount": tracked,
        "staleReferenceCount": stale_count,
        "code": code,
    }


def _default_rename_evaluator() -> dict:
    """X2: verify the Rename_Ledger is valid with ≥3 verification items/entry.

    Loads ``backend/bin/check_rename_ledger.py`` by path, validates the frozen
    ``backend/naming-renames.v1.json`` shape with ``validate_ledger_shape``
    (which requires ``schemaVersion`` 1, a ``nonGoals`` list, and each entry
    carrying a ≥3-item verification list), and runs the aggregate ``run_check``
    (scope + applied-rename verification). ``satisfied`` is True only when both
    the shape is valid AND ``run_check`` reports ``ok``. Also records the minimum
    verification-item count across entries as evidence of the "3항목 기록"
    condition. Returns a bounded summary
    ``{satisfied, ok, shapeOk, entryCount, minVerificationItems, code}``.
    """

    root = _repo_root()
    try:
        module = _load_sibling("check_rename_ledger", "check_rename_ledger.py")
        manifest = module.load_manifest(root / _RENAME_LEDGER_REF)
        shape = module.validate_ledger_shape(manifest)
        outcome = module.run_check(root=root, manifest_path=root / _RENAME_LEDGER_REF)
    except Exception:  # pragma: no cover - defensive
        return {
            "satisfied": None,
            "ok": None,
            "shapeOk": None,
            "entryCount": None,
            "minVerificationItems": None,
            "code": None,
        }

    shape_ok = bool(shape.get("ok"))
    ok = bool(outcome.get("ok"))
    entry_count = outcome.get("entryCount")
    entry_count = entry_count if isinstance(entry_count, int) else None

    # Minimum verification-item count across entries (bounded integer only).
    min_items: int | None = None
    entries = manifest.get("entries") if isinstance(manifest, dict) else None
    if isinstance(entries, list) and entries:
        counts: list[int] = []
        for entry in entries:
            if isinstance(entry, dict) and isinstance(entry.get("verification"), list):
                counts.append(len(entry["verification"]))
            else:
                counts.append(0)
        min_items = min(counts) if counts else None

    code = outcome.get("errorCode")
    code = code if isinstance(code, str) else None
    satisfied = (
        shape_ok
        and ok
        and isinstance(min_items, int)
        and min_items >= _MIN_VERIFICATION_ITEMS
    )
    return {
        "satisfied": satisfied,
        "ok": ok,
        "shapeOk": shape_ok,
        "entryCount": entry_count,
        "minVerificationItems": min_items,
        "code": code,
    }


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p5_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P5 phase-report input for ``evaluate_phase_gate``.

    ``exit_overrides`` maps exit condition ids to their ``satisfied`` value
    (True/False/None). ``publicRouteChecks`` declares the routes to check;
    ``evaluate_phase_gate`` records only bounded route results.
    """

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P5_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (
            _EXIT_LAYOUT,
            _EXIT_RENAME,
            _EXIT_COMMANDS,
            _EXIT_ROUTES,
        )
    ]

    return {
        "phaseId": P5_PHASE_ID,
        "sequence": P5_SEQUENCE,
        "assignedRequirements": list(P5_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P5_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P5_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P5_ROLLBACK_PLAN_REF,
    }


def _make_command_runner(
    *,
    repo_root: Path,
    operator_secrets_present: bool,
    run_web_commands: bool,
) -> phase_gate.CommandRunner:
    """Build the injected runner for the seven Requirement 16.4 commands.

    The ``apps/web`` commands (lint, test:unit, typecheck:parity, build) are
    executed only when both operator secrets are present AND ``run_web_commands``
    is set — running ``npm run build`` writes Next.js artifacts into the
    worktree, and without operator secrets P5 completion cannot be established
    anyway. Otherwise they are reported as not-executed (``passed=None``), which
    yields an honest ``phase_verification_failed``. Backend python unittest
    commands (cwd ``.``) are always executed for real; they need no secrets and
    write no artifacts.
    """

    tree_id = _current_tree_id(repo_root)

    def runner(cwd: str, argv: Sequence[str]) -> dict:
        is_web = cwd == "apps/web"
        if is_web and not (operator_secrets_present and run_web_commands):
            return {"passed": None, "treeId": tree_id, "note": _NOT_EXECUTED_NOTE}
        workdir = repo_root if cwd in (".", "", None) else repo_root / cwd
        try:
            completed = subprocess.run(
                list(argv),
                cwd=str(workdir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            return {"passed": completed.returncode == 0, "treeId": tree_id}
        except Exception:  # pragma: no cover - environment dependent
            return {"passed": False, "treeId": tree_id}

    return runner


def run_p5_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: phase_gate.CommandRunner | None = None,
    route_checker: phase_gate.RouteChecker | None = None,
    layout_evaluator: Evaluator | None = None,
    rename_evaluator: Evaluator | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P5 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications", "layoutManifest",
    "renameLedger"}``. When operator secrets are absent
    (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # In-process static evidence for the two P5-specific completion conditions.
    layout_result = (layout_evaluator or _default_layout_evaluator)()
    rename_result = (rename_evaluator or _default_rename_evaluator)()

    # Gather bounded exit-condition evidence.
    exit_overrides: dict[str, bool | None] = {
        _EXIT_LAYOUT: layout_result.get("satisfied"),
        _EXIT_RENAME: rename_result.get("satisfied"),
        # X3 (7 commands pass) and X4 (routes ok) are enforced by the gate's own
        # verification phase: a failing command or route yields
        # phase_verification_failed BEFORE exit conditions are consulted. Seeding
        # True is therefore accurate for the exit-condition stage (only reached
        # once verification passed); the persisted report is rewritten below to
        # the real computed pass/fail so the artifact stays honest.
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p5_report(repo_root=root, exit_overrides=exit_overrides)

    runner = command_runner or _make_command_runner(
        repo_root=root,
        operator_secrets_present=operator_secrets_present,
        run_web_commands=run_web_commands,
    )

    result = phase_gate.evaluate_phase_gate(
        report_input,
        command_runner=runner,
        route_checker=route_checker,
        log_dir=log_dir,
        write_report=write_report,
        now=now,
    )

    # Merge the P5-specific additional verifications, the layout-manifest and
    # rename-ledger summaries, and a bounded precondition summary into the
    # written D9 report, and finalise X3/X4 from the recorded command/route
    # results.
    report_path = result.get("reportPath")
    if write_report and report_path:
        try:
            written = json.loads(Path(report_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            written = None
        if isinstance(written, dict):
            commands = written.get("verificationCommands") or []
            routes = written.get("publicRouteChecks") or []
            x3 = _all_passed(commands)
            x4 = _all_passed(routes)
            for cond in written.get("exitConditions", []):
                if not isinstance(cond, dict):
                    continue
                if cond.get("conditionId") == _EXIT_COMMANDS:
                    cond["satisfied"] = x3
                elif cond.get("conditionId") == _EXIT_ROUTES:
                    cond["satisfied"] = x4
            written["additionalVerificationCommands"] = additional_records
            written["preconditionSummary"] = precondition
            written["layoutManifestCheck"] = layout_result
            written["renameLedgerCheck"] = rename_result
            Path(report_path).write_text(
                json.dumps(written, ensure_ascii=True, indent=2) + "\n",
                encoding="utf-8",
            )

    return {
        "ok": result.get("ok", False),
        "resultCode": result.get("resultCode"),
        "reportPath": report_path,
        "unsatisfiedConditionIds": result.get("unsatisfiedConditionIds", []),
        "precondition": precondition,
        "additionalVerifications": [
            {"label": rec["label"], "passed": rec["passed"]}
            for rec in additional_records
        ],
        "layoutManifest": layout_result,
        "renameLedger": rename_result,
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P5 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P5-layout-naming Phase_Gate and write its D9 report"
    )
    parser.add_argument(
        "--run-web-commands",
        action="store_true",
        help=(
            "also execute the apps/web verification commands (writes Next.js "
            "build artifacts); off by default"
        ),
    )
    parser.add_argument(
        "--json", action="store_true", help="print only machine-readable JSON"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    result = run_p5_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P5 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        lm = result["layoutManifest"]
        print(
            "layout manifest: "
            f"satisfied={str(lm.get('satisfied')).lower()} "
            f"trackedDirs={lm.get('trackedDirectoryCount')} "
            f"staleRefs={lm.get('staleReferenceCount')}"
        )
        rl = result["renameLedger"]
        print(
            "rename ledger: "
            f"satisfied={str(rl.get('satisfied')).lower()} "
            f"entryCount={rl.get('entryCount')} "
            f"minVerificationItems={rl.get('minVerificationItems')}"
        )
        for rec in result["additionalVerifications"]:
            print(f"  {rec['label']}: passed={str(rec['passed']).lower()}")
        if result["reportPath"]:
            print(f"report: {result['reportPath']}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
