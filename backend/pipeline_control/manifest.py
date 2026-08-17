"""Compatible current-summary.json writer and N=3 parity gate.

Deletion of run_daily.sh is refused until three consecutive control-plane
manifests match the last .sh baseline on policy/smart-skip fields.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.utils.run_daily_helpers import (
    validate_summary_manifest_payload,
    write_json,
)

REQUIRED_MATCH_COUNT = 3
POLICY_COMPARE_FIELDS = (
    "finalStatus",
    "finalExitCode",
    "failedRequiredSteps",
    "optionalSkips",
    "downstreamSkips",
    "noWorkShortCircuit",
    "policyMode",
)


def policy_projection(manifest: dict[str, Any]) -> dict[str, Any]:
    steps = []
    for event in manifest.get("stepEvents") or []:
        if not isinstance(event, dict):
            continue
        steps.append(
            {
                "name": event.get("name"),
                "status": event.get("status"),
                "reason": event.get("reason"),
                "upstreamStep": event.get("upstreamStep"),
            }
        )
    return {
        field: manifest.get(field) for field in POLICY_COMPARE_FIELDS
    } | {"stepEvents": steps}


def write_compatible_summary(path: Path, payload: dict[str, Any]) -> Path:
    validate_summary_manifest_payload(payload)
    write_json(path, payload)
    return path


def compare_policy(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    validate_summary_manifest_payload(baseline)
    validate_summary_manifest_payload(candidate)
    left = policy_projection(baseline)
    right = policy_projection(candidate)
    matched = left == right
    return {"matched": matched, "baseline": left, "candidate": right}


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest must be an object")
    return payload


def record_parity_attempt(
    ledger_path: Path,
    *,
    matched: bool,
) -> dict[str, Any]:
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    else:
        ledger = {"schemaVersion": 1, "consecutiveMatches": 0, "attempts": []}
    consecutive = ledger.get("consecutiveMatches", 0) + 1 if matched else 0
    ledger["consecutiveMatches"] = consecutive
    ledger["attempts"].append({"matched": matched})
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return ledger


def deletion_allowed(ledger: dict[str, Any]) -> bool:
    return int(ledger.get("consecutiveMatches") or 0) >= REQUIRED_MATCH_COUNT


def refuse_shim_deletion(ledger: dict[str, Any]) -> None:
    if not deletion_allowed(ledger):
        raise PermissionError("shim_deletion_blocked_until_n3_parity")
