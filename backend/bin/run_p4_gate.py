#!/usr/bin/env python3
"""P4 (P4-supply-chain) Phase_Gate verification runner (Task 33).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P4 phase from design's "단계 순서와
Phase_Gate" table (sequence 4, requirements 4, 5, and 11). It:

  * Defines the P4 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/docs/phases/P4-supply-chain-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    three P4-specific additional verifications Task 33 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the P4 supply-chain web property-based tests, run with ``bun test``:
        ``tests-unit/dependency-candidate-split.test.ts`` (Property 11) and
        ``tests-unit/pin-contract.test.ts`` (Property 12).
      - the P4 evidence-state property-based test, run with the venv python:
        ``backend.pipeline_control.test_evidence_state_pbt`` (Property 4).
  * Establishes the three P4 completion conditions from real in-process checks:
      - X1 (12 tooling categories recorded) via
        ``backend/bin/tooling_gate.py`` ``validate_record_coherence`` over the
        frozen ``backend/deploy/tooling-selection.v1.json``;
      - X2 (Pin_Contract 6 items match) by running
        ``apps/web/scripts/verify-pin-contract.mjs`` and checking it does NOT
        report ``pin_contract_drift`` — the runtime npm version may drift in
        this environment, which is recorded honestly (never fabricated);
      - X3 (7 dependency units candidate-generation confirmed) via a static
        read of ``apps/web/scripts/verify-dependency-freshness.mjs`` (the
        ``UNITS`` governance list, whose length ``assertGovernanceInvariants``
        pins at exactly 7).
  * Writes the D9 report to ``backend/log/phases/P4-supply-chain-report.json``.

Completion condition (design table row P4): the 11+1 tooling categories are
recorded and coherent, the six Pin_Contract items match, the seven dependency
units' candidate generation is confirmed, all seven verification commands pass,
and every enumerated public route responds within 5s without a server error.

Environment reality honoured honestly (no fabrication), same as P1/P2/P3:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The evidence-state PBT needs ``hypothesis``. The repo's system ``python3``
    lacks it; the project ``.venv/bin/python`` has it. That PBT is therefore run
    with the venv interpreter when present, and the interpreter's repo-relative
    path is recorded. The two web PBTs need ``bun`` and the ``apps/web``
    dependency tree; when ``bun`` or the deps are unavailable the run is
    recorded honestly (``passed`` reflects the real outcome), never fabricated.
  * The Pin_Contract check (X2) needs ``node`` and the ``apps/web`` dependency
    tree. It is a read-only verification (it never mutates a pin), so it is run
    for real; when it cannot run, or the runtime npm version drifts from the
    pinned ``11.6.2``, the honest outcome (``satisfied`` null/false with the
    recorded fixed code) is written — never a fabricated pass.
  * When the operator-secret precondition fails closed, P4's live completion
    evidence (the four ``apps/web`` verification commands, which need a real
    build) cannot be established, so those commands are NOT executed (this also
    avoids writing Next.js build artifacts into the worktree). They are recorded
    as not-executed (``passed: null``) and the gate result is an honest
    ``phase_verification_failed`` / not-satisfied — never a fabricated pass. The
    tooling-record coherence and dependency-unit checks are pure, secret-free
    static verifications and are always run for real.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate`` and
``tooling_gate`` are loaded by file path, matching the sibling PBT tests. The
report contains only bounded status fields — never cookies, headers, local
storage, admin body/table content, Supabase payloads, provider diagnostics, or
any Forbidden_Log_Field. ``unexplainedWorktreeChanges`` is a path list only.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

# ---------------------------------------------------------------------------
# Load sibling backend/bin modules by file path (no __init__.py in backend/bin).
# ---------------------------------------------------------------------------

_THIS = Path(__file__).resolve()


def _repo_root() -> Path:
    # backend/bin/run_p4_gate.py -> backend/bin -> backend -> <repo root>
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
# P4 configuration (design "단계 순서와 Phase_Gate", row 4; D9 example).
# ---------------------------------------------------------------------------

P4_PHASE_ID = "P4-supply-chain"
P4_SEQUENCE = 4
P4_ASSIGNED_REQUIREMENTS = [4, 5, 11]
P4_ROLLBACK_PLAN_REF = "backend/docs/phases/P4-supply-chain-rollback.json"

# Canonical inputs the P4-specific static checks are anchored to.
_TOOLING_RECORD_REF = "backend/deploy/tooling-selection.v1.json"
_DEPENDENCY_FRESHNESS_SCRIPT = "apps/web/scripts/verify-dependency-freshness.mjs"
_PIN_CONTRACT_SCRIPT = "scripts/verify-pin-contract.mjs"  # relative to apps/web

# Expected cardinalities (design C7 / C2; Requirement 11.1, 4.1/5.6/5.1).
_EXPECTED_TOOLING_CATEGORY_COUNT = 12
_EXPECTED_DEPENDENCY_UNIT_COUNT = 7
_PIN_CONTRACT_DRIFT_CODE = "pin_contract_drift"

# Entry conditions (each with a decidable statement and a unique id). P4 enters
# only after P3 completed (design table: "진입: P3 완료").
P4_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P4-E1",
        "statement": "P3-observability 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P4.
_EXIT_TOOLING = "P4-X1"
_EXIT_PIN = "P4-X2"
_EXIT_UNITS = "P4-X3"
_EXIT_COMMANDS = "P4-X4"
_EXIT_ROUTES = "P4-X5"

P4_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_TOOLING: "11개+1개 도구 범주 기록이 완성되고 일관성 검사를 통과했다",
    _EXIT_PIN: "Pin_Contract 6항목이 선언·해석 값과 일치한다",
    _EXIT_UNITS: "7개 의존성 단위의 갱신 후보 생성이 확인되었다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P4 gate's route check
# (Requirement 16.10). Bounded route strings only.
P4_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Fixed, bounded note recorded against a verification command that was not
# executed because a P4 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The P4 supply-chain web property-based tests (Property 11-12), as repo-relative
# test paths run with ``bun test`` from the ``apps/web`` working directory.
_P4_WEB_PBT_FILES: tuple[str, ...] = (
    "tests-unit/dependency-candidate-split.test.ts",
    "tests-unit/pin-contract.test.ts",
)

# The P4 evidence-state property-based test (Property 4), as a dotted module name
# under the ``backend.pipeline_control`` package. Running it via
# ``python -m unittest <dotted>`` keeps the repo root on sys.path[0] (cwd),
# which avoids the package-local ``queue.py`` shadowing the stdlib ``queue``
# that hypothesis imports.
_P4_EVIDENCE_PBT_MODULE = "backend.pipeline_control.test_evidence_state_pbt"


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
    """Return the interpreter to run the evidence PBT with (hypothesis lives here).

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
# Additional P4 verification commands (Task 33): env-contract + P4 PBTs.
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
    """Run the three P4-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    ``check_env_contract`` is run with ``--json`` so only the missing-required
    COUNT is recorded — never env var names, values, or any Forbidden_Log_Field.
    The web PBTs are run with ``bun test``; the evidence-state PBT is run with
    the venv interpreter (hypothesis) when available. None of the three writes a
    Next.js build artifact.
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

    # 2) P4 supply-chain web property-based suite (Property 11-12; needs bun and
    #    the apps/web dependency tree). Run with ``bun test`` from ``apps/web``.
    web_argv = ("bun", "test", *_P4_WEB_PBT_FILES)
    web_rc, _ = run("apps/web", web_argv)
    records.append(
        {
            "label": "supply_chain_p4_web_pbt",
            "cwd": "apps/web",
            "command": "bun test " + " ".join(_P4_WEB_PBT_FILES),
            "interpreter": "bun",
            "passed": web_rc == 0,
            "ranAt": clock(),
        }
    )

    # 3) P4 evidence-state property-based test (Property 4; needs hypothesis =>
    #    venv python). Named explicitly so only that property runs; the repo root
    #    stays on sys.path (cwd ``.``).
    pbt_interp = _venv_python(repo_root)
    pbt_argv = (pbt_interp, "-m", "unittest", _P4_EVIDENCE_PBT_MODULE)
    pbt_rc, _ = run(".", pbt_argv)
    records.append(
        {
            "label": "evidence_state_p4_pbt",
            "cwd": ".",
            "command": "python -m unittest " + _P4_EVIDENCE_PBT_MODULE,
            "interpreter": _rel(repo_root, pbt_interp),
            "passed": pbt_rc == 0,
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
# need not depend on the live modules, on ``node``, or on the ``apps/web`` deps.
Evaluator = Callable[[], dict]


def _default_tooling_evaluator() -> dict:
    """X1: verify the Tooling_Selection_Record enumerates 12 coherent categories.

    Loads ``backend/bin/tooling_gate.py`` by path and runs
    ``validate_record_coherence`` over the frozen
    ``backend/deploy/tooling-selection.v1.json``. Coherence already requires
    exactly 12 categories (11 of Requirement 11.1 plus local-kubernetes), 2-6
    unique-id candidates each with pinned references, and resolvable current-tree
    paths. Returns a bounded summary ``{satisfied, categoryCount, mismatchCount}``.
    Never emits a provider/database diagnostic.
    """

    root = _repo_root()
    try:
        module = _load_sibling("tooling_gate", "tooling_gate.py")
        record = module.load_record(root / _TOOLING_RECORD_REF)
        outcome = module.validate_record_coherence(record, root=root)
    except Exception:  # pragma: no cover - defensive
        return {"satisfied": None, "categoryCount": None, "mismatchCount": None}
    categories = record.get("categories") if isinstance(record, dict) else None
    category_count = len(categories) if isinstance(categories, list) else None
    mismatches = outcome.get("mismatches")
    mismatch_count = len(mismatches) if isinstance(mismatches, list) else None
    satisfied = bool(outcome.get("ok")) and category_count == _EXPECTED_TOOLING_CATEGORY_COUNT
    return {
        "satisfied": satisfied,
        "categoryCount": category_count,
        "mismatchCount": mismatch_count,
    }


def _count_dependency_units(source: str) -> int | None:
    """Count the ``UNITS`` entries in verify-dependency-freshness.mjs statically.

    The governance list is
    ``export const UNITS = Object.freeze([ ... ]);`` where each entry is an
    ``Object.freeze({ number: N, ecosystem: '...', directory: '...' })``. Counting
    the ``number:`` keys inside that block gives the declared unit count without
    executing node. Returns ``None`` when the block cannot be located.
    """

    match = re.search(
        r"export\s+const\s+UNITS\s*=\s*Object\.freeze\(\s*\[(.*?)\]\s*\)\s*;",
        source,
        re.DOTALL,
    )
    if not match:
        return None
    block = match.group(1)
    return len(re.findall(r"\bnumber\s*:\s*\d+", block))


def _default_dependency_units_evaluator() -> dict:
    """X3: confirm the seven Dependency_Freshness_Workflow units are enumerated.

    Statically reads ``apps/web/scripts/verify-dependency-freshness.mjs`` and
    counts its ``UNITS`` governance entries, whose length the module's
    ``assertGovernanceInvariants`` pins at exactly 7 (Requirement 4.1/5.6).
    Returns a bounded summary ``{satisfied, unitCount}``.
    """

    root = _repo_root()
    try:
        source = (root / _DEPENDENCY_FRESHNESS_SCRIPT).read_text(encoding="utf-8")
    except OSError:  # pragma: no cover - defensive
        return {"satisfied": None, "unitCount": None}
    unit_count = _count_dependency_units(source)
    satisfied = unit_count == _EXPECTED_DEPENDENCY_UNIT_COUNT
    return {"satisfied": satisfied, "unitCount": unit_count}


def _default_pin_contract_evaluator() -> dict:
    """X2: run the Pin_Contract verifier and record its honest outcome.

    Runs ``node apps/web/scripts/verify-pin-contract.mjs`` (read-only; it never
    mutates a pin) from the ``apps/web`` working directory and parses its JSON
    receipt. ``satisfied`` is True only when the receipt reports
    ``status == "passed"`` with a null code. When the verifier reports
    ``pin_contract_drift`` — which can happen here because the runtime npm
    version differs from the pinned ``11.6.2`` — ``satisfied`` is False and the
    fixed code is recorded. When node or the ``apps/web`` deps are unavailable
    (no receipt), ``satisfied`` is ``None`` (unverified). Returns a bounded
    summary ``{satisfied, ran, code}`` — never a provider diagnostic.
    """

    root = _repo_root()
    try:
        completed = subprocess.run(
            ["node", _PIN_CONTRACT_SCRIPT],
            cwd=str(root / "apps" / "web"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
        stdout = completed.stdout or ""
    except Exception:  # pragma: no cover - environment dependent
        return {"satisfied": None, "ran": False, "code": None}

    receipt: dict | None = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict) and "status" in parsed:
            receipt = parsed
            break

    if receipt is None:
        # No result artifact (e.g. global_compiler_not_admitted, or node/deps
        # absent). Honest unverified outcome; never fabricate a pass.
        return {"satisfied": None, "ran": False, "code": None}

    code = receipt.get("code")
    code = code if isinstance(code, str) else None
    satisfied = receipt.get("status") == "passed" and code is None
    return {"satisfied": satisfied, "ran": True, "code": code}


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p4_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P4 phase-report input for ``evaluate_phase_gate``.

    ``exit_overrides`` maps exit condition ids to their ``satisfied`` value
    (True/False/None). ``publicRouteChecks`` declares the routes to check;
    ``evaluate_phase_gate`` records only bounded route results.
    """

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P4_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (
            _EXIT_TOOLING,
            _EXIT_PIN,
            _EXIT_UNITS,
            _EXIT_COMMANDS,
            _EXIT_ROUTES,
        )
    ]

    return {
        "phaseId": P4_PHASE_ID,
        "sequence": P4_SEQUENCE,
        "assignedRequirements": list(P4_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P4_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P4_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P4_ROLLBACK_PLAN_REF,
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
    worktree, and without operator secrets P4 completion cannot be established
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


def run_p4_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: phase_gate.CommandRunner | None = None,
    route_checker: phase_gate.RouteChecker | None = None,
    tooling_evaluator: Evaluator | None = None,
    pin_contract_evaluator: Evaluator | None = None,
    dependency_units_evaluator: Evaluator | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P4 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications", "toolingRecord", "pinContract",
    "dependencyUnits"}``. When operator secrets are absent
    (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # In-process static evidence for the three P4-specific completion conditions.
    tooling_result = (tooling_evaluator or _default_tooling_evaluator)()
    pin_result = (pin_contract_evaluator or _default_pin_contract_evaluator)()
    units_result = (dependency_units_evaluator or _default_dependency_units_evaluator)()

    # Gather bounded exit-condition evidence.
    exit_overrides: dict[str, bool | None] = {
        _EXIT_TOOLING: tooling_result.get("satisfied"),
        _EXIT_PIN: pin_result.get("satisfied"),
        _EXIT_UNITS: units_result.get("satisfied"),
        # X4 (7 commands pass) and X5 (routes ok) are enforced by the gate's own
        # verification phase: a failing command or route yields
        # phase_verification_failed BEFORE exit conditions are consulted. Seeding
        # True is therefore accurate for the exit-condition stage (only reached
        # once verification passed); the persisted report is rewritten below to
        # the real computed pass/fail so the artifact stays honest.
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p4_report(repo_root=root, exit_overrides=exit_overrides)

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

    # Merge the three P4-specific additional verifications, the tooling-record,
    # pin-contract and dependency-unit summaries, and a bounded precondition
    # summary into the written D9 report, and finalise X4/X5 from the recorded
    # command/route results.
    report_path = result.get("reportPath")
    if write_report and report_path:
        try:
            written = json.loads(Path(report_path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            written = None
        if isinstance(written, dict):
            commands = written.get("verificationCommands") or []
            routes = written.get("publicRouteChecks") or []
            x4 = _all_passed(commands)
            x5 = _all_passed(routes)
            for cond in written.get("exitConditions", []):
                if not isinstance(cond, dict):
                    continue
                if cond.get("conditionId") == _EXIT_COMMANDS:
                    cond["satisfied"] = x4
                elif cond.get("conditionId") == _EXIT_ROUTES:
                    cond["satisfied"] = x5
            written["additionalVerificationCommands"] = additional_records
            written["preconditionSummary"] = precondition
            written["toolingRecordCheck"] = tooling_result
            written["pinContractCheck"] = pin_result
            written["dependencyUnitsCheck"] = units_result
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
        "toolingRecord": tooling_result,
        "pinContract": pin_result,
        "dependencyUnits": units_result,
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P4 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P4-supply-chain Phase_Gate and write its D9 report"
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

    result = run_p4_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P4 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        tr = result["toolingRecord"]
        print(
            "tooling record: "
            f"satisfied={str(tr.get('satisfied')).lower()} "
            f"categoryCount={tr.get('categoryCount')}"
        )
        pc = result["pinContract"]
        print(
            "pin contract: "
            f"satisfied={str(pc.get('satisfied')).lower()} "
            f"code={pc.get('code')}"
        )
        du = result["dependencyUnits"]
        print(
            "dependency units: "
            f"satisfied={str(du.get('satisfied')).lower()} "
            f"unitCount={du.get('unitCount')}"
        )
        for rec in result["additionalVerifications"]:
            print(f"  {rec['label']}: passed={str(rec['passed']).lower()}")
        if result["reportPath"]:
            print(f"report: {result['reportPath']}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
