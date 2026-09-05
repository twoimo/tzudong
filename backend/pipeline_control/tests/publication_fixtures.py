"""Approved in-memory fixtures for publication unit/property tests only."""

from __future__ import annotations

from dataclasses import replace

from backend.pipeline_control.publish_worker import load_publication_set


ACTIVE_TEST_SCHEDULE = {
    "schemaVersion": 1,
    "timezone": "Asia/Seoul",
    "utcOffsetMinutes": 540,
    "cadence": "daily",
    "kstWindowStart": "07:30",
    "kstWindowEnd": "08:30",
    "utcCron": "30 22 * * *",
    "minBufferMinutesAfterHeavyLocal": 30,
    "approval": {
        "approverName": "test-operator",
        "approvedAt": "2026-09-01T00:00:00Z",
        "status": "approved",
    },
}

# This is deliberately test-only. It does not edit the committed unresolved
# ledger and is never imported by runtime code.
APPROVED_TEST_PUBLICATION_SET = replace(
    load_publication_set(),
    approval_status="approved",
    approval_reference_valid=True,
)
