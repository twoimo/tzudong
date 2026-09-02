#!/usr/bin/env python3
"""P3 (P3-observability) Phase_Gate verification runner (Task 27).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P3 phase from design's "단계 순서와
Phase_Gate" table (sequence 3, requirements 12 and 13). It:

  * Defines the P3 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/docs/phases/P3-observability-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    two P3-specific additional verifications Task 27 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the P3 observability/log property-based tests:
        ``test_tag_fixity_pbt``, ``test_loopback_boundary_pbt``,
        ``test_log_required_fields_pbt``, ``test_log_redaction_pbt``,
        ``test_log_allowlist_pbt``, ``test_log_bounds_pbt``,
        ``test_log_sink_url_pbt``, ``test_log_queue_pbt``.
  * Establishes the three P3 completion conditions from real in-process checks:
      - X1 (13 metrics exposed) via the metric-contract checker
        (``backend/bin/metrics_contract_report.py``);
      - X2 (redaction property passes) from the P3 property-based suite, which
        includes ``test_log_redaction_pbt``;
      - X3 (loopback-only binding confirmed) via
        ``observability_up.validate_port_declarations`` over the canonical
        loopback port publishes.
  * Writes the D9 report to ``backend/log/phases/P3-observability-report.json``.

Completion condition (design table row P3): all 13 catalog metrics exposed on
the dashboard, the redaction property passes, loopback-only binding confirmed,
all seven verification commands pass, and every enumerated public route responds
within 5s without a server error.

Environment reality honoured honestly (no fabrication), same as P1/P2:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The property-based suite needs ``hypothesis``. The repo's system
    ``python3`` lacks it; the project ``.venv/bin/python`` has it. The P3 PBTs
    are therefore run with the venv interpreter when present, and the
    interpreter's repo-relative path is recorded.
  * When the operator-secret precondition fails closed, P3's live dashboard
    completion evidence (the four ``apps/web`` verification commands, which need
    a real build) cannot be established, so those commands are NOT executed
    (this also avoids writing Next.js build artifacts into the worktree). They
    are recorded as not-executed (``passed: null``) and the gate result is an
    honest ``phase_verification_failed`` / not-satisfied — never a fabricated
    pass. The metric-contract, loopback-binding, and redaction checks are pure,
    secret-free static verifications and are always run for real.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate``,
``metrics_contract_report`` and ``observability_up`` are loaded by file path,
matching the sibling PBT tests. The report contains only bounded status fields —
never cookies, headers, local storage, admin body/table content, Supabase
payloads, provider diagnostics, or any Forbidden_Log_Field.
``unexplainedWorktreeChanges`` is a path list only.
"""

from __future__ import annotations

import importlib.util
import json
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
    # backend/bin/run_p3_gate.py -> backend/bin -> backend -> <repo root>
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
# P3 configuration (design "단계 순서와 Phase_Gate", row 3; D9 example).
# ---------------------------------------------------------------------------

P3_PHASE_ID = "P3-observability"
P3_SEQUENCE = 3
P3_ASSIGNED_REQUIREMENTS = [12, 13]
P3_ROLLBACK_PLAN_REF = "backend/docs/phases/P3-observability-rollback.json"

# Entry conditions (each with a decidable statement and a unique id). P3 enters
# only after P2 completed (design table: "진입: P2 완료").
P3_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P3-E1",
        "statement": "P2-publication 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P3.
_EXIT_METRICS = "P3-X1"
_EXIT_REDACTION = "P3-X2"
_EXIT_LOOPBACK = "P3-X3"
_EXIT_COMMANDS = "P3-X4"
_EXIT_ROUTES = "P3-X5"

P3_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_METRICS: "13개 지표 전부가 대시보드 질의 대상으로 노출된다",
    _EXIT_REDACTION: "레다크션 속성 검사가 통과했다",
    _EXIT_LOOPBACK: "모든 서비스 포트 게시가 루프백 전용 바인딩이다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P3 gate's route check
# (Requirement 16.10). Bounded route strings only.
P3_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Fixed, bounded note recorded against a verification command that was not
# executed because a P3 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The P3 observability/log property-based tests, as dotted module names under
# the ``backend.pipeline_control`` package. Running them via
# ``python -m unittest <dotted>`` keeps the repo root on sys.path[0] (cwd),
# which avoids the package-local ``queue.py`` shadowing the stdlib ``queue``
# that hypothesis imports. The redaction property (``test_log_redaction_pbt``)
# is a member of this set, so a passing suite establishes exit condition X2.
_P3_PBT_MODULES: tuple[str, ...] = (
    "backend.pipeline_control.test_tag_fixity_pbt",
    "backend.pipeline_control.test_loopback_boundary_pbt",
    "backend.pipeline_control.test_log_required_fields_pbt",
    "backend.pipeline_control.test_log_redaction_pbt",
    "backend.pipeline_control.test_log_allowlist_pbt",
    "backend.pipeline_control.test_log_bounds_pbt",
    "backend.pipeline_control.test_log_sink_url_pbt",
    "backend.pipeline_control.test_log_queue_pbt",
)


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
    """Return the interpreter to run the PBT suite with (hypothesis lives here).

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
# Additional P3 verification commands (Task 27): env-contract + P3 PBTs.
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
    """Run the two P3-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    Neither command writes build artifacts. ``check_env_contract`` is run with
    ``--json`` so only the missing-required COUNT is recorded — never env var
    names, values, or any Forbidden_Log_Field. The P3 observability/log PBTs are
    run with the venv interpreter (hypothesis) when available.
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

    # 2) P3 observability/log property-based suite (needs hypothesis => venv
    #    python). Modules are named explicitly so only the P3 properties run;
    #    the repo root stays on sys.path (cwd ``.``).
    pbt_interp = _venv_python(repo_root)
    pbt_argv = (pbt_interp, "-m", "unittest", *_P3_PBT_MODULES)
    pbt_rc, _ = run(".", pbt_argv)
    records.append(
        {
            "label": "observability_p3_pbt",
            "cwd": ".",
            "command": ("python -m unittest " + " ".join(_P3_PBT_MODULES)),
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
# need not depend on the live modules.
Evaluator = Callable[[], dict]


def _default_metrics_evaluator() -> dict:
    """X1: verify the dashboard exposes the full 13-metric catalog (12.5, 12.14).

    Loads ``backend/bin/metrics_contract_report.py`` by path and runs its
    contract checker over the frozen catalog. Returns a bounded summary
    ``{satisfied, metricCount, missingCount}``: ``satisfied`` is True only when
    the checker accepts (no missing target) AND the catalog holds exactly 13
    metrics. Never emits a provider/database diagnostic.
    """

    try:
        module = _load_sibling("metrics_contract_report", "metrics_contract_report.py")
        report = module.build_report(list(module.CATALOG_METRICS))
    except Exception:  # pragma: no cover - defensive
        return {"satisfied": None, "metricCount": None, "missingCount": None}
    metric_count = report.get("catalogMetricCount")
    missing = report.get("missing")
    missing_count = len(missing) if isinstance(missing, list) else None
    satisfied = bool(report.get("ok")) and metric_count == 13
    return {
        "satisfied": satisfied,
        "metricCount": metric_count if isinstance(metric_count, int) else None,
        "missingCount": missing_count,
    }


def _default_loopback_evaluator() -> dict:
    """X3: verify every service port publish is loopback-only (12.2, 12.3).

    Loads ``backend/bin/observability_up.py`` by path and runs
    ``validate_port_declarations`` over the canonical core + optional loopback
    declarations. Returns a bounded summary
    ``{satisfied, nonLoopbackCount, declarationCount}``.
    """

    try:
        module = _load_sibling("observability_up", "observability_up.py")
        declarations = {
            **module.CORE_PORT_DECLARATIONS,
            **module.OPTIONAL_PORT_DECLARATIONS,
        }
        outcome = module.validate_port_declarations(declarations)
    except Exception:  # pragma: no cover - defensive
        return {"satisfied": None, "nonLoopbackCount": None, "declarationCount": None}
    non_loopback = outcome.get("nonLoopback")
    non_loopback_count = len(non_loopback) if isinstance(non_loopback, list) else None
    return {
        "satisfied": bool(outcome.get("ok")),
        "nonLoopbackCount": non_loopback_count,
        "declarationCount": len(declarations),
    }


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


def _pbt_passed(records: list[dict]) -> bool | None:
    """X2 evidence: whether the P3 PBT suite (incl. redaction) passed.

    Returns the recorded ``passed`` bool for the ``observability_p3_pbt`` entry,
    or ``None`` when the record is absent/indeterminate.
    """

    for rec in records:
        if rec.get("label") == "observability_p3_pbt":
            passed = rec.get("passed")
            return passed if isinstance(passed, bool) else None
    return None


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p3_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P3 phase-report input for ``evaluate_phase_gate``.

    ``exit_overrides`` maps exit condition ids to their ``satisfied`` value
    (True/False/None). ``publicRouteChecks`` declares the routes to check;
    ``evaluate_phase_gate`` records only bounded route results.
    """

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P3_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (
            _EXIT_METRICS,
            _EXIT_REDACTION,
            _EXIT_LOOPBACK,
            _EXIT_COMMANDS,
            _EXIT_ROUTES,
        )
    ]

    return {
        "phaseId": P3_PHASE_ID,
        "sequence": P3_SEQUENCE,
        "assignedRequirements": list(P3_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P3_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P3_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P3_ROLLBACK_PLAN_REF,
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
    worktree, and without operator secrets P3 completion cannot be established
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


def run_p3_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: phase_gate.CommandRunner | None = None,
    route_checker: phase_gate.RouteChecker | None = None,
    metrics_evaluator: Evaluator | None = None,
    loopback_evaluator: Evaluator | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P3 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications", "metricsContract",
    "loopbackBinding"}``. When operator secrets are absent
    (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # In-process static evidence for the three P3-specific completion conditions.
    metrics_result = (metrics_evaluator or _default_metrics_evaluator)()
    loopback_result = (loopback_evaluator or _default_loopback_evaluator)()
    redaction_satisfied = _pbt_passed(additional_records)

    # Gather bounded exit-condition evidence.
    exit_overrides: dict[str, bool | None] = {
        _EXIT_METRICS: metrics_result.get("satisfied"),
        _EXIT_REDACTION: redaction_satisfied,
        _EXIT_LOOPBACK: loopback_result.get("satisfied"),
        # X4 (7 commands pass) and X5 (routes ok) are enforced by the gate's own
        # verification phase: a failing command or route yields
        # phase_verification_failed BEFORE exit conditions are consulted. Seeding
        # True is therefore accurate for the exit-condition stage (only reached
        # once verification passed); the persisted report is rewritten below to
        # the real computed pass/fail so the artifact stays honest.
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p3_report(repo_root=root, exit_overrides=exit_overrides)

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

    # Merge the two P3-specific additional verifications, the metric-contract and
    # loopback-binding summaries, and a bounded precondition summary into the
    # written D9 report, and finalise X4/X5 from the recorded command/route
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
            written["metricsContractCheck"] = metrics_result
            written["loopbackBindingCheck"] = loopback_result
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
        "metricsContract": metrics_result,
        "loopbackBinding": loopback_result,
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P3 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P3-observability Phase_Gate and write its D9 report"
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

    result = run_p3_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P3 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        mc = result["metricsContract"]
        print(
            "metrics contract: "
            f"satisfied={str(mc.get('satisfied')).lower()} "
            f"metricCount={mc.get('metricCount')}"
        )
        lb = result["loopbackBinding"]
        print(
            "loopback binding: "
            f"satisfied={str(lb.get('satisfied')).lower()} "
            f"nonLoopbackCount={lb.get('nonLoopbackCount')}"
        )
        for rec in result["additionalVerifications"]:
            print(f"  {rec['label']}: passed={str(rec['passed']).lower()}")
        if result["reportPath"]:
            print(f"report: {result['reportPath']}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
