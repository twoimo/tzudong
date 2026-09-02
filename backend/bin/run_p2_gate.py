#!/usr/bin/env python3
"""P2 (P2-publication) Phase_Gate verification runner (Task 18).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P2 phase from design's "단계 순서와
Phase_Gate" table (sequence 2, requirement 10). It:

  * Defines the P2 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/log/phases/P2-publication-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    two P2-specific additional verifications Task 18 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the P2 publish property-based tests (Property 19-24):
        ``test_publish_payload_pbt``, ``test_publish_hash_pbt``,
        ``test_publish_batch_pbt``, ``test_publish_idempotency_pbt``,
        ``test_publish_readback_pbt``, ``test_publish_codes_pbt``.
  * Writes the D9 report to ``backend/log/phases/P2-publication-report.json``.

Completion condition (design table row P2): the five Publish_Worker stages
(preview -> confirm -> apply -> readback -> audit) all pass, and the value is
unchanged after two consecutive applies (idempotent convergence), all seven
verification commands pass, and every enumerated public route responds within
5s without a server error.

Environment reality honoured honestly (no fabrication), same as P1:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The property-based suite needs ``hypothesis``. The repo's system
    ``python3`` lacks it; the project ``.venv/bin/python`` has it. The P2 PBTs
    are therefore run with the venv interpreter when present, and the
    interpreter's repo-relative path is recorded.
  * When the operator-secret precondition fails closed, P2's execution
    completion evidence (five-stage pass and idempotent convergence from a real
    ``heavy_local``+``local_db`` publish against a local Supabase) cannot be
    established, so the four ``apps/web`` verification commands are NOT executed
    (this also avoids writing Next.js build artifacts into the worktree). They
    are recorded as not-executed (``passed: null``) and the gate result is an
    honest ``phase_verification_failed`` / not-satisfied — never a fabricated
    pass.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate`` is
loaded by file path, matching the sibling PBT tests. The report contains only
bounded status fields — never cookies, headers, local storage, admin body/table
content, Supabase payloads, provider diagnostics, or any Forbidden_Log_Field.
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
# Load the Phase_Gate runner by file path (backend/bin has no __init__.py).
# ---------------------------------------------------------------------------

_THIS = Path(__file__).resolve()


def _repo_root() -> Path:
    # backend/bin/run_p2_gate.py -> backend/bin -> backend -> <repo root>
    return _THIS.parents[2]


def _load_phase_gate():
    path = _THIS.parent / "phase_gate.py"
    spec = importlib.util.spec_from_file_location("phase_gate", path)
    if not spec or not spec.loader:  # pragma: no cover - defensive
        raise ImportError("cannot load backend/bin/phase_gate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase_gate = _load_phase_gate()

# ---------------------------------------------------------------------------
# P2 configuration (design "단계 순서와 Phase_Gate", row 2; D9 example).
# ---------------------------------------------------------------------------

P2_PHASE_ID = "P2-publication"
P2_SEQUENCE = 2
P2_ASSIGNED_REQUIREMENTS = [10]
P2_ROLLBACK_PLAN_REF = "backend/log/phases/P2-publication-rollback.json"

# Entry conditions (each with a decidable statement and a unique id). P2 enters
# only after P1 completed (design table: "진입: P1 완료").
P2_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P2-E1",
        "statement": "P1-local-pipeline 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P2.
_EXIT_FIVE_STAGES = "P2-X1"
_EXIT_IDEMPOTENT = "P2-X2"
_EXIT_COMMANDS = "P2-X3"
_EXIT_ROUTES = "P2-X4"

P2_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_FIVE_STAGES: (
        "미리보기->확인->적용->읽기검증->감사 5단계 전부 통과했다"
    ),
    _EXIT_IDEMPOTENT: "2회 연속 적용 후 게시 대상 값이 불변이다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P2 gate's route check
# (Requirement 16.10). Bounded route strings only.
P2_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Artifact that carries P2 execution completion evidence, if a real
# heavy_local+local_db publish run has been produced. It records whether the
# five Publish_Worker stages all passed and whether a second consecutive apply
# converged with unchanged values (idempotent convergence, Requirement 10.11).
_EXECUTION_SUMMARY_ARTIFACT = "backend/log/phases/P2-publication-execution-summary.json"

# Fixed, bounded note recorded against a verification command that was not
# executed because a P2 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The P2 publish property-based tests (Property 19-24), as dotted module names
# under the ``backend.pipeline_control`` package. Running them via
# ``python -m unittest <dotted>`` keeps the repo root on sys.path[0] (cwd),
# which avoids the package-local ``queue.py`` shadowing the stdlib ``queue``
# hypothesis imports.
_P2_PBT_MODULES: tuple[str, ...] = (
    "backend.pipeline_control.test_publish_payload_pbt",
    "backend.pipeline_control.test_publish_hash_pbt",
    "backend.pipeline_control.test_publish_batch_pbt",
    "backend.pipeline_control.test_publish_idempotency_pbt",
    "backend.pipeline_control.test_publish_readback_pbt",
    "backend.pipeline_control.test_publish_codes_pbt",
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
# Additional P2 verification commands (Task 18): env-contract + P2 publish PBTs.
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
    """Run the two P2-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    Neither command writes build artifacts. ``check_env_contract`` is run with
    ``--json`` so only the missing-required COUNT is recorded — never env var
    names, values, or any Forbidden_Log_Field. The P2 publish PBTs are run with
    the venv interpreter (hypothesis) when available.
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

    # 2) P2 publish property-based suite (Property 19-24; needs hypothesis =>
    #    venv python). Modules are named explicitly so only the P2 publish
    #    properties run; the repo root stays on sys.path (cwd ``.``).
    pbt_interp = _venv_python(repo_root)
    pbt_argv = (pbt_interp, "-m", "unittest", *_P2_PBT_MODULES)
    pbt_rc, _ = run(".", pbt_argv)
    records.append(
        {
            "label": "publish_p2_pbt",
            "cwd": ".",
            "command": (
                "python -m unittest " + " ".join(_P2_PBT_MODULES)
            ),
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
# Exit-condition evidence gathering (bounded, artifact-derived).
# ---------------------------------------------------------------------------


def _read_json_artifact(repo_root: Path, rel_path: str) -> dict | None:
    path = repo_root / rel_path
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _five_stages_satisfied(repo_root: Path) -> bool | None:
    """X1: the five Publish_Worker stages all passed.

    True only when an execution-summary artifact records
    ``allStagesPassed == True``. Absent artifact -> ``None`` (unverified); a
    recorded ``False`` -> ``False``.
    """

    summary = _read_json_artifact(repo_root, _EXECUTION_SUMMARY_ARTIFACT)
    if summary is None:
        return None
    value = summary.get("allStagesPassed")
    if not isinstance(value, bool):
        return None
    return value


def _idempotent_convergence_satisfied(repo_root: Path) -> bool | None:
    """X2: two consecutive applies leave the published values unchanged.

    True only when the execution-summary artifact records
    ``idempotentConvergence == True`` (Requirement 10.11 ``converged_no_op`` on
    the second apply). Absent artifact -> ``None`` (unverified).
    """

    summary = _read_json_artifact(repo_root, _EXECUTION_SUMMARY_ARTIFACT)
    if summary is None:
        return None
    value = summary.get("idempotentConvergence")
    if not isinstance(value, bool):
        return None
    return value


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p2_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P2 phase-report input for ``evaluate_phase_gate``.

    ``exit_overrides`` maps exit condition ids to their ``satisfied`` value
    (True/False/None). ``publicRouteChecks`` declares the routes to check;
    ``evaluate_phase_gate`` records only bounded route results.
    """

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P2_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (_EXIT_FIVE_STAGES, _EXIT_IDEMPOTENT, _EXIT_COMMANDS, _EXIT_ROUTES)
    ]

    return {
        "phaseId": P2_PHASE_ID,
        "sequence": P2_SEQUENCE,
        "assignedRequirements": list(P2_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P2_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P2_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P2_ROLLBACK_PLAN_REF,
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
    worktree, and without operator secrets P2 completion cannot be established
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


def run_p2_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: phase_gate.CommandRunner | None = None,
    route_checker: phase_gate.RouteChecker | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P2 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications"}``. When operator secrets are
    absent (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # Gather bounded exit-condition evidence.
    exit_overrides: dict[str, bool | None] = {
        _EXIT_FIVE_STAGES: _five_stages_satisfied(root),
        _EXIT_IDEMPOTENT: _idempotent_convergence_satisfied(root),
        # X3 (7 commands pass) and X4 (routes ok) are enforced by the gate's own
        # verification phase: a failing command or route yields
        # phase_verification_failed BEFORE exit conditions are consulted. Seeding
        # True is therefore accurate for the exit-condition stage (only reached
        # once verification passed); the persisted report is rewritten below to
        # the real computed pass/fail so the artifact stays honest.
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p2_report(repo_root=root, exit_overrides=exit_overrides)

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

    # Merge the two P2-specific additional verifications and a bounded
    # precondition summary into the written D9 report, and finalise X3/X4 from
    # the recorded command/route results.
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
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P2 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P2-publication Phase_Gate and write its D9 report"
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

    result = run_p2_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P2 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        for rec in result["additionalVerifications"]:
            print(f"  {rec['label']}: passed={str(rec['passed']).lower()}")
        if result["reportPath"]:
            print(f"report: {result['reportPath']}")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
