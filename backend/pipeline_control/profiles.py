"""Compute, control-store, data-sink, and execution-mode policy."""

from __future__ import annotations

import os
from typing import Mapping

from backend.pipeline_control.graph import (
    HEAVY_CAPABILITY,
    MUTATING_CAPABILITY,
    STEP_BY_ID,
    STEP_CLASSES,
    STEP_SPECS,
    SKIP_HEAVY_REASON,
    StepSpec,
    step_class,
)
from backend.utils.privacy_log import redact_log_text
from backend.utils.supabase_rest import (
    PIPELINE_COMPUTE_PROFILES,
    PIPELINE_DATA_SINKS,
    PIPELINE_EXECUTION_MODES,
)

CONTROL_STORES = frozenset({"file", "postgres"})
HOSTED_APPLY_SINK = "hosted_apply"
ARTIFACT_SINK = "artifact_only"
LOCAL_SINK = "local_db"
DATA_SINK_ENV = "TZUDONG_DATA_SINK"
DATA_ENV_ENV = "TZUDONG_DATA_ENV"

# Bounded, fixed vocabulary of skip reason codes (R8.5). Every skip decision
# produced by ``skip_reason_for_step`` normalizes to exactly one of these codes,
# so a run summary can never carry an unbounded free-form skip reason.
SKIP_REASON_CODE_HEAVY = "skip_heavy_compute"
SKIP_REASON_CODE_ARTIFACT_MUTATING = "artifact_only_skips_mutating_step"
SKIP_REASON_CODE_TARGET_LACKS_INSERT = "target_lacks_insert_capability"
SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY = "target_lacks_capability"
SKIP_REASON_CODE_UPSTREAM = "upstream_skipped_or_failed"
SKIP_REASON_CODES = frozenset(
    {
        SKIP_REASON_CODE_HEAVY,
        SKIP_REASON_CODE_ARTIFACT_MUTATING,
        SKIP_REASON_CODE_TARGET_LACKS_INSERT,
        SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY,
        SKIP_REASON_CODE_UPSTREAM,
    }
)

# Terminal statuses assigned to each composed step (R8.1).
STEP_STATUS_SUCCEEDED = "succeeded"
STEP_STATUS_FAILED = "failed"
STEP_STATUS_SKIPPED = "skipped"

# Version stamp for the run execution summary artifact (R8.4, R8.5).
RUN_SUMMARY_SCHEMA_VERSION = 1


class ProfileError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def resolve_compute_profile(
    raw: str | None = None,
    environment: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environment is None else environment
    value = (raw if raw is not None else env.get("TZUDONG_COMPUTE_PROFILE", "")).strip()
    if not value:
        if env.get("GITHUB_ACTIONS") == "true":
            return "lite_gha"
        return "heavy_local"
    if value not in PIPELINE_COMPUTE_PROFILES:
        raise ProfileError("compute_profile_invalid")
    return value


def resolve_control_store(environment: Mapping[str, str] | None = None) -> str:
    env = os.environ if environment is None else environment
    value = (env.get("TZUDONG_PIPELINE_STORE") or "file").strip() or "file"
    if value not in CONTROL_STORES:
        raise ProfileError("control_store_invalid")
    return value


def resolve_execution_mode(
    raw: str | None = None,
    environment: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environment is None else environment
    value = (raw if raw is not None else env.get("TZUDONG_EXECUTION_MODE", "")).strip()
    if not value:
        live = env.get("TZUDONG_PIPELINE_LIVE", "").strip() in {"1", "true", "TRUE", "yes"}
        return "live" if live else "dry_run"
    if value not in PIPELINE_EXECUTION_MODES:
        raise ProfileError("execution_mode_invalid")
    return value


def default_data_sink(profile: str) -> str:
    if profile == "lite_gha":
        return ARTIFACT_SINK
    if profile == "heavy_local":
        return LOCAL_SINK
    raise ProfileError("compute_profile_invalid")


def mutating_steps_allowed(data_sink: str | None) -> bool:
    if data_sink is None:
        return True
    if data_sink == HOSTED_APPLY_SINK:
        raise ProfileError("hosted_apply_not_admitted")
    if data_sink not in PIPELINE_DATA_SINKS:
        raise ProfileError("data_sink_invalid")
    return data_sink == LOCAL_SINK


def skip_reason_for_step(
    spec: StepSpec,
    *,
    compute_profile: str,
    data_sink: str | None,
    skipped_or_failed: set[str],
    capabilities: set[str] | None = None,
) -> tuple[str, str] | None:
    """Return (kind, reason) when the step must not run."""

    admitted = capabilities
    if spec.skip_when_lite and compute_profile == "lite_gha":
        from backend.pipeline_control.graph import SKIP_HEAVY_REASON

        return ("optional", SKIP_HEAVY_REASON)
    if HEAVY_CAPABILITY in spec.capabilities and admitted is not None and "heavy_compute" not in admitted:
        from backend.pipeline_control.graph import SKIP_HEAVY_REASON

        return ("optional", SKIP_HEAVY_REASON)
    if spec.channel_capabilities and admitted is not None:
        missing = sorted(spec.channel_capabilities - set(admitted))
        if missing:
            return ("optional", f"target_lacks_{missing[0]}_capability")
    if MUTATING_CAPABILITY in spec.capabilities and not mutating_steps_allowed(data_sink):
        return ("downstream", "artifact_only_skips_mutating_step")
    if MUTATING_CAPABILITY in spec.capabilities and admitted is not None and "insert" not in admitted:
        return ("downstream", "target_lacks_insert_capability")
    if spec.skip_after and spec.skip_after in skipped_or_failed:
        return ("downstream", f"{spec.skip_after} skipped or failed")
    return None


def classify_skip_reason_code(decision: tuple[str, str]) -> str:
    """Normalize a ``skip_reason_for_step`` decision to a bounded fixed code.

    The human-readable reason strings (including the localized heavy-skip
    reason and the ``{step} skipped or failed`` downstream reason) are collapsed
    onto the closed ``SKIP_REASON_CODES`` set so a run summary records only fixed
    codes (R8.5). Unknown reasons raise rather than leaking a free-form string.
    """

    _kind, reason = decision
    if reason == SKIP_HEAVY_REASON:
        return SKIP_REASON_CODE_HEAVY
    if reason == SKIP_REASON_CODE_ARTIFACT_MUTATING:
        return SKIP_REASON_CODE_ARTIFACT_MUTATING
    if reason == SKIP_REASON_CODE_TARGET_LACKS_INSERT:
        return SKIP_REASON_CODE_TARGET_LACKS_INSERT
    if reason.startswith("target_lacks_") and reason.endswith("_capability"):
        return SKIP_REASON_CODE_TARGET_LACKS_CAPABILITY
    if reason.endswith(" skipped or failed"):
        return SKIP_REASON_CODE_UPSTREAM
    raise ProfileError("skip_reason_unknown")


def preflight_data_sink(
    *,
    compute_profile: str,
    environment: Mapping[str, str] | None = None,
) -> str:
    """Resolve the effective data sink before the first step runs (R8.3).

    A ``hosted_apply`` request — however it is supplied — fails closed with
    ``hosted_apply_not_admitted`` so no pipeline step starts. The resolved sink
    for an admitted run is always ``local_db`` or ``artifact_only``. This does
    not touch Local_Database or Hosted_Database state.
    """

    env = os.environ if environment is None else environment
    configured = (env.get(DATA_SINK_ENV) or "").strip()
    if not configured:
        if (env.get(DATA_ENV_ENV) or "").strip() == LOCAL_SINK:
            configured = LOCAL_SINK
        else:
            configured = default_data_sink(compute_profile)
    if configured == HOSTED_APPLY_SINK:
        raise ProfileError("hosted_apply_not_admitted")
    if configured not in PIPELINE_DATA_SINKS:
        raise ProfileError("data_sink_invalid")
    return configured


def compose_step_plan(
    *,
    compute_profile: str,
    data_sink: str | None,
    capabilities: set[str] | None = None,
    outcomes: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Compose the four step classes and assign each step one terminal status.

    Iterates the 18 ``STEP_SPECS`` in order and gives every step exactly one of
    ``succeeded``/``failed``/``skipped`` (R8.1). Deterministic skips come only
    from ``skip_reason_for_step`` and carry a bounded ``SKIP_REASON_CODES`` code.
    A run-candidate takes its status from ``outcomes`` (default ``succeeded``);
    a failed step is added to the blocked set so its skip_after dependents are
    marked ``skipped`` downstream (R8.10), and the final status becomes failed.

    A ``hosted_apply`` sink is refused up front so composition never partially
    runs an unadmitted hosted target.
    """

    if data_sink == HOSTED_APPLY_SINK:
        raise ProfileError("hosted_apply_not_admitted")

    results = outcomes or {}
    blocked: set[str] = set()
    steps: list[dict[str, object]] = []
    succeeded: list[str] = []
    failed: list[str] = []
    skipped: list[dict[str, str]] = []
    by_class: dict[str, list[str]] = {name: [] for name in STEP_CLASSES}
    any_failed = False

    for spec in STEP_SPECS:
        klass = step_class(spec.id)
        by_class[klass].append(spec.id)
        decision = skip_reason_for_step(
            spec,
            compute_profile=compute_profile,
            data_sink=data_sink,
            skipped_or_failed=blocked,
            capabilities=capabilities,
        )
        if decision is not None:
            kind, _reason = decision
            code = classify_skip_reason_code(decision)
            blocked.add(spec.id)
            skipped.append({"step": spec.id, "reasonCode": code})
            steps.append(
                {
                    "id": spec.id,
                    "stepClass": klass,
                    "status": STEP_STATUS_SKIPPED,
                    "skipKind": kind,
                    "reasonCode": code,
                }
            )
            continue
        outcome = results.get(spec.id, STEP_STATUS_SUCCEEDED)
        if outcome == STEP_STATUS_FAILED:
            blocked.add(spec.id)
            failed.append(spec.id)
            any_failed = True
            steps.append(
                {"id": spec.id, "stepClass": klass, "status": STEP_STATUS_FAILED}
            )
        else:
            succeeded.append(spec.id)
            steps.append(
                {"id": spec.id, "stepClass": klass, "status": STEP_STATUS_SUCCEEDED}
            )

    return {
        "computeProfile": compute_profile,
        "dataSink": data_sink,
        "steps": steps,
        "succeededSteps": succeeded,
        "failedSteps": failed,
        "skippedSteps": skipped,
        "byClass": by_class,
        "finalStatus": STEP_STATUS_FAILED if any_failed else STEP_STATUS_SUCCEEDED,
    }


def _non_negative_int(value: object, code: str) -> int:
    """Return ``value`` when it is a non-negative, non-bool integer, else fail closed.

    Hosted read/write request counts must be recorded as ``0``-or-greater
    integers (R8.4). A boolean, float, string, or negative value is not a valid
    request count and raises the bounded fixed code rather than silently
    coercing.
    """

    if type(value) is not int or value < 0:
        raise ProfileError(code)
    return value


def build_run_summary(
    *,
    run_id: str | None,
    compute_profile: str,
    data_sink: str | None,
    plan: Mapping[str, object] | None = None,
    hosted_read_request_count: int = 0,
    hosted_write_request_count: int = 0,
    capabilities: set[str] | None = None,
    outcomes: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Produce the run execution summary recorded at run end (R8.4, R8.5, R8.10).

    The summary carries the design C4 shape: ``runId``, ``computeProfile``,
    ``dataSink``, ``hostedReadRequestCount``, ``hostedWriteRequestCount``, the
    succeeded/failed/skipped step name lists (each skip carrying a bounded fixed
    ``reasonCode`` from ``SKIP_REASON_CODES``), and ``finalStatus``.

    When ``plan`` is not supplied it is composed from ``compose_step_plan`` so a
    required-step failure already propagates a downstream skip and a failed
    ``finalStatus`` (R8.10). ``confirmedWriteSteps`` lists only the *succeeded*
    mutating steps, so a failed step — including a failed insertion step — is
    excluded by construction and its Local_Database write is never recorded as
    confirmed (R8.10).

    Forbidden_Log_Field values are excluded structurally: the summary is built
    from a fixed key set of non-sensitive orchestration values, and the free
    ``run_id`` string is passed through the shared backend redaction boundary so
    a caller cannot smuggle a secret into the artifact (R8.4).
    """

    if plan is None:
        plan = compose_step_plan(
            compute_profile=compute_profile,
            data_sink=data_sink,
            capabilities=capabilities,
            outcomes=outcomes,
        )

    read_count = _non_negative_int(
        hosted_read_request_count, "hosted_request_count_invalid"
    )
    write_count = _non_negative_int(
        hosted_write_request_count, "hosted_request_count_invalid"
    )
    # R8.2 invariant, recorded in the summary: a ``local_db`` run keeps the whole
    # run's Hosted_Database write request count at zero. A non-zero write count
    # under ``local_db`` is a data-boundary breach, not a summary value.
    if data_sink == LOCAL_SINK and write_count != 0:
        raise ProfileError("supabase_data_boundary_rejected")

    succeeded = [str(step_id) for step_id in plan["succeededSteps"]]
    failed = [str(step_id) for step_id in plan["failedSteps"]]
    skipped: list[dict[str, str]] = []
    for entry in plan["skippedSteps"]:
        reason_code = str(entry["reasonCode"])
        if reason_code not in SKIP_REASON_CODES:
            raise ProfileError("skip_reason_unknown")
        skipped.append({"step": str(entry["step"]), "reasonCode": reason_code})

    # R8.10: only a succeeded mutating step has a confirmed Local_Database write.
    confirmed_write_steps = [
        step_id
        for step_id in succeeded
        if MUTATING_CAPABILITY in STEP_BY_ID[step_id].capabilities
    ]

    final_status = str(plan["finalStatus"])

    return {
        "schemaVersion": RUN_SUMMARY_SCHEMA_VERSION,
        "runId": redact_log_text(run_id) if run_id is not None else None,
        "computeProfile": compute_profile,
        "dataSink": data_sink,
        "hostedReadRequestCount": read_count,
        "hostedWriteRequestCount": write_count,
        "succeededSteps": succeeded,
        "failedSteps": failed,
        "skippedSteps": skipped,
        "confirmedWriteSteps": confirmed_write_steps,
        "finalStatus": final_status,
    }
