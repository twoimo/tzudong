"""Compute, control-store, data-sink, and execution-mode policy."""

from __future__ import annotations

import os
from typing import Mapping

from backend.pipeline_control.graph import HEAVY_CAPABILITY, MUTATING_CAPABILITY, StepSpec
from backend.utils.supabase_rest import (
    PIPELINE_COMPUTE_PROFILES,
    PIPELINE_DATA_SINKS,
    PIPELINE_EXECUTION_MODES,
)

CONTROL_STORES = frozenset({"file", "postgres"})
HOSTED_APPLY_SINK = "hosted_apply"
ARTIFACT_SINK = "artifact_only"
LOCAL_SINK = "local_db"


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
