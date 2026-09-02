#!/usr/bin/env python3
"""Phase_Gate runner for the platform-modernization spec (Requirement 16).

This is the cross-cutting phase-completion surface described in design section
C12 ("Phase_Gate 실행기") and Data Model D9. It provides three concerns:

1. ``VERIFICATION_COMMANDS`` / ``PUBLIC_ROUTE_TIMEOUT_SECONDS`` — the fixed
   Requirement 16.4 verification command set and the public-route timeout
   budget.

2. Two pure validators that mirror the ``{"ok", "errorCode"}`` dict-return
   convention used across ``backend/pipeline_control`` (see ``schedule.py`` and
   ``profiles.py``):

   * ``validate_rollback_plan(plan)`` — design Property 37 (Requirements 16.5,
     16.8).
   * ``validate_phase_assignment(assignment)`` — design Property 3
     (Requirement 16.1).

3. ``evaluate_phase_gate(report, ...)`` — the gate-evaluation surface from
   design D9. Given a phase report it checks entry/exit conditions, runs the
   verification commands (execution is injectable so callers/tests need not
   spawn real processes), records bounded status fields to
   ``backend/log/phases/{phaseId}-report.json``, and returns the fixed codes
   ``phase_gate_incomplete``, ``phase_gate_not_satisfied``, and
   ``phase_verification_failed``.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its property tests. It performs no network I/O and never
records cookies, headers, local storage, admin body/table content, Supabase
payloads, provider diagnostics, or any Forbidden_Log_Field — only the bounded
status fields enumerated in design D9.
"""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Fixed constants (design C12).
# ---------------------------------------------------------------------------

# The seven Requirement 16.4 verification commands, in order, each as a
# ``(cwd, argv)`` pair. This is the canonical set every Phase_Gate runs and the
# set a Rollback_Plan's post-rollback verification must fully cover.
VERIFICATION_COMMANDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("apps/web", ("bun", "run", "lint")),
    ("apps/web", ("bun", "run", "test:unit")),
    ("apps/web", ("npm", "run", "typecheck:parity")),
    ("apps/web", ("npm", "run", "build")),
    (".", ("python", "-m", "unittest", "backend.utils.tests.test_run_daily_regression")),
    (".", ("python", "-m", "unittest", "backend.pipeline.test_validators_unittest")),
    (".", ("python", "-m", "unittest", "backend.pipeline.test_data_contracts_unittest")),
)

# Public-route response budget (design C12): a route must respond within this
# many seconds without a server error to be recorded as passing.
PUBLIC_ROUTE_TIMEOUT_SECONDS = 5.0

# Requirement numbers under phase partition are exactly 1..15 (Requirement 16.1);
# Requirement 16 itself is the cross-cutting concern that owns the gate.
_REQUIREMENT_NUMBERS = frozenset(range(1, 16))

# Forbidden git subcommands in a Rollback_Plan (Requirement 16.5, Property 37):
# the dirty original worktree is immutable and must never be reset/stashed/cleaned.
_FORBIDDEN_GIT_SUBCOMMANDS = frozenset({"reset", "stash", "clean"})


# ---------------------------------------------------------------------------
# Closed rejection-code sets. ``None`` (JSON null) means accepted.
# ---------------------------------------------------------------------------

# validate_rollback_plan
ROLLBACK_FORBIDDEN_COMMAND = "rollback_forbidden_command"
ROLLBACK_WORKTREE_ESCAPE = "rollback_worktree_escape"
ROLLBACK_VERIFICATION_INCOMPLETE = "rollback_verification_incomplete"
ROLLBACK_PLAN_SHAPE_INVALID = "rollback_plan_shape_invalid"

ROLLBACK_ERROR_CODES = frozenset(
    {
        None,
        ROLLBACK_FORBIDDEN_COMMAND,
        ROLLBACK_WORKTREE_ESCAPE,
        ROLLBACK_VERIFICATION_INCOMPLETE,
        ROLLBACK_PLAN_SHAPE_INVALID,
    }
)

# validate_phase_assignment
PHASE_REQUIREMENT_COVERAGE = "phase_requirement_coverage"
PHASE_SEQUENCE_INVALID = "phase_sequence_invalid"
PHASE_GATE_CARDINALITY = "phase_gate_cardinality"
PHASE_ASSIGNMENT_SHAPE_INVALID = "phase_assignment_shape_invalid"

PHASE_ASSIGNMENT_ERROR_CODES = frozenset(
    {
        None,
        PHASE_REQUIREMENT_COVERAGE,
        PHASE_SEQUENCE_INVALID,
        PHASE_GATE_CARDINALITY,
        PHASE_ASSIGNMENT_SHAPE_INVALID,
    }
)

# evaluate_phase_gate
PHASE_GATE_INCOMPLETE = "phase_gate_incomplete"
PHASE_GATE_NOT_SATISFIED = "phase_gate_not_satisfied"
PHASE_VERIFICATION_FAILED = "phase_verification_failed"

PHASE_GATE_RESULT_CODES = frozenset(
    {
        None,
        PHASE_GATE_INCOMPLETE,
        PHASE_GATE_NOT_SATISFIED,
        PHASE_VERIFICATION_FAILED,
    }
)


# ---------------------------------------------------------------------------
# Rollback_Plan validation (design Property 37; Requirements 16.5, 16.8).
# ---------------------------------------------------------------------------


def _is_git_forbidden(argv: Any) -> bool:
    """True when ``argv`` is a git reset/stash/clean invocation."""

    if not isinstance(argv, (list, tuple)) or len(argv) < 2:
        return False
    return argv[0] == "git" and argv[1] in _FORBIDDEN_GIT_SUBCOMMANDS


def validate_rollback_plan(plan: Any) -> dict:
    """Validate a Rollback_Plan record.

    Returns ``{"ok": bool, "errorCode": str|None}``. ``errorCode`` is drawn from
    :data:`ROLLBACK_ERROR_CODES`; it is ``None`` when accepted.

    Per design Property 37, the plan is accepted (``ok=True``) if and only if
    all three hold:

      * no command in ``plan["commands"]`` is a git ``reset`` / ``stash`` /
        ``clean`` invocation, and
      * every command's ``worktreeId`` equals
        ``plan["recoveryCandidateWorktreeId"]`` (no command targets the dirty
        original worktree), and
      * ``plan["postRollbackVerification"]`` (a list of ``{cwd, argv}``) covers
        every one of the seven Requirement 16.4 verification commands.

    Rejection precedence (first failure wins): forbidden command, then worktree
    escape, then incomplete post-rollback verification. Malformed input is
    rejected with ``rollback_plan_shape_invalid``.
    """

    if not isinstance(plan, Mapping):
        return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)

    commands = plan.get("commands")
    verification = plan.get("postRollbackVerification")
    recovery_worktree = plan.get("recoveryCandidateWorktreeId")
    if (
        not isinstance(commands, (list, tuple))
        or not isinstance(verification, (list, tuple))
        or not isinstance(recovery_worktree, str)
        or not recovery_worktree
    ):
        return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)

    for command in commands:
        if not isinstance(command, Mapping):
            return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)

    # 1. No git reset/stash/clean anywhere in the command list.
    if any(_is_git_forbidden(command.get("argv")) for command in commands):
        return _result(False, ROLLBACK_FORBIDDEN_COMMAND)

    # 2. Every command must target the isolated recovery-candidate worktree; no
    #    command may target the dirty original worktree.
    if any(command.get("worktreeId") != recovery_worktree for command in commands):
        return _result(False, ROLLBACK_WORKTREE_ESCAPE)

    # 3. Post-rollback verification must cover the full Requirement 16.4 set.
    present = set()
    for item in verification:
        if not isinstance(item, Mapping):
            continue
        argv = item.get("argv")
        if isinstance(argv, (list, tuple)):
            present.add((item.get("cwd"), tuple(argv)))
    expected = {(cwd, tuple(argv)) for cwd, argv in VERIFICATION_COMMANDS}
    if not expected.issubset(present):
        return _result(False, ROLLBACK_VERIFICATION_INCOMPLETE)

    return _result(True, None)


# ---------------------------------------------------------------------------
# Phase-assignment partition validation (design Property 3; Requirement 16.1).
# ---------------------------------------------------------------------------


def validate_phase_assignment(assignment: Any) -> dict:
    """Validate a Requirement→phase assignment partition.

    Returns ``{"ok": bool, "errorCode": str|None}``. ``errorCode`` is drawn from
    :data:`PHASE_ASSIGNMENT_ERROR_CODES`; it is ``None`` when accepted.

    Per design Property 3, the assignment is accepted (``ok=True``) if and only
    if all of the following hold for ``assignment["phases"]``:

      * every requirement number 1..15 appears in exactly one phase's
        ``assignedRequirements`` (full cover ∧ pairwise-disjoint) and no number
        outside 1..15 appears anywhere, and
      * the ``sequence`` values form a unique integer set equal to
        ``{1, ..., N}`` for ``N`` phases, and
      * every phase has exactly one Phase_Gate (``gateCount == 1``) and exactly
        one phase artifact (``artifactCount == 1``).

    Rejection precedence (first failure wins): requirement coverage, then
    sequence, then gate/artifact cardinality. Malformed input is rejected with
    ``phase_assignment_shape_invalid``.
    """

    if not isinstance(assignment, Mapping):
        return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)

    phases = assignment.get("phases")
    if not isinstance(phases, (list, tuple)):
        return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
    for phase in phases:
        if not isinstance(phase, Mapping):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        reqs = phase.get("assignedRequirements")
        if not isinstance(reqs, (list, tuple)):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        if not _is_int(phase.get("sequence")):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        if not _is_int(phase.get("gateCount")) or not _is_int(phase.get("artifactCount")):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        for req in reqs:
            if not _is_int(req):
                return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)

    # 1. Full cover ∧ pairwise-disjoint over exactly 1..15.
    counts: dict[int, int] = {}
    for phase in phases:
        for req in phase["assignedRequirements"]:
            counts[req] = counts.get(req, 0) + 1
    coverage_ok = set(counts) == set(_REQUIREMENT_NUMBERS) and all(
        counts[req] == 1 for req in _REQUIREMENT_NUMBERS
    )
    if not coverage_ok:
        return _result(False, PHASE_REQUIREMENT_COVERAGE)

    # 2. Sequence numbers: a unique set equal to {1, ..., N}.
    sequences = [phase["sequence"] for phase in phases]
    if sorted(sequences) != list(range(1, len(phases) + 1)):
        return _result(False, PHASE_SEQUENCE_INVALID)

    # 3. Exactly one Phase_Gate and one phase artifact per phase.
    if not all(
        phase["gateCount"] == 1 and phase["artifactCount"] == 1 for phase in phases
    ):
        return _result(False, PHASE_GATE_CARDINALITY)

    return _result(True, None)


# ---------------------------------------------------------------------------
# Gate evaluation (design D9). Execution is injectable.
# ---------------------------------------------------------------------------

# A command runner takes ``(cwd, argv)`` and returns whether the command passed.
# It may return a bool or a mapping carrying ``passed`` (and optionally ``treeId``).
CommandRunner = Callable[[str, Sequence[str]], Any]
# A route checker takes a route string and returns pass/timing.
RouteChecker = Callable[[str], Any]


def _default_command_runner(cwd: str, argv: Sequence[str]) -> dict:
    """Run a verification command and report only pass/fail plus the tree id.

    Deliberately captures no stdout/stderr into the report to avoid recording
    provider diagnostics or free-form errors (design D9 evidence hygiene).
    """

    root = _repo_root()
    workdir = root if cwd in (".", "", None) else root / cwd
    try:
        completed = subprocess.run(
            list(argv),
            cwd=str(workdir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        passed = completed.returncode == 0
    except Exception:  # pragma: no cover - environment dependent
        passed = False
    return {"passed": passed, "treeId": _current_tree_id()}


def _coerce_run_result(result: Any) -> tuple[bool | None, str | None]:
    """Normalise a command-runner return into ``(passed, treeId)``."""

    if isinstance(result, Mapping):
        raw_passed = result.get("passed")
        passed = bool(raw_passed) if isinstance(raw_passed, bool) else None
        tree_id = result.get("treeId")
        return passed, tree_id if isinstance(tree_id, str) else None
    if isinstance(result, bool):
        return result, None
    return None, None


def _coerce_route_result(result: Any) -> tuple[bool | None, float | None]:
    """Normalise a route-checker return into ``(passed, responseMs)``."""

    if isinstance(result, Mapping):
        raw_passed = result.get("passed")
        passed = bool(raw_passed) if isinstance(raw_passed, bool) else None
        response_ms = result.get("responseMs")
        if isinstance(response_ms, bool) or not isinstance(response_ms, (int, float)):
            response_ms = None
        return passed, response_ms
    if isinstance(result, bool):
        return result, None
    return None, None


def evaluate_phase_gate(
    report: Any,
    *,
    command_runner: CommandRunner | None = None,
    route_checker: RouteChecker | None = None,
    log_dir: Path | str | None = None,
    write_report: bool = True,
    now: Callable[[], str] | None = None,
) -> dict:
    """Evaluate a Phase_Gate for one phase and write its D9 report.

    ``report`` is a phase report mapping (design D9). Required components are the
    entry conditions, exit conditions, verification commands, and exactly one
    Rollback_Plan reference; if any is absent the gate blocks entry with
    ``phase_gate_incomplete``.

    The runner executes :data:`VERIFICATION_COMMANDS` and the declared public
    routes. Execution is injectable: pass ``command_runner`` / ``route_checker``
    so unit tests need not spawn real processes. A failing command or route
    check yields ``phase_verification_failed``. An unmet exit condition yields
    ``phase_gate_not_satisfied`` and records the unmet condition ids.

    Returns ``{"ok": bool, "errorCode": str|None, "resultCode": str|None,
    "reportPath": str|None, "unsatisfiedConditionIds": [...]}``. The written
    report contains only bounded status fields — never cookies, headers, local
    storage, admin body/table content, Supabase payloads, provider diagnostics,
    or Forbidden_Log_Field values.
    """

    clock = now or _utc_now_iso

    if not isinstance(report, Mapping):
        return _gate_result(PHASE_GATE_INCOMPLETE, None, [])

    phase_id = report.get("phaseId")
    if not isinstance(phase_id, str) or not phase_id:
        return _gate_result(PHASE_GATE_INCOMPLETE, None, [])

    entry_conditions = report.get("entryConditions")
    exit_conditions = report.get("exitConditions")
    rollback_ref = report.get("rollbackPlanRef")

    # Completeness: the four required components must all be present. The
    # verification command set is the module constant, which is always present;
    # the report must supply non-empty entry/exit conditions and a rollback ref.
    complete = (
        isinstance(entry_conditions, (list, tuple))
        and len(entry_conditions) > 0
        and isinstance(exit_conditions, (list, tuple))
        and len(exit_conditions) > 0
        and isinstance(rollback_ref, str)
        and bool(rollback_ref)
        and len(VERIFICATION_COMMANDS) > 0
    )
    if not complete:
        # Block entry; do not fabricate a passing report.
        out = _build_report(report, [], [], resultCode=PHASE_GATE_INCOMPLETE)
        path = _write_report(out, phase_id, log_dir) if write_report else None
        return _gate_result(PHASE_GATE_INCOMPLETE, path, [])

    runner = command_runner or _default_command_runner
    command_records: list[dict] = []
    any_command_failed = False
    for cwd, argv in VERIFICATION_COMMANDS:
        passed, tree_id = _coerce_run_result(runner(cwd, list(argv)))
        if passed is not True:
            any_command_failed = True
        command_records.append(
            {
                "cwd": cwd,
                "command": " ".join(argv),
                "passed": passed,
                "ranAt": clock(),
                "treeId": tree_id,
            }
        )

    route_records: list[dict] = []
    any_route_failed = False
    declared_routes = report.get("publicRouteChecks")
    routes = _declared_route_names(declared_routes)
    for route in routes:
        if route_checker is None:
            passed, response_ms = None, None
            any_route_failed = True
        else:
            passed, response_ms = _coerce_route_result(route_checker(route))
            if passed is not True:
                any_route_failed = True
        route_records.append(
            {"route": route, "passed": passed, "responseMs": response_ms}
        )

    if any_command_failed or any_route_failed:
        out = _build_report(
            report, command_records, route_records, resultCode=PHASE_VERIFICATION_FAILED
        )
        path = _write_report(out, phase_id, log_dir) if write_report else None
        return _gate_result(PHASE_VERIFICATION_FAILED, path, [])

    # Exit conditions: any condition whose ``satisfied`` is not explicitly True
    # is unmet. Record the unmet condition ids in the report.
    unsatisfied = [
        cond.get("conditionId")
        for cond in exit_conditions
        if not (isinstance(cond, Mapping) and cond.get("satisfied") is True)
    ]
    if unsatisfied:
        out = _build_report(
            report,
            command_records,
            route_records,
            resultCode=PHASE_GATE_NOT_SATISFIED,
            unsatisfied=unsatisfied,
        )
        path = _write_report(out, phase_id, log_dir) if write_report else None
        return _gate_result(PHASE_GATE_NOT_SATISFIED, path, unsatisfied)

    out = _build_report(report, command_records, route_records, resultCode=None)
    path = _write_report(out, phase_id, log_dir) if write_report else None
    return _gate_result(None, path, [])


# ---------------------------------------------------------------------------
# Report construction and I/O helpers.
# ---------------------------------------------------------------------------


def _build_report(
    report: Mapping[str, Any],
    command_records: list[dict],
    route_records: list[dict],
    *,
    resultCode: str | None,
    unsatisfied: list | None = None,
) -> dict:
    """Assemble the bounded D9 report. Only status fields are emitted."""

    entry_conditions = _condition_list(report.get("entryConditions"))
    exit_conditions = _condition_list(report.get("exitConditions"), unsatisfied=unsatisfied)

    unexplained = report.get("unexplainedWorktreeChanges")
    # Paths only — never file contents (design D9 / Requirement 16.9).
    if isinstance(unexplained, (list, tuple)):
        unexplained_paths = [p for p in unexplained if isinstance(p, str)]
    else:
        unexplained_paths = []

    return {
        "schemaVersion": 1,
        "phaseId": report.get("phaseId"),
        "sequence": report.get("sequence"),
        "assignedRequirements": _int_list(report.get("assignedRequirements")),
        "worktreeId": report.get("worktreeId")
        if isinstance(report.get("worktreeId"), str)
        else None,
        "entryConditions": entry_conditions,
        "exitConditions": exit_conditions,
        "verificationCommands": command_records,
        "publicRouteChecks": route_records,
        "unexplainedWorktreeChanges": unexplained_paths,
        "rollbackPlanRef": report.get("rollbackPlanRef")
        if isinstance(report.get("rollbackPlanRef"), str)
        else None,
        "resultCode": resultCode,
    }


def _condition_list(raw: Any, *, unsatisfied: list | None = None) -> list[dict]:
    """Reduce conditions to bounded ``{conditionId, statement, satisfied}``."""

    unsatisfied_ids = set(unsatisfied or [])
    result: list[dict] = []
    if not isinstance(raw, (list, tuple)):
        return result
    for cond in raw:
        if not isinstance(cond, Mapping):
            continue
        condition_id = cond.get("conditionId")
        satisfied = cond.get("satisfied")
        if unsatisfied is not None and condition_id in unsatisfied_ids:
            satisfied = False
        result.append(
            {
                "conditionId": condition_id if isinstance(condition_id, str) else None,
                "statement": cond.get("statement")
                if isinstance(cond.get("statement"), str)
                else None,
                "satisfied": satisfied if isinstance(satisfied, bool) else None,
            }
        )
    return result


def _declared_route_names(raw: Any) -> list[str]:
    routes: list[str] = []
    if not isinstance(raw, (list, tuple)):
        return routes
    for item in raw:
        if isinstance(item, str):
            routes.append(item)
        elif isinstance(item, Mapping) and isinstance(item.get("route"), str):
            routes.append(item["route"])
    return routes


def _int_list(raw: Any) -> list[int]:
    if not isinstance(raw, (list, tuple)):
        return []
    return [value for value in raw if _is_int(value)]


def _write_report(payload: dict, phase_id: str, log_dir: Path | str | None) -> str:
    directory = Path(log_dir) if log_dir is not None else _repo_root() / "backend" / "log" / "phases"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{phase_id}-report.json"
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return str(path)


# ---------------------------------------------------------------------------
# Small shared helpers.
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: str | None) -> dict:
    return {"ok": ok, "errorCode": error_code}


def _gate_result(result_code: str | None, path: str | None, unsatisfied: list) -> dict:
    return {
        "ok": result_code is None,
        "errorCode": result_code,
        "resultCode": result_code,
        "reportPath": path,
        "unsatisfiedConditionIds": list(unsatisfied),
    }


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _repo_root() -> Path:
    # backend/bin/phase_gate.py -> parents[0]=bin, [1]=backend, [2]=repo root.
    return Path(__file__).resolve().parents[2]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _current_tree_id() -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(_repo_root()),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        if completed.returncode == 0:
            value = completed.stdout.strip()
            return value or None
    except Exception:  # pragma: no cover - environment dependent
        return None
    return None
