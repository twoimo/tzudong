#!/usr/bin/env python3
"""Retain only one canonical sanitized G037 control-map v3 observation."""

from __future__ import annotations

import json
import sys


SCHEMA = "g037-session-pooler-control-map-observation-v3"
MAX_INPUT_BYTES = 32_768
READY_KEYS = {
    "browserStorageInspected",
    "clipboardUsed",
    "connectDialogMatched",
    "controlClickCount",
    "controlNamesRetained",
    "controlShapeSha256",
    "controlSnapshotCount",
    "dashboardOpenCount",
    "databaseAuthenticationAttempted",
    "directConnectionEntryClicked",
    "directConnectionEntryMatched",
    "fixedCode",
    "locatorRefsRetained",
    "metadataValueRead",
    "networkHeadersInspected",
    "networkProbeExecuted",
    "organizationMetadataObserved",
    "passwordOrCredentialRead",
    "persistentStateChanged",
    "projectOverviewObserved",
    "rawControlTreeRetained",
    "schema",
    "screenshotCaptured",
    "sessionPoolerControlClicked",
    "sessionPoolerControlIdentified",
    "sqlExecuted",
    "stageCode",
    "status",
    "valueBearingNodeObserved",
}
DENIED_KEYS = {
    "controlClickCount",
    "controlSnapshotCount",
    "dashboardOpenCount",
    "fixedCode",
    "metadataValueRead",
    "persistentStateChanged",
    "schema",
    "stageCode",
    "status",
}
STAGE_CODES = {
    "before_open",
    "opening_dashboard",
    "waiting_first_control_scope",
    "reading_first_control_scope",
    "direct_control_cardinality_denied",
    "clicking_direct_control",
    "waiting_second_control_scope",
    "reading_second_control_scope",
    "session_control_cardinality_denied",
    "ready",
}


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        return 2
    candidates: list[dict[str, object]] = []
    for line in raw.splitlines():
        if not line.startswith(b"{") or not line.endswith(b"}"):
            continue
        try:
            value = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict) and value.get("schema") == SCHEMA:
            candidates.append(value)
    if len(candidates) != 1:
        return 2
    value = candidates[0]
    if value.get("status") == "ready":
        if set(value) != READY_KEYS or value.get("fixedCode") != "g037_session_pooler_control_map_v3_ready":
            return 2
    elif value.get("status") == "denied":
        if set(value) != DENIED_KEYS or value.get("fixedCode") != "g037_session_pooler_control_map_v3_denied":
            return 2
    else:
        return 2
    if value.get("stageCode") not in STAGE_CODES:
        return 2
    if value.get("metadataValueRead") is not False or value.get("persistentStateChanged") is not False:
        return 2
    sys.stdout.write(canonical(value) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
