#!/usr/bin/env python3
"""P7 (P7-readiness-agent) Phase_Gate verification runner (Task 53).

This wires the cross-cutting Phase_Gate runner (``backend/bin/phase_gate.py``,
Task 1 / design C12) to the concrete P7 phase from design's "단계 순서와
Phase_Gate" table (sequence 7, requirements 14, 15). It follows the exact shape
of the P6 runner (``backend/bin/run_p6_gate.py``, Task 47):

  * Defines the P7 Phase_Gate configuration — entry conditions, exit
    conditions, the public routes to check, and the Rollback_Plan reference
    (``backend/log/phases/P7-readiness-agent-rollback.json``).
  * Runs the Requirement 16.4 seven-command set (via ``phase_gate``), plus the
    P7-specific additional verifications Task 53 enumerates:
      - ``python backend/bin/check_env_contract.py --profile daily``
      - the four P7 property-based tests (Properties 33, 34, 35, 36), run with
        the venv python (hypothesis):
          ``backend/pipeline_control/test_descriptor_secret_pbt.py`` (Property 33),
          ``backend/pipeline_control/test_cluster_render_pbt.py`` (Property 34),
          ``backend/pipeline_control/test_agent_boundary_pbt.py`` (Property 35),
          ``backend/pipeline_control/test_agent_rate_pbt.py`` (Property 36).
      - ``python backend/bin/check_deployment_descriptor_set.py`` (the C10
        Deployment_Descriptor_Set local-render checker; secret-free, static).
  * Establishes the three P7-specific completion conditions from real,
    secret-free static/in-process evidence:
      - X1 (descriptor secret literals = 0) via
        ``deployment_descriptor.scan_descriptor_files`` over the Helm chart,
        OpenTofu configs, and JSON catalog: satisfied only when the scan finds
        zero secret literals and the catalog is structurally complete;
      - X2 (2+ cluster identifiers render, diffs ⊆ DERIVED_FIELDS, remote
        attempts = 0) via ``deployment_descriptor.render_multi_cluster``:
        satisfied only when two or more cluster identifiers render, the fields
        that differ are a subset of
        :data:`deployment_descriptor.DERIVED_FIELDS`, and the recorded remote
        apply attempt count is 0;
      - X3 (allowlist-external actions = 0) via the ``ops_agent`` boundary:
        satisfied only when, exercising the Ops_Agent decision boundary over a
        battery of candidate signals (allowlisted, not-allowlisted, high-risk
        without approval, never-performed), the count of PERFORMED actions whose
        action kind is outside the allowlist is 0, the allowlisted action IS
        performed, and every out-of-boundary category is refused.
  * Writes the D9 report to ``backend/log/phases/P7-readiness-agent-report.json``.

Environment reality honoured honestly (no fabrication), same as P1-P6:

  * ``check_env_contract.py --profile daily`` FAILS CLOSED when required
    operator secrets are absent. That is expected and correct; this runner
    records the failure (as a bounded ``missingRequiredCount``, never names or
    values) and does NOT invent secrets.
  * The four P7 PBTs need ``hypothesis`` and are run with ``.venv/bin/python``
    when present, via ``-m unittest <module>`` (keeps the repo root on the path
    and avoids the local ``queue.py`` shadow of ``backend/pipeline_control``).
  * When the operator-secret precondition fails closed, P7's live completion
    evidence (the four ``apps/web`` verification commands, which need a real
    build) cannot be established, so those commands are NOT executed (this also
    avoids writing Next.js build artifacts into the worktree). They are recorded
    as not-executed (``passed: null``) and the gate result is an honest
    ``phase_verification_failed`` / not-satisfied — never a fabricated pass. The
    descriptor secret scan, multi-cluster render, and Ops_Agent boundary are
    pure, secret-free verifications and are always run for real.

``backend/bin`` scripts are standalone (no ``__init__.py``); ``phase_gate`` is
loaded by file path. ``deployment_descriptor`` and ``ops_agent`` are imported as
``backend.pipeline_control.*`` packages. The report contains only bounded status
fields — never cookies, headers, local storage, admin body/table content,
Supabase payloads, provider diagnostics, or any Forbidden_Log_Field.
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
    # backend/bin/run_p7_gate.py -> backend/bin -> backend -> <repo root>
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

# ``deployment_descriptor`` and ``ops_agent`` are proper package modules; make
# the repo root importable so ``backend.*`` resolves regardless of the launch cwd.
if str(_repo_root()) not in sys.path:
    sys.path.insert(0, str(_repo_root()))

# ---------------------------------------------------------------------------
# P7 configuration (design "단계 순서와 Phase_Gate", row 7; D9 example).
# ---------------------------------------------------------------------------

P7_PHASE_ID = "P7-readiness-agent"
P7_SEQUENCE = 7
P7_ASSIGNED_REQUIREMENTS = [14, 15]
P7_ROLLBACK_PLAN_REF = "backend/log/phases/P7-readiness-agent-rollback.json"

# Canonical inputs the P7-specific static checks are anchored to (design C10).
_CATALOG_REF = "backend/deploy/deployment-descriptor-set.v1.json"
_HELM_DIR_REF = "backend/deploy/helm"
_OPENTOFU_DIR_REF = "backend/deploy/opentofu"
_ALLOWLIST_REF = "backend/deploy/agent-action-allowlist.v1.json"
_RATE_LIMITS_REF = "backend/deploy/agent-action-rate-limits.v1.json"

# Two local cluster identifiers used to prove definition reuse (Requirement
# 14.5). Both are local; neither implies a remote target.
_CLUSTER_IDS = ("local-a", "local-b")

# Entry conditions (each with a decidable statement and a unique id). P7 enters
# only after P6 completed (design table: "진입: P6 완료").
P7_ENTRY_CONDITIONS: tuple[dict, ...] = (
    {
        "conditionId": "P7-E1",
        "statement": "P6-rust 단계가 완료 판정을 통과했다",
        "satisfied": None,
    },
)

# Exit (completion) conditions from the design table for P7.
_EXIT_SECRET = "P7-X1"
_EXIT_RENDER = "P7-X2"
_EXIT_AGENT = "P7-X3"
_EXIT_COMMANDS = "P7-X4"
_EXIT_ROUTES = "P7-X5"

P7_EXIT_STATEMENTS: dict[str, str] = {
    _EXIT_SECRET: "Deployment_Descriptor_Set에서 시크릿 리터럴 검출 수가 0이다",
    _EXIT_RENDER: "2개 이상 클러스터 식별자가 렌더링되고 차이 필드가 파생 필드뿐이며 원격 적용 시도가 0이다",
    _EXIT_AGENT: "Ops_Agent 경계에서 허용목록 외 수행 조치 수가 0이다",
    _EXIT_COMMANDS: "7개 검증 명령 전부 성공이다",
    _EXIT_ROUTES: "열거된 공개 라우트 전부가 5초 이내 서버 오류 없이 응답했다",
}

# Web_App public (non-admin) routes enumerated for the P7 gate's route check
# (Requirement 16.10). Bounded route strings only.
P7_PUBLIC_ROUTES: tuple[str, ...] = (
    "/",
    "/global-map",
    "/insights",
    "/leaderboard",
    "/feed",
    "/privacy",
)

# Fixed, bounded note recorded against a verification command that was not
# executed because a P7 precondition failed closed. Never a diagnostic string.
_NOT_EXECUTED_NOTE = "not_executed_operator_secret_precondition_failed"

# The four P7 property-based tests. Each is ``(label, module)`` and is a
# ``backend.pipeline_control`` PBT run via ``python -m unittest <module>``.
_P7_PBT_MODULES: tuple[tuple[str, str], ...] = (
    ("descriptor_secret_p7_pbt", "backend.pipeline_control.test_descriptor_secret_pbt"),
    ("cluster_render_p7_pbt", "backend.pipeline_control.test_cluster_render_pbt"),
    ("agent_boundary_p7_pbt", "backend.pipeline_control.test_agent_boundary_pbt"),
    ("agent_rate_p7_pbt", "backend.pipeline_control.test_agent_rate_pbt"),
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
# Additional P7 verification commands (Task 53): env-contract + P7 PBTs +
# Deployment_Descriptor_Set checker.
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
    """Run the P7-specific additional verifications; return bounded records.

    Returns ``(records, precondition)`` where ``records`` is a list of bounded
    ``{label, cwd, command, interpreter, passed, ranAt}`` entries and
    ``precondition`` summarises the operator-secret gate:
    ``{operatorSecretsPresent: bool, missingRequiredCount: int|None}``.

    ``check_env_contract`` is run with ``--json`` so only the missing-required
    COUNT is recorded — never env var names, values, or any Forbidden_Log_Field.
    The four P7 PBTs are run via ``-m unittest`` with the venv interpreter
    (hypothesis) when available. The Deployment_Descriptor_Set checker is a
    secret-free static verification. None of these writes a Next.js build
    artifact.
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

    # 2-5) The four P7 PBTs (Properties 33, 34, 35, 36). Each needs hypothesis
    #       => venv python, run via ``-m unittest`` (keeps repo root on the path,
    #       avoids the local ``queue.py`` shadow).
    pbt_interp = _venv_python(repo_root)
    for label, module in _P7_PBT_MODULES:
        argv = (pbt_interp, "-m", "unittest", module)
        rc, _ = run(".", argv, None)
        records.append(
            {
                "label": label,
                "cwd": ".",
                "command": f"python -m unittest {module}",
                "interpreter": _rel(repo_root, pbt_interp),
                "passed": rc == 0,
                "ranAt": clock(),
            }
        )

    # 6) Deployment_Descriptor_Set checker (C10; secret-free static render).
    dd_argv = (pbt_interp, "backend/bin/check_deployment_descriptor_set.py", "--json")
    dd_rc, _ = run(".", dd_argv, None)
    records.append(
        {
            "label": "deployment_descriptor_set_check",
            "cwd": ".",
            "command": "python backend/bin/check_deployment_descriptor_set.py",
            "interpreter": _rel(repo_root, pbt_interp),
            "passed": dd_rc == 0,
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
# need not depend on the live modules or on the on-disk descriptor set.
Evaluator = Callable[[], dict]


def _default_descriptor_evaluator() -> dict:
    """X1 + X2: scan descriptor files for secret literals and render two clusters.

    Loads the Deployment_Descriptor_Set catalog and scans the Helm chart,
    OpenTofu configs, and JSON catalog for secret literals via
    ``deployment_descriptor.scan_descriptor_files``; then renders the catalog for
    two local cluster identifiers via
    ``deployment_descriptor.render_multi_cluster`` and checks that the fields
    that differ are a subset of :data:`deployment_descriptor.DERIVED_FIELDS`
    with zero remote apply attempts.

    Returns a bounded summary
    ``{secretLiteralsZero, findingCount, scannedFileCount, structuralOk,
    clusterRenderOk, clusterIdCount, differingFields,
    differingFieldsSubsetDerived, remoteApplyAttemptCount}``. Findings carry only
    a finding kind, file path, and line number (never the offending value). No
    provider/database diagnostic is emitted.
    """

    root = _repo_root()
    try:
        from backend.pipeline_control import deployment_descriptor as dd
        from backend.pipeline_control import ledger_validation
    except Exception:  # pragma: no cover - defensive
        return {
            "secretLiteralsZero": None,
            "findingCount": None,
            "scannedFileCount": None,
            "structuralOk": None,
            "clusterRenderOk": None,
            "clusterIdCount": None,
            "differingFields": None,
            "differingFieldsSubsetDerived": None,
            "remoteApplyAttemptCount": None,
        }

    catalog_path = root / _CATALOG_REF
    try:
        catalog = dd.load_catalog(catalog_path)
    except (OSError, ValueError):
        return {
            "secretLiteralsZero": False,
            "findingCount": None,
            "scannedFileCount": 0,
            "structuralOk": False,
            "clusterRenderOk": False,
            "clusterIdCount": 0,
            "differingFields": [],
            "differingFieldsSubsetDerived": False,
            "remoteApplyAttemptCount": 0,
        }

    structural = ledger_validation.validate_ledger("deployment_descriptor_set", catalog)
    structural_ok = bool(structural.get("ok"))

    # Collect the descriptor files that must be free of secret literals.
    files = _descriptor_files(root)
    secret_scan = dd.scan_descriptor_files(files)
    finding_count = int(secret_scan.get("findingCount", 0) or 0)
    scanned = int(secret_scan.get("scannedFileCount", 0) or 0)
    secret_zero = bool(secret_scan.get("ok")) and finding_count == 0

    # Multi-cluster render (local only). Gate behind the secret scan so a
    # detected literal yields zero render artifacts (Requirement 14.4).
    if not secret_zero:
        render_ok = False
        cluster_id_count = 0
        differing: list[str] = []
        subset_derived = False
        remote_attempts = 0
    else:
        render = dd.render_multi_cluster(catalog, list(_CLUSTER_IDS))
        differing = list(render.get("differingFields", []) or [])
        subset_derived = set(differing).issubset(set(dd.DERIVED_FIELDS))
        remote_attempts = int(render.get("remoteApplyAttemptCount", 0) or 0)
        cluster_id_count = len(render.get("clusterIds", []) or [])
        render_ok = (
            bool(render.get("ok"))
            and cluster_id_count >= 2
            and subset_derived
            and remote_attempts == 0
        )

    return {
        "secretLiteralsZero": secret_zero,
        "findingCount": finding_count,
        "scannedFileCount": scanned,
        "structuralOk": structural_ok,
        "clusterRenderOk": render_ok,
        "clusterIdCount": cluster_id_count,
        "differingFields": sorted(differing),
        "differingFieldsSubsetDerived": subset_derived,
        "remoteApplyAttemptCount": remote_attempts,
    }


_DESCRIPTOR_SUFFIXES = (".yaml", ".yml", ".tpl", ".tf", ".json")


def _descriptor_files(repo_root: Path) -> list[Path]:
    """Collect the descriptor files that must be free of secret literals."""

    files: list[Path] = []
    catalog_path = repo_root / _CATALOG_REF
    if catalog_path.is_file():
        files.append(catalog_path)
    for rel in (_HELM_DIR_REF, _OPENTOFU_DIR_REF):
        directory = repo_root / rel
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path.suffix.lower() in _DESCRIPTOR_SUFFIXES:
                files.append(path)
    return files


def _default_agent_boundary_evaluator() -> dict:
    """X3: exercise the Ops_Agent boundary; count allowlist-external performed = 0.

    The committed Agent_Action_Allowlist is fail-closed by design (operator
    approval unresolved), so its active state is recorded honestly. To prove the
    *boundary* enforces "허용목록 외 조치 0", the Ops_Agent is exercised in
    process with an active allowlist derived from the ledger's declared action
    kinds over a battery of candidate signals: one allowlisted (must perform),
    one not-allowlisted (must refuse), one high-risk without approval (must
    refuse), and one never-performed (must refuse). The condition is satisfied
    only when the count of PERFORMED actions whose kind is outside the allowlist
    is 0, the allowlisted action is performed, and every out-of-boundary category
    is refused. Returns a bounded summary — no provider/database diagnostic or
    signal body.
    """

    root = _repo_root()
    try:
        from backend.pipeline_control import ops_agent as oa
    except Exception:  # pragma: no cover - defensive
        return {
            "satisfied": None,
            "performedExternalCount": None,
            "allowlistedPerformed": None,
            "refusedNotAllowlisted": None,
            "refusedHighRiskNoApproval": None,
            "refusedNeverPerformed": None,
            "committedAllowlistActive": None,
            "allowlistKindCount": None,
        }

    allowlist = oa.load_allowlist(root / _ALLOWLIST_REF)
    committed_active = bool(allowlist.get("active"))
    kinds = allowlist.get("actionKinds")
    if not kinds:
        # No declared action kinds to exercise the boundary against.
        return {
            "satisfied": False,
            "performedExternalCount": None,
            "allowlistedPerformed": None,
            "refusedNotAllowlisted": None,
            "refusedHighRiskNoApproval": None,
            "refusedNeverPerformed": None,
            "committedAllowlistActive": committed_active,
            "allowlistKindCount": 0,
        }

    kinds = frozenset(kinds)
    an_allowlisted_kind = sorted(kinds)[0]

    fixed_clock = [1000.0]
    store = oa.InMemoryAgentActionStore()
    agent = oa.OpsAgent(
        allowlist_kinds=kinds,
        rate_limiter=oa.SlidingRateLimiter(
            [{"windowMinutes": 60, "maxActions": 10}, {"windowMinutes": 1440, "maxActions": 40}],
            active=True,
        ),
        store=store,
        executor=lambda kind: None,
        verifier=lambda kind: True,
        clock=lambda: fixed_clock[0],
    )

    def _signal(signal_id: str, kind: str) -> "oa.Signal":
        return oa.Signal(
            signal_id=signal_id,
            source=oa.SIGNAL_SOURCE_OBSERVABILITY,
            kind=kind,
            severity="high",
        )

    def _rule(kind: str, action_kind_id: str) -> "oa.WatchRule":
        return oa.WatchRule(
            rule_id=f"rule-{action_kind_id}",
            active=True,
            source=oa.SIGNAL_SOURCE_OBSERVABILITY,
            kind=kind,
            min_severity="warning",
            action_kind_id=action_kind_id,
        )

    battery = [
        ("allowlisted", "k-allow", an_allowlisted_kind),
        ("not_allowlisted", "k-ext", "frobnicate_production_cluster"),
        ("high_risk_no_approval", "k-risk", "hosted_migration_apply"),
        ("never_performed", "k-never", "release_self_approval"),
    ]

    outcomes: dict[str, dict] = {}
    performed_external = 0
    for label, signal_id, action_kind_id in battery:
        result = agent.process_signal(
            _signal(signal_id, action_kind_id), [_rule(action_kind_id, action_kind_id)]
        )
        outcomes[label] = result
        if result.get("performed") and result.get("actionKindId") not in kinds:
            performed_external += 1

    allowlisted_performed = bool(outcomes["allowlisted"].get("performed"))
    refused_not_allowlisted = not outcomes["not_allowlisted"].get("performed")
    refused_high_risk = not outcomes["high_risk_no_approval"].get("performed")
    refused_never = not outcomes["never_performed"].get("performed")

    satisfied = (
        performed_external == 0
        and allowlisted_performed
        and refused_not_allowlisted
        and refused_high_risk
        and refused_never
    )

    return {
        "satisfied": satisfied,
        "performedExternalCount": performed_external,
        "allowlistedPerformed": allowlisted_performed,
        "refusedNotAllowlisted": refused_not_allowlisted,
        "refusedHighRiskNoApproval": refused_high_risk,
        "refusedNeverPerformed": refused_never,
        "committedAllowlistActive": committed_active,
        "allowlistKindCount": len(kinds),
    }


def _all_passed(records: list[dict]) -> bool:
    return bool(records) and all(rec.get("passed") is True for rec in records)


# ---------------------------------------------------------------------------
# Gate orchestration.
# ---------------------------------------------------------------------------


def build_p7_report(
    *,
    repo_root: Path,
    exit_overrides: dict[str, bool | None] | None = None,
    worktree_id: str | None = None,
    unexplained_worktree_changes: list[str] | None = None,
) -> dict:
    """Assemble the P7 phase-report input for ``evaluate_phase_gate``."""

    overrides = exit_overrides or {}
    exit_conditions = [
        {
            "conditionId": cid,
            "statement": P7_EXIT_STATEMENTS[cid],
            "satisfied": overrides.get(cid, None),
        }
        for cid in (
            _EXIT_SECRET,
            _EXIT_RENDER,
            _EXIT_AGENT,
            _EXIT_COMMANDS,
            _EXIT_ROUTES,
        )
    ]

    return {
        "phaseId": P7_PHASE_ID,
        "sequence": P7_SEQUENCE,
        "assignedRequirements": list(P7_ASSIGNED_REQUIREMENTS),
        "worktreeId": worktree_id or _worktree_id(repo_root),
        "entryConditions": [dict(cond) for cond in P7_ENTRY_CONDITIONS],
        "exitConditions": exit_conditions,
        "publicRouteChecks": list(P7_PUBLIC_ROUTES),
        "unexplainedWorktreeChanges": list(unexplained_worktree_changes or []),
        "rollbackPlanRef": P7_ROLLBACK_PLAN_REF,
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


def run_p7_gate(
    *,
    repo_root: Path | None = None,
    additional_runner: AdditionalRunner | None = None,
    command_runner: "phase_gate.CommandRunner | None" = None,
    route_checker: "phase_gate.RouteChecker | None" = None,
    descriptor_evaluator: Evaluator | None = None,
    agent_boundary_evaluator: Evaluator | None = None,
    run_web_commands: bool = False,
    write_report: bool = True,
    log_dir: Path | str | None = None,
    now: Callable[[], str] | None = None,
) -> dict:
    """Run the P7 Phase_Gate and write the D9 report.

    Returns a bounded summary
    ``{"ok", "resultCode", "reportPath", "unsatisfiedConditionIds",
    "precondition", "additionalVerifications", "descriptorCheck",
    "agentBoundary"}``. When operator secrets are absent
    (``check_env_contract`` fails closed), the gate honestly reports
    ``phase_verification_failed`` and does not fabricate a pass.
    """

    root = repo_root or _repo_root()

    additional_records, precondition = run_additional_verifications(
        repo_root=root, runner=additional_runner, now=now
    )
    operator_secrets_present = bool(precondition.get("operatorSecretsPresent"))

    # In-process static evidence for the P7-specific completion conditions.
    descriptor_result = (descriptor_evaluator or _default_descriptor_evaluator)()
    agent_result = (agent_boundary_evaluator or _default_agent_boundary_evaluator)()

    exit_overrides: dict[str, bool | None] = {
        _EXIT_SECRET: descriptor_result.get("secretLiteralsZero"),
        _EXIT_RENDER: descriptor_result.get("clusterRenderOk"),
        _EXIT_AGENT: agent_result.get("satisfied"),
        # X4 (7 commands) and X5 (routes) are finalised from the recorded
        # command/route results after the gate runs. Seeding True is accurate for
        # the exit-condition stage (only reached once verification passed); the
        # persisted report is rewritten below to the real computed pass/fail so
        # the artifact stays honest.
        _EXIT_COMMANDS: True,
        _EXIT_ROUTES: True,
    }

    report_input = build_p7_report(repo_root=root, exit_overrides=exit_overrides)

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

    # Merge the P7-specific additional verifications, the descriptor and agent
    # summaries, and a bounded precondition summary into the written D9 report,
    # and finalise X4/X5 from the recorded command/route results.
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
            written["descriptorCheck"] = descriptor_result
            written["agentBoundaryCheck"] = agent_result
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
        "descriptorCheck": descriptor_result,
        "agentBoundary": agent_result,
    }


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: run the P7 gate and print a bounded summary; set the exit code.

    Exit 0 only when the gate passes (``resultCode`` is null). Any non-pass
    result (incomplete, not-satisfied, verification-failed) exits 1. Prints only
    bounded status — never captured command output or diagnostics.
    """

    import argparse

    parser = argparse.ArgumentParser(
        description="Run the P7-readiness-agent Phase_Gate and write its D9 report"
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

    result = run_p7_gate(run_web_commands=args.run_web_commands)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    else:
        code = result["resultCode"] or "pass"
        print(f"P7 gate result: {code}")
        pre = result["precondition"]
        print(
            "operator secrets present: "
            f"{str(pre.get('operatorSecretsPresent')).lower()}"
        )
        dc = result["descriptorCheck"]
        print(
            "descriptor secret literals: "
            f"zero={str(dc.get('secretLiteralsZero')).lower()} "
            f"findingCount={dc.get('findingCount')} "
            f"scannedFileCount={dc.get('scannedFileCount')} "
            f"structuralOk={str(dc.get('structuralOk')).lower()}"
        )
        print(
            "cluster render: "
            f"ok={str(dc.get('clusterRenderOk')).lower()} "
            f"clusterIds={dc.get('clusterIdCount')} "
            f"differingFields={dc.get('differingFields')} "
            f"remoteApplyAttempts={dc.get('remoteApplyAttemptCount')}"
        )
        ab = result["agentBoundary"]
        print(
            "agent boundary: "
            f"satisfied={str(ab.get('satisfied')).lower()} "
            f"performedExternal={ab.get('performedExternalCount')} "
            f"committedAllowlistActive={str(ab.get('committedAllowlistActive')).lower()}"
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
