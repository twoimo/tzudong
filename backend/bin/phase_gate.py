#!/usr/bin/env python3
"""Commit-bound, fail-closed phase-gate evaluator.

The evaluator consumes bounded evidence records. It does not infer completion
from file presence and does not execute commands, routes, migrations, hosted
writes, or rollback actions unless a caller explicitly invokes the separate
verification runner. Reports are opt-in and created once.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "backend/deploy/phase-gates.v1.json"
PHASE_IDS = (
    "P1-local-foundation",
    "P2-publication",
    "P3-observability",
    "P4-supply-chain",
    "P5-layout-naming",
    "P6-rust-performance",
    "P7-readiness-agent",
)
PUBLIC_ROUTE_TIMEOUT_MS = 5_000
FORBIDDEN_GIT_SUBCOMMANDS = frozenset(
    {"reset", "stash", "clean", "checkout", "switch", "restore"}
)
FORBIDDEN_COMMANDS = frozenset({"rm", "rmdir", "unlink", "shred"})
EVIDENCE_CLASSES = frozenset({"local", "external"})

CATALOG_INVALID = "phase_catalog_invalid"
CANDIDATE_TREE_MISMATCH = "phase_candidate_tree_mismatch"
PHASE_NOT_FOUND = "phase_not_found"
ENTRY_NOT_SATISFIED = "phase_entry_not_satisfied"
ROLLBACK_PLAN_INVALID = "rollback_plan_invalid"
VERIFICATION_INCOMPLETE = "phase_verification_incomplete"
VERIFICATION_FAILED = "phase_verification_failed"
ROUTE_VERIFICATION_INCOMPLETE = "phase_route_verification_incomplete"
ROUTE_VERIFICATION_FAILED = "phase_route_verification_failed"
EXIT_NOT_SATISFIED = "phase_exit_not_satisfied"
REPORT_EXISTS = "phase_report_exists"

PHASE_RESULT_CODES = frozenset(
    {
        None,
        CATALOG_INVALID,
        CANDIDATE_TREE_MISMATCH,
        PHASE_NOT_FOUND,
        ENTRY_NOT_SATISFIED,
        ROLLBACK_PLAN_INVALID,
        VERIFICATION_INCOMPLETE,
        VERIFICATION_FAILED,
        ROUTE_VERIFICATION_INCOMPLETE,
        ROUTE_VERIFICATION_FAILED,
        EXIT_NOT_SATISFIED,
        REPORT_EXISTS,
    }
)

ROLLBACK_PLAN_SHAPE_INVALID = "rollback_plan_shape_invalid"
ROLLBACK_FORBIDDEN_COMMAND = "rollback_forbidden_command"
ROLLBACK_WORKTREE_ESCAPE = "rollback_worktree_escape"
ROLLBACK_VERIFICATION_INCOMPLETE = "rollback_verification_incomplete"
ROLLBACK_REFERENCE_MISMATCH = "rollback_reference_mismatch"
ROLLBACK_COMMAND_NOT_ADMITTED = "rollback_command_not_admitted"

ROLLBACK_ERROR_CODES = frozenset(
    {
        None,
        ROLLBACK_PLAN_SHAPE_INVALID,
        ROLLBACK_FORBIDDEN_COMMAND,
        ROLLBACK_WORKTREE_ESCAPE,
        ROLLBACK_VERIFICATION_INCOMPLETE,
        ROLLBACK_REFERENCE_MISMATCH,
        ROLLBACK_COMMAND_NOT_ADMITTED,
    }
)

PHASE_ASSIGNMENT_SHAPE_INVALID = "phase_assignment_shape_invalid"
PHASE_REQUIREMENT_COVERAGE = "phase_requirement_coverage"
PHASE_SEQUENCE_INVALID = "phase_sequence_invalid"
PHASE_GATE_CARDINALITY = "phase_gate_cardinality"

PHASE_ASSIGNMENT_ERROR_CODES = frozenset(
    {
        None,
        PHASE_ASSIGNMENT_SHAPE_INVALID,
        PHASE_REQUIREMENT_COVERAGE,
        PHASE_SEQUENCE_INVALID,
        PHASE_GATE_CARDINALITY,
    }
)

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_RFC3339 = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
_PHASE_ID = re.compile(r"^P[1-7]-[a-z][a-z0-9-]{1,62}$")
_CONDITION_ID = re.compile(r"^P[1-7]-[EX][1-9][0-9]?$" )
_COMMAND_ID = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


def _result(ok: bool, error_code: str | None) -> dict[str, Any]:
    return {"ok": ok, "errorCode": error_code}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _safe_relative(value: Any, *, prefix: str | None = None) -> bool:
    if not isinstance(value, str) or not value or len(value) > 240:
        return False
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "" in path.parts:
        return False
    return prefix is None or value.startswith(prefix)


def _valid_argv(value: Any) -> bool:
    return (
        isinstance(value, list)
        and 1 <= len(value) <= 16
        and all(
            isinstance(item, str)
            and item
            and len(item) <= 160
            and "\n" not in item
            and "\r" not in item
            for item in value
        )
    )


def load_json_object(path: Path | str) -> Mapping[str, Any] | None:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, Mapping) else None


def load_phase_catalog(path: Path | str = DEFAULT_CATALOG) -> Mapping[str, Any] | None:
    return load_json_object(path)


def _catalog_command_keys(catalog: Mapping[str, Any]) -> set[tuple[str, tuple[str, ...]]]:
    return {
        (item["cwd"], tuple(item["argv"]))
        for item in catalog["verificationCommands"]
    }


def validate_phase_assignment(catalog: Any) -> dict[str, Any]:
    """Validate the current R1..R14 partition and all gate references."""

    if not isinstance(catalog, Mapping):
        return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
    if (
        catalog.get("schemaVersion") != 1
        or catalog.get("kind") != "phase_gate_catalog"
        or catalog.get("currentRequirementCount") != 14
    ):
        return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
    commands = catalog.get("verificationCommands")
    phases = catalog.get("phases")
    if not isinstance(commands, list) or not isinstance(phases, list):
        return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
    if len(commands) != 7 or len(phases) != 7:
        return _result(False, PHASE_GATE_CARDINALITY)

    command_ids: list[str] = []
    for command in commands:
        if (
            not isinstance(command, Mapping)
            or not isinstance(command.get("id"), str)
            or not _COMMAND_ID.fullmatch(command["id"])
            or command.get("cwd") not in {".", "apps/web"}
            or not _valid_argv(command.get("argv"))
            or not _is_int(command.get("timeoutSeconds"))
            or not 1 <= command["timeoutSeconds"] <= 1800
        ):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        command_ids.append(command["id"])
    if len(set(command_ids)) != 7:
        return _result(False, PHASE_GATE_CARDINALITY)

    requirement_counts: dict[int, int] = {}
    sequences: list[int] = []
    phase_ids: list[str] = []
    rollback_refs: set[str] = set()
    report_paths: set[str] = set()
    condition_ids: set[str] = set()
    for phase in phases:
        if not isinstance(phase, Mapping):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        phase_id = phase.get("phaseId")
        sequence = phase.get("sequence")
        assigned = phase.get("assignedRequirements")
        entry = phase.get("entryConditions")
        exit_conditions = phase.get("exitConditions")
        verification_ids = phase.get("verificationCommandIds")
        routes = phase.get("publicRoutes")
        rollback_ref = phase.get("rollbackPlanRef")
        report_path = phase.get("reportPath")
        if (
            not isinstance(phase_id, str)
            or not _PHASE_ID.fullmatch(phase_id)
            or not _is_int(sequence)
            or not isinstance(assigned, list)
            or any(not _is_int(number) for number in assigned)
            or not isinstance(entry, list)
            or not entry
            or not isinstance(exit_conditions, list)
            or not exit_conditions
            or verification_ids != command_ids
            or not isinstance(routes, list)
            or not routes
            or len(set(routes)) != len(routes)
            or any(
                not isinstance(route, str)
                or not route.startswith("/")
                or len(route) > 120
                or "?" in route
                for route in routes
            )
            or not _safe_relative(rollback_ref, prefix="backend/log/phases/")
            or not _safe_relative(report_path, prefix="backend/log/phases/")
        ):
            return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
        for condition in (*entry, *exit_conditions):
            if (
                not isinstance(condition, Mapping)
                or set(condition) != {"conditionId", "statement", "evidenceClass"}
                or not isinstance(condition.get("conditionId"), str)
                or not _CONDITION_ID.fullmatch(condition["conditionId"])
                or not condition["conditionId"].startswith(phase_id[:2] + "-")
                or condition["conditionId"] in condition_ids
                or not isinstance(condition.get("statement"), str)
                or not 10 <= len(condition["statement"]) <= 240
                or condition.get("evidenceClass") not in EVIDENCE_CLASSES
            ):
                return _result(False, PHASE_ASSIGNMENT_SHAPE_INVALID)
            condition_ids.add(condition["conditionId"])
        for number in assigned:
            requirement_counts[number] = requirement_counts.get(number, 0) + 1
        sequences.append(sequence)
        phase_ids.append(phase_id)
        if rollback_ref in rollback_refs or report_path in report_paths:
            return _result(False, PHASE_GATE_CARDINALITY)
        rollback_refs.add(rollback_ref)
        report_paths.add(report_path)

    if set(requirement_counts) != set(range(1, 15)) or any(
        count != 1 for count in requirement_counts.values()
    ):
        return _result(False, PHASE_REQUIREMENT_COVERAGE)
    if sequences != list(range(1, 8)) or phase_ids != list(PHASE_IDS):
        return _result(False, PHASE_SEQUENCE_INVALID)
    return _result(True, None)


def validate_rollback_plan(
    plan: Any,
    *,
    catalog: Mapping[str, Any] | None = None,
    phase_id: str | None = None,
    candidate_tree_id: str | None = None,
) -> dict[str, Any]:
    """Validate a rollback plan without executing any rollback command."""

    if not isinstance(plan, Mapping):
        return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)
    required = {
        "schemaVersion",
        "kind",
        "phaseId",
        "planRef",
        "recoveryCandidateTreeId",
        "affectedPaths",
        "commands",
        "postRollbackVerification",
    }
    if set(plan) != required or plan.get("schemaVersion") != 1 or plan.get("kind") != "rollback_plan":
        return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)
    if (
        not isinstance(plan.get("phaseId"), str)
        or not _PHASE_ID.fullmatch(plan["phaseId"])
        or not _safe_relative(plan.get("planRef"), prefix="backend/log/phases/")
        or not isinstance(plan.get("recoveryCandidateTreeId"), str)
        or not _HEX64.fullmatch(plan["recoveryCandidateTreeId"])
        or not isinstance(plan.get("affectedPaths"), list)
        or not plan["affectedPaths"]
        or len(set(plan["affectedPaths"])) != len(plan["affectedPaths"])
        or any(not _safe_relative(path) for path in plan["affectedPaths"])
        or not isinstance(plan.get("commands"), list)
        or not plan["commands"]
        or not isinstance(plan.get("postRollbackVerification"), list)
    ):
        return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)
    if phase_id is not None and plan["phaseId"] != phase_id:
        return _result(False, ROLLBACK_REFERENCE_MISMATCH)
    if candidate_tree_id is not None and plan["recoveryCandidateTreeId"] != candidate_tree_id:
        return _result(False, ROLLBACK_WORKTREE_ESCAPE)

    expected_ref: str | None = None
    expected_commands: set[tuple[str, tuple[str, ...]]] | None = None
    if catalog is not None:
        if not validate_phase_assignment(catalog)["ok"]:
            return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)
        selected = next(
            (phase for phase in catalog["phases"] if phase["phaseId"] == plan["phaseId"]),
            None,
        )
        if selected is None:
            return _result(False, ROLLBACK_REFERENCE_MISMATCH)
        expected_ref = selected["rollbackPlanRef"]
        expected_commands = _catalog_command_keys(catalog)
    if expected_ref is not None and plan["planRef"] != expected_ref:
        return _result(False, ROLLBACK_REFERENCE_MISMATCH)

    for command in plan["commands"]:
        if (
            not isinstance(command, Mapping)
            or set(command) != {"worktreeId", "argv"}
            or command.get("worktreeId") != plan["recoveryCandidateTreeId"]
            or not _valid_argv(command.get("argv"))
        ):
            return _result(False, ROLLBACK_WORKTREE_ESCAPE)
        argv = command["argv"]
        executable = PurePosixPath(argv[0]).name
        if executable in FORBIDDEN_COMMANDS or (
            executable == "git"
            and len(argv) > 1
            and argv[1] in FORBIDDEN_GIT_SUBCOMMANDS
        ):
            return _result(False, ROLLBACK_FORBIDDEN_COMMAND)
        if not (
            executable == "git"
            and len(argv) == 4
            and argv[1:3] == ["revert", "--no-edit"]
            and bool(_HEX40.fullmatch(argv[3]))
        ):
            return _result(False, ROLLBACK_COMMAND_NOT_ADMITTED)

    observed: set[tuple[str, tuple[str, ...]]] = set()
    for verification in plan["postRollbackVerification"]:
        if (
            not isinstance(verification, Mapping)
            or set(verification) != {"cwd", "argv"}
            or verification.get("cwd") not in {".", "apps/web"}
            or not _valid_argv(verification.get("argv"))
        ):
            return _result(False, ROLLBACK_PLAN_SHAPE_INVALID)
        observed.add((verification["cwd"], tuple(verification["argv"])))
    if expected_commands is not None and observed != expected_commands:
        return _result(False, ROLLBACK_VERIFICATION_INCOMPLETE)
    return _result(True, None)


def candidate_tree_fingerprint(root: Path = ROOT) -> str:
    """Hash HEAD, its binary working diff, and every non-ignored untracked file."""

    digest = hashlib.sha256()
    commands = (
        ("git", "rev-parse", "HEAD"),
        ("git", "diff", "--binary", "HEAD", "--", "."),
        ("git", "ls-files", "--others", "--exclude-standard", "-z"),
    )
    outputs: list[bytes] = []
    for command in commands:
        result = subprocess.run(command, cwd=root, capture_output=True, check=True)
        outputs.append(result.stdout)
    digest.update(b"HEAD\0" + outputs[0] + b"\0DIFF\0" + outputs[1])
    untracked = sorted(path for path in outputs[2].split(b"\0") if path)
    for raw_path in untracked:
        relative = os.fsdecode(raw_path)
        if not _safe_relative(relative):
            raise ValueError("candidate_tree_path_invalid")
        path = root / relative
        info = path.lstat()
        digest.update(b"\0PATH\0" + raw_path + b"\0")
        if stat.S_ISLNK(info.st_mode):
            digest.update(b"LINK\0" + os.fsencode(os.readlink(path)))
        elif stat.S_ISREG(info.st_mode):
            digest.update(b"FILE\0" + path.read_bytes())
        else:
            raise ValueError("candidate_tree_path_invalid")
    return digest.hexdigest()


def run_verification_commands(
    catalog: Mapping[str, Any],
    *,
    root: Path = ROOT,
    runner: Callable[[str, Sequence[str], int], bool] | None = None,
    now: Callable[[], str] | None = None,
) -> dict[str, Mapping[str, Any]]:
    """Explicitly run the seven commands with suppressed output and fixed timeouts."""

    if not validate_phase_assignment(catalog)["ok"]:
        return {}
    clock = now or _utc_now
    before = candidate_tree_fingerprint(root)

    def default_runner(cwd: str, argv: Sequence[str], timeout: int) -> bool:
        workdir = root if cwd == "." else root / cwd
        actual = [sys.executable if argv[0] == "python" else argv[0], *argv[1:]]
        try:
            result = subprocess.run(
                actual,
                cwd=workdir,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        return result.returncode == 0

    execute = runner or default_runner
    results: dict[str, Mapping[str, Any]] = {}
    for command in catalog["verificationCommands"]:
        passed = execute(command["cwd"], command["argv"], command["timeoutSeconds"])
        results[command["id"]] = {
            "passed": passed,
            "treeId": before,
            "ranAt": clock(),
        }
    return results


def _evidence_unsatisfied(
    conditions: Sequence[Mapping[str, Any]],
    evidence: Any,
    candidate_tree_id: str,
) -> list[str]:
    if not isinstance(evidence, Mapping):
        return [condition["conditionId"] for condition in conditions]
    unsatisfied: list[str] = []
    for condition in conditions:
        condition_id = condition["conditionId"]
        record = evidence.get(condition_id)
        valid = (
            isinstance(record, Mapping)
            and record.get("satisfied") is True
            and record.get("treeId") == candidate_tree_id
            and isinstance(record.get("observedAt"), str)
            and bool(_RFC3339.fullmatch(record["observedAt"]))
        )
        if condition["evidenceClass"] == "external":
            valid = valid and isinstance(record.get("evidenceRef"), str) and (
                0 < len(record["evidenceRef"]) <= 240
            )
        if not valid:
            unsatisfied.append(condition_id)
    return unsatisfied


def _verification_state(
    command_ids: Sequence[str], results: Any, candidate_tree_id: str
) -> tuple[str | None, list[str]]:
    if not isinstance(results, Mapping):
        return VERIFICATION_INCOMPLETE, list(command_ids)
    incomplete: list[str] = []
    failed: list[str] = []
    for command_id in command_ids:
        record = results.get(command_id)
        if (
            not isinstance(record, Mapping)
            or record.get("treeId") != candidate_tree_id
            or not isinstance(record.get("ranAt"), str)
            or not _RFC3339.fullmatch(record["ranAt"])
            or not isinstance(record.get("passed"), bool)
        ):
            incomplete.append(command_id)
        elif record["passed"] is not True:
            failed.append(command_id)
    if incomplete:
        return VERIFICATION_INCOMPLETE, incomplete
    if failed:
        return VERIFICATION_FAILED, failed
    return None, []


def _route_state(
    routes: Sequence[str], results: Any, candidate_tree_id: str
) -> tuple[str | None, list[str]]:
    if not isinstance(results, Mapping):
        return ROUTE_VERIFICATION_INCOMPLETE, list(routes)
    incomplete: list[str] = []
    failed: list[str] = []
    for route in routes:
        record = results.get(route)
        response_ms = record.get("responseMs") if isinstance(record, Mapping) else None
        if (
            not isinstance(record, Mapping)
            or record.get("treeId") != candidate_tree_id
            or not isinstance(record.get("observedAt"), str)
            or not _RFC3339.fullmatch(record["observedAt"])
            or not isinstance(record.get("passed"), bool)
            or isinstance(response_ms, bool)
            or not isinstance(response_ms, (int, float))
            or response_ms < 0
        ):
            incomplete.append(route)
        elif record["passed"] is not True or response_ms > PUBLIC_ROUTE_TIMEOUT_MS:
            failed.append(route)
    if incomplete:
        return ROUTE_VERIFICATION_INCOMPLETE, incomplete
    if failed:
        return ROUTE_VERIFICATION_FAILED, failed
    return None, []


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bounded_gate_result(
    phase_id: str | None,
    code: str | None,
    candidate_tree_id: str | None,
    unsatisfied: Sequence[str],
    *,
    report_path: str | None = None,
    evaluated_at: str | None = None,
) -> dict[str, Any]:
    if code not in PHASE_RESULT_CODES:
        code = CATALOG_INVALID
    return {
        "ok": code is None,
        "phaseId": phase_id,
        "resultCode": code,
        "candidateTreeId": candidate_tree_id,
        "unsatisfiedIds": list(unsatisfied)[:32],
        "reportPath": report_path,
        "evaluatedAt": evaluated_at,
    }


def evaluate_phase_gate(
    catalog: Any,
    phase_id: str,
    *,
    evidence: Any,
    rollback_plan: Any,
    command_results: Any,
    route_results: Any,
    candidate_tree_id: str,
    write_report: bool = False,
    root: Path = ROOT,
    now: Callable[[], str] | None = None,
) -> dict[str, Any]:
    """Evaluate one phase from bound evidence; no command is executed here."""

    clock = now or _utc_now
    evaluated_at = clock()
    if not isinstance(candidate_tree_id, str) or not _HEX64.fullmatch(candidate_tree_id):
        return _bounded_gate_result(phase_id, CATALOG_INVALID, None, [], evaluated_at=evaluated_at)
    validation = validate_phase_assignment(catalog)
    if not validation["ok"]:
        return _bounded_gate_result(phase_id, CATALOG_INVALID, candidate_tree_id, [], evaluated_at=evaluated_at)
    phase = next((item for item in catalog["phases"] if item["phaseId"] == phase_id), None)
    if phase is None:
        return _bounded_gate_result(phase_id, PHASE_NOT_FOUND, candidate_tree_id, [], evaluated_at=evaluated_at)

    code: str | None = None
    unsatisfied = _evidence_unsatisfied(phase["entryConditions"], evidence, candidate_tree_id)
    if unsatisfied:
        code = ENTRY_NOT_SATISFIED
    elif not validate_rollback_plan(
        rollback_plan,
        catalog=catalog,
        phase_id=phase_id,
        candidate_tree_id=candidate_tree_id,
    )["ok"]:
        code = ROLLBACK_PLAN_INVALID
        unsatisfied = ["rollbackPlan"]
    else:
        code, unsatisfied = _verification_state(
            phase["verificationCommandIds"], command_results, candidate_tree_id
        )
    if code is None:
        code, unsatisfied = _route_state(
            phase["publicRoutes"], route_results, candidate_tree_id
        )
    if code is None:
        unsatisfied = _evidence_unsatisfied(
            phase["exitConditions"], evidence, candidate_tree_id
        )
        if unsatisfied:
            code = EXIT_NOT_SATISFIED

    report_path: str | None = None
    if write_report:
        destination = root / phase["reportPath"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        report = _bounded_gate_result(
            phase_id,
            code,
            candidate_tree_id,
            unsatisfied,
            report_path=phase["reportPath"],
            evaluated_at=evaluated_at,
        )
        try:
            with destination.open("x", encoding="utf-8") as handle:
                json.dump(report, handle, ensure_ascii=True, sort_keys=True)
                handle.write("\n")
        except FileExistsError:
            code = REPORT_EXISTS
            unsatisfied = ["reportPath"]
        else:
            report_path = phase["reportPath"]
    return _bounded_gate_result(
        phase_id,
        code,
        candidate_tree_id,
        unsatisfied,
        report_path=report_path,
        evaluated_at=evaluated_at,
    )


def _load_optional(path: str | None) -> Mapping[str, Any] | None:
    return load_json_object(path) if path else None


def run_configured_phase(
    phase_id: str,
    *,
    catalog: Mapping[str, Any] | None = None,
    evidence: Any = None,
    rollback_plan: Any = None,
    command_results: Any = None,
    route_results: Any = None,
    candidate_tree_id: str | None = None,
    write_report: bool = False,
    root: Path = ROOT,
    now: Callable[[], str] | None = None,
) -> dict[str, Any]:
    """Evaluate one configured phase with fail-closed defaults."""

    resolved_catalog = catalog if catalog is not None else load_phase_catalog()
    resolved_tree_id = candidate_tree_fingerprint(root)
    if candidate_tree_id is not None and candidate_tree_id != resolved_tree_id:
        return _bounded_gate_result(phase_id, CANDIDATE_TREE_MISMATCH, resolved_tree_id, [], evaluated_at=(now or _utc_now)())
    return evaluate_phase_gate(
        resolved_catalog,
        phase_id,
        evidence=evidence,
        rollback_plan=rollback_plan,
        command_results=command_results,
        route_results=route_results,
        candidate_tree_id=resolved_tree_id,
        write_report=write_report,
        root=root,
        now=now,
    )


def cli_for_phase(phase_id: str, argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"Evaluate {phase_id} without external mutation")
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    parser.add_argument("--evidence")
    parser.add_argument("--rollback-plan")
    parser.add_argument("--command-results")
    parser.add_argument("--route-results")
    parser.add_argument("--candidate-tree-id")
    parser.add_argument("--run-verification", action="store_true")
    parser.add_argument("--write-report", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(list(argv) if argv is not None else None)

    catalog = load_phase_catalog(args.catalog)
    tree_id = candidate_tree_fingerprint(ROOT)
    if args.candidate_tree_id is not None and args.candidate_tree_id != tree_id:
        result = _bounded_gate_result(phase_id, CANDIDATE_TREE_MISMATCH, tree_id, [], evaluated_at=_utc_now())
        if args.json:
            print(json.dumps(result, ensure_ascii=True, sort_keys=True))
        else:
            print(f"{phase_id}: {CANDIDATE_TREE_MISMATCH}")
        return 1
    commands: Any = _load_optional(args.command_results)
    if args.run_verification and isinstance(catalog, Mapping):
        commands = run_verification_commands(catalog, root=ROOT)
        tree_id = candidate_tree_fingerprint(ROOT)
    result = evaluate_phase_gate(
        catalog,
        phase_id,
        evidence=_load_optional(args.evidence),
        rollback_plan=_load_optional(args.rollback_plan),
        command_results=commands,
        route_results=_load_optional(args.route_results),
        candidate_tree_id=tree_id,
        write_report=args.write_report,
        root=ROOT,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        print(f"{phase_id}: {result['resultCode'] or 'passed'}")
    return 0 if result["ok"] else 1


__all__ = [
    "DEFAULT_CATALOG",
    "PHASE_IDS",
    "PHASE_RESULT_CODES",
    "ROLLBACK_ERROR_CODES",
    "PHASE_ASSIGNMENT_ERROR_CODES",
    "candidate_tree_fingerprint",
    "cli_for_phase",
    "evaluate_phase_gate",
    "load_phase_catalog",
    "run_verification_commands",
    "run_configured_phase",
    "validate_phase_assignment",
    "validate_rollback_plan",
]
