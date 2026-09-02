#!/usr/bin/env python3
"""P6 (P6-rust) Phase_Gate verification runner (Task 47).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P6 phase from design's "단계 순서와
Phase_Gate" table (sequence 6, requirements 1, 2, 3). It:

  * Defines the P6 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/log/phases/P6-rust-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    P6-specific additional verifications Task 47 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the seven P6 property-based tests (Properties 2, 5, 6, 7, 8, 9, 10),
        run with the venv python (hypothesis):
          ``backend/pipeline_control/test_impl_selector_pbt.py`` (Property 5),
          ``backend/pipeline_control/test_ledger_integrity_pbt.py`` (Property 2),
          ``backend/pipeline_control/test_rust_parity_gate_pbt.py`` (Property 8),
          ``backend/pipeline_control/test_perf_noise_pbt.py`` (Property 9),
          ``backend/pipeline_control/test_perf_path_pbt.py`` (Property 10),
          ``backend/rust/tests/parity_pbt.py`` (Property 6),
          ``backend/rust/tests/parity_error_pbt.py`` (Property 7).
      - ``cargo test --manifest-path backend/rust/Cargo.toml`` (the Rust half of
        the parity properties, incl. ``tzudong-validators/tests/prop.rs``).
  * Establishes the three P6-specific completion conditions from real,
    secret-free static/in-process evidence:
      - X1 (per-slice N=3 consecutive parity) via ``impl_selector.load_ledger``
        over the frozen ``backend/rust/migration-ledger.v1.json``: satisfied
        only when EVERY slice records ``consecutiveMatchedCount >=``
        :data:`impl_selector.PARITY_GATE_COUNT` (3);
      - X2 (regression 3 suites intact) via the three backend python unittest
        commands in the Requirement 16.4 set (which ARE the three regression
        suites named in the Migration_Ledger ``regressionSuites``): satisfied
        only when all three passed;
      - X3 (Performance_Evidence_Set valid) via
        ``performance_evidence.validate_evidence_set_structure`` over a retained
        set under ``backend/performance/``: satisfied only when a set is present
        AND validates AND no ``performance_evidence_path_violation`` is found. A
        ``no_admitted_slice`` outcome is a valid result, but a valid *structure*
        must still exist to establish the condition.
  * Writes the D9 report to ``backend/log/phases/P6-rust-report.json``.

Completion condition (design table row P6): per-slice N=3 consecutive parity,
the three regression suites intact, a valid Performance_Evidence_Set, all seven
verification commands passing, and every enumerated public route responding
within 5s without a server error.

Environment reality honoured honestly (no fabrication), same as P1-P5:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The P6 PBTs need ``hypothesis``; the two ``backend/rust/tests`` parity PBTs
    additionally need the ``tzudong_validators`` PyO3 extension built for the
    interpreter, and skip cleanly (not a failure) when it is unavailable rather
    than fabricating a pass. They are run with ``.venv/bin/python`` when present.
    ``backend/rust/tests`` / ``backend/pipeline_control`` PBTs are invoked by
    file path.
  * ``cargo test`` runs against the repository-pinned toolchain when available.
  * When the operator-secret precondition fails closed, P6's live completion
    evidence (the four ``apps/web`` verification commands, which need a real
    build) cannot be established, so those commands are NOT executed (this also
    avoids writing Next.js build artifacts into the worktree). They are recorded
    as not-executed (``passed: null``) and the gate result is an honest
    ``phase_verification_failed`` / not-satisfied — never a fabricated pass. The
    migration-ledger parity and performance-evidence static checks are pure,
    secret-free verifications and are always run for real.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate`` is
loaded by file path. ``impl_selector`` and ``performance_evidence`` are imported
as ``backend.pipeline_control.*`` packages. The report contains only bounded
status fields — never cookies, headers, local storage, admin body/table
content, Supabase payloads, provider diagnostics, or any Forbidden_Log_Field.
``unexplainedWorktreeChanges`` is a path list only.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence

# ---------------------------------------------------------------------------
# Load sibling backend/bin phase_gate by file path (no __init__.py in backend/bin).
# ---------------------------------------------------------------------------

_THIS = Path(__file__).resolve()


def _repo_root() -> Path:
    # backend/bin/run_p6_gate.py -> backend/bin -> backend -> <repo root>
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

# ``impl_selector`` and ``performance_evidence`` are proper package modules; make
# the repo root importable so ``backend.*`` resolves regardless of the launch cwd.
if str(_repo_root()) not in sys.path:
    sys.path.insert(0, str(_repo_root()))

# ---------------------------------------------------------------------------
# P6 configuration (design "단계 순서와 Phase_Gate", row 6; D9 example).
# ---------------------------------------------------------------------------

P6_PHASE_ID = "P6-rust"
P6_SEQUENCE = 6
P6_ASSIGNED_REQUIREMENTS = [1, 2, 3]
P6_ROLLBACK_PLAN_REF = "backend/log/phases/P6-rust-rollback.json"

# Canonical inputs the P6-specific static checks are anchored to.
_MIGRATION_LEDGER_REF = "backend/rust/migration-ledger.v1.json"
_BACKEND_PERFORMANCE_DIR = "backend/performance"

# The three regression suites (design D1 ``regressionSuites``); these are exactly
# the three backend python unittest commands in the Requirement 16.4 set.
_REGRESSION_COMMANDS: tuple[str, ...] = (
    "python -m unittest backend.utils.tests.test_run_daily_regression",
    "python -m unittest backend.pipeline.test_validators_unittest",
    "python -m unittest backend.pipeline.test_data_contracts_unittest",
)

# Entry conditions (each with a decidable statement and a unique id). P6 enters
# only after P5 completed and the P1 local execution path is available as the
# parity input source (design table: "진입: P5 완료 + P1 로컬 실행 경로").
P6_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P6-E1",
        "statement": "P5-layout-naming 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
    {
        "conditionId": "P6-E2",
        "statement": "P1 로컬 실행 경로가 패리티 입력 원본으로 확보되었다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P6.
_EXIT_PARITY = "P6-X1"
_EXIT_REGRESSION = "P6-X2"
_EXIT_PERFORMANCE = "P6-X3"
_EXIT_COMMANDS = "P6-X4"
_EXIT_ROUTES = "P6-X5"

P6_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_PARITY: "모든 Migration_Slice가 N=3 연속 패리티를 기록했다",
    _EXIT_REGRESSION: "회귀 3스위트가 무결하다(실패·오류 0)",
    _EXIT_PERFORMANCE: "Performance_Evidence_Set가 유효하다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P6 gate's route check
# (Requirement 16.10). Bounded route strings only.
P6_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Fixed, bounded note recorded against a verification command that was not
# executed because a P6 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The seven P6 property-based tests. Each is ``(label, kind, target)``.
#
# ``kind == "module"``: a ``backend.pipeline_control`` PBT run via
# ``python -m unittest <module>`` from the repo root. These MUST NOT be invoked
# by file path: doing so puts ``backend/pipeline_control`` on ``sys.path[0]``,
# where a local ``queue.py`` shadows the stdlib ``queue`` and breaks the
# hypothesis import. ``-m unittest`` keeps the repo root on the path instead.
#
# ``kind == "file"``: a ``backend/rust/tests`` PBT run by file path (that
# directory is not a package and the test self-inserts the repo root). It skips
# cleanly when the ``tzudong_validators`` PyO3 extension is unbuilt.
_P6_PBT_FILES: tuple[tuple[str, str, str], ...] = (
    ("impl_selector_p6_pbt", "module", "backend.pipeline_control.test_impl_selector_pbt"),
    ("ledger_integrity_p6_pbt", "module", "backend.pipeline_control.test_ledger_integrity_pbt"),
    ("rust_parity_gate_p6_pbt", "module", "backend.pipeline_control.test_rust_parity_gate_pbt"),
    ("perf_noise_p6_pbt", "module", "backend.pipeline_control.test_perf_noise_pbt"),
    ("perf_path_p6_pbt", "module", "backend.pipeline_control.test_perf_path_pbt"),
    ("parity_output_p6_pbt", "file", "backend/rust/tests/parity_pbt.py"),
    ("parity_error_p6_pbt", "file", "backend/rust/tests/parity_error_pbt.py"),
)

_CARGO_TEST_ARGV: tuple[str, ...] = (
    "cargo",
    "test",
    "--manifest-path",
    "backend/rust/Cargo.toml",
)

# Bounded budget for cargo test so an environment without the pinned toolchain
# cannot hang the gate (seconds). A timeout is recorded as a plain failure.
_CARGO_TEST_TIMEOUT_SECONDS = 900


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
    """Return a bounded identifier for the current worktree (Requirement 16.8)."""

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
    """Return the interpreter to run the PBTs with (hypothesis here)."""

    candidate = repo_root / ".venv" / "bin" / "python"
    if candidate.exists():
        return str(candidate)
    return sys.executable or "python3"


def _rel(repo_root: Path, path: str) -> str:
    """Return a bounded interpreter identifier (repo-relative or basename)."""

    candidate = Path(path)
    try:
        return str(candidate.relative_to(repo_root))
    except ValueError:
        return candidate.name


# ---------------------------------------------------------------------------
# Additional P6 verification commands (Task 47): env-contract + P6 PBTs + cargo.
# ---------------------------------------------------------------------------

# A runner takes ``(cwd, argv, timeout)`` and returns ``(returncode, stdout)``.
# stderr is discarded so provider diagnostics never enter the bounded record.
AdditionalRunner = Callable[[str, "Sequence[str]", "int | None"], "tuple[int, str]"]


def _default_additional_runner(
    cwd: str, argv: Sequence[str], timeout: int | None = None
) -> tuple[int, str]:
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
            timeout=timeout,
        )
        return completed.returncode, completed.stdout or ""
    except subprocess.TimeoutExpired:
        return 124, ""
    except Exception:  # pragma: no cover - environment dependent
        return 127, ""


def run_additional_verifications(
    *,
    repo_root: Path,
    runner: AdditionalRunner | None = None,
    now: Callable[[], str] | None = None,
) -> tuple[list[dict], dict]:
    """Run the P6-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    ``check_env_contract`` is run with ``--json`` so only the missing-required
    COUNT is recorded — never env var names, values, or any Forbidden_Log_Field.
    The seven P6 PBTs are run by file path with the venv interpreter
    (hypothesis) when available; the two ``backend/rust/tests`` parity PBTs skip
    cleanly when the PyO3 extension is unbuilt. ``cargo test`` runs the Rust half
    of the parity properties. None of these writes a Next.js build artifact.
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
    env_rc, env_out = run(".", env_argv, None)
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

    # 2-8) The seven P6 PBTs (Properties 2, 5, 6, 7, 8, 9, 10). Each needs
    #       hypothesis => venv python. ``module`` PBTs are run via
    #       ``-m unittest`` (keeps repo root on the path, avoids the local
    #       ``queue.py`` shadow); ``file`` PBTs are run by path.
    pbt_interp = _venv_python(repo_root)
    for label, kind, target in _P6_PBT_FILES:
        if kind == "module":
            argv = (pbt_interp, "-m", "unittest", target)
            command = f"python -m unittest {target}"
        else:
            argv = (pbt_interp, target)
            command = f"python {target}"
        rc, _ = run(".", argv, None)
        records.append(
            {
                "label": label,
                "cwd": ".",
                "command": command,
                "interpreter": _rel(repo_root, pbt_interp),
                "passed": rc == 0,
                "ranAt": clock(),
            }
        )

    # 9) cargo test over the Rust workspace (the Rust half of the parity props).
    cargo_rc, _ = run(".", _CARGO_TEST_ARGV, _CARGO_TEST_TIMEOUT_SECONDS)
    records.append(
        {
            "label": "cargo_test_rust_workspace",
            "cwd": ".",
            "command": "cargo test --manifest-path backend/rust/Cargo.toml",
            "interpreter": "cargo",
            "passed": cargo_rc == 0,
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


def _default_parity_evaluator() -> dict:
    """X1: verify EVERY Migration_Slice records N=3 consecutive parity.

    Loads the frozen ``backend/rust/migration-ledger.v1.json`` via
    ``impl_selector.load_ledger`` and checks each slice's
    ``consecutiveMatchedCount`` against :data:`impl_selector.PARITY_GATE_COUNT`
    (3). ``satisfied`` is True only when there is at least one slice AND every
    slice meets the count. Returns a bounded summary
    ``{satisfied, sliceCount, slicesMeetingGate, gateCount,
    minConsecutiveMatchedCount}``. Never emits a provider/database diagnostic.
    """

    root = _repo_root()
    try:
        from backend.pipeline_control import impl_selector

        ledger = impl_selector.load_ledger(root / _MIGRATION_LEDGER_REF)
        gate_count = int(impl_selector.PARITY_GATE_COUNT)
    except Exception:  # pragma: no cover - defensive
        return {
            "satisfied": None,
            "sliceCount": None,
            "slicesMeetingGate": None,
            "gateCount": None,
            "minConsecutiveMatchedCount": None,
        }

    slices = ledger.get("slices") if isinstance(ledger, dict) else None
    if not isinstance(slices, list) or not slices:
        return {
            "satisfied": False,
            "sliceCount": 0,
            "slicesMeetingGate": 0,
            "gateCount": gate_count,
            "minConsecutiveMatchedCount": None,
        }

    counts: list[int] = []
    for entry in slices:
        raw = entry.get("consecutiveMatchedCount") if isinstance(entry, dict) else None
        counts.append(raw if isinstance(raw, int) and not isinstance(raw, bool) else 0)

    meeting = sum(1 for c in counts if c >= gate_count)
    satisfied = len(counts) > 0 and meeting == len(counts)
    return {
        "satisfied": satisfied,
        "sliceCount": len(counts),
        "slicesMeetingGate": meeting,
        "gateCount": gate_count,
        "minConsecutiveMatchedCount": min(counts) if counts else None,
    }


def _default_performance_evaluator() -> dict:
    """X3: verify a valid Performance_Evidence_Set is retained under backend/performance/.

    A performance claim is only established with a retained, path-separated,
    frozen-tree Performance_Evidence_Set (design D3, Requirement 3.2). This
    evaluator looks for a set file under ``backend/performance/`` and, when
    present, validates its structure with
    ``performance_evidence.validate_evidence_set_structure``. When the directory
    or a set is absent, the condition is honestly NOT established (no
    fabrication). Returns a bounded summary
    ``{satisfied, evidenceDirPresent, evidenceSetPresent, structureOk, code}``.
    """

    root = _repo_root()
    perf_dir = root / _BACKEND_PERFORMANCE_DIR
    dir_present = perf_dir.is_dir()

    if not dir_present:
        return {
            "satisfied": False,
            "evidenceDirPresent": False,
            "evidenceSetPresent": False,
            "structureOk": None,
            "code": None,
        }

    # A Performance_Evidence_Set is retained as a JSON artifact under the backend
    # performance tree. Enumerate candidate set files.
    candidates = sorted(perf_dir.rglob("*.json"))
    if not candidates:
        return {
            "satisfied": False,
            "evidenceDirPresent": True,
            "evidenceSetPresent": False,
            "structureOk": None,
            "code": None,
        }

    try:
        from backend.pipeline_control import performance_evidence
    except Exception:  # pragma: no cover - defensive
        return {
            "satisfied": None,
            "evidenceDirPresent": True,
            "evidenceSetPresent": True,
            "structureOk": None,
            "code": None,
        }

    structure_ok = False
    code: str | None = None
    for path in candidates:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        outcome = performance_evidence.validate_evidence_set_structure(doc)
        if isinstance(outcome, dict) and outcome.get("ok"):
            structure_ok = True
            code = None
            break
        if isinstance(outcome, dict):
            raw_code = outcome.get("errorCode")
            code = raw_code if isinstance(raw_code, str) else code

    return {
        "satisfied": bool(structure_ok),
        "evidenceDirPresent": True,
        "evidenceSetPresent": True,
        "structureOk": bool(structure_ok),
        "code": code,
    }


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p6_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P6 phase-report input for ``evaluate_phase_gate``."""

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P6_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (
            _EXIT_PARITY,
            _EXIT_REGRESSION,
            _EXIT_PERFORMANCE,
            _EXIT_COMMANDS,
            _EXIT_ROUTES,
        )
    ]

    return {
        "phaseId": P6_PHASE_ID,
        "sequence": P6_SEQUENCE,
        "assignedRequirements": list(P6_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P6_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P6_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P6_ROLLBACK_PLAN_REF,
    }


def _make_command_runner(
    *,
    repo_root: Path,
    operator_secrets_present: bool,
    run_web_commands: bool,
) -> "phase_gate.CommandRunner":
    """Build the injected runner for the seven Requirement 16.4 commands.

    The ``apps/web`` commands (lint, test:unit, typecheck:parity, build) are
    executed only when both operator secrets are present AND ``run_web_commands``
    is set. Otherwise they are reported as not-executed (``passed=None``), which
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


def _regression_suites_intact(command_records: list[dict]) -> bool:
    """X2: the three regression suites (backend python unittests) all passed."""

    passed_by_command = {
        rec.get("command"): rec.get("passed")
        for rec in command_records
        if isinstance(rec, dict)
    }
    return all(passed_by_command.get(cmd) is True for cmd in _REGRESSION_COMMANDS)


def run_p6_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: "phase_gate.CommandRunner | None" = None,
    route_checker: "phase_gate.RouteChecker | None" = None,
    parity_evaluator: Evaluator | None = None,
    performance_evaluator: Evaluator | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P6 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications", "sliceParity",
    "performanceEvidence"}``. When operator secrets are absent
    (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # In-process static evidence for the P6-specific completion conditions.
    parity_result = (parity_evaluator or _default_parity_evaluator)()
    performance_result = (performance_evaluator or _default_performance_evaluator)()

    exit_overrides: dict[str, bool | None] = {
        _EXIT_PARITY: parity_result.get("satisfied"),
        _EXIT_PERFORMANCE: performance_result.get("satisfied"),
        # X2 (regression suites) and X4 (7 commands) and X5 (routes) are finalised
        # from the recorded command/route results after the gate runs. Seeding
        # True is accurate for the exit-condition stage (only reached once
        # verification passed); the persisted report is rewritten below to the
        # real computed pass/fail so the artifact stays honest.
        _EXIT_REGRESSION: True,
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p6_report(repo_root=root, exit_overrides=exit_overrides)

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

    # Merge the P6-specific additional verifications, the parity and performance
    # summaries, and a bounded precondition summary into the written D9 report,
    # and finalise X2/X4/X5 from the recorded command/route results.
    report_path = result.get("reportPath")
    if write_report and report_path:
        try:
            written = json.loads(Path(report_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            written = None
        if isinstance(written, dict):
            commands = written.get("verificationCommands") or []
            routes = written.get("publicRouteChecks") or []
            x2 = _regression_suites_intact(commands)
            x4 = _all_passed(commands)
            x5 = _all_passed(routes)
            for cond in written.get("exitConditions", []):
                if not isinstance(cond, dict):
                    continue
                if cond.get("conditionId") == _EXIT_REGRESSION:
                    cond["satisfied"] = x2
                elif cond.get("conditionId") == _EXIT_COMMANDS:
                    cond["satisfied"] = x4
                elif cond.get("conditionId") == _EXIT_ROUTES:
                    cond["satisfied"] = x5
            written["additionalVerificationCommands"] = additional_records
            written["preconditionSummary"] = precondition
            written["sliceParityCheck"] = parity_result
            written["performanceEvidenceCheck"] = performance_result
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
        "sliceParity": parity_result,
        "performanceEvidence": performance_result,
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P6 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P6-rust Phase_Gate and write its D9 report"
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

    result = run_p6_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P6 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        sp = result["sliceParity"]
        print(
            "slice parity: "
            f"satisfied={str(sp.get('satisfied')).lower()} "
            f"slicesMeetingGate={sp.get('slicesMeetingGate')}/{sp.get('sliceCount')} "
            f"gateCount={sp.get('gateCount')} "
            f"minConsecutiveMatched={sp.get('minConsecutiveMatchedCount')}"
        )
        pe = result["performanceEvidence"]
        print(
            "performance evidence: "
            f"satisfied={str(pe.get('satisfied')).lower()} "
            f"dirPresent={str(pe.get('evidenceDirPresent')).lower()} "
            f"setPresent={str(pe.get('evidenceSetPresent')).lower()}"
        )
        for rec in result["additionalVerifications"]:
            print(f"  {rec['label']}: passed={str(rec['passed']).lower()}")
        if result["reportPath"]:
            print(f"report: {result['reportPath']}")
        if result["unsatisfiedConditionIds"]:
            print(f"unsatisfied: {', '.join(result['unsatisfiedConditionIds'])}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
