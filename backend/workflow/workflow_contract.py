#!/usr/bin/env python3
"""Admin workflow pipeline contract constants and helpers."""

from __future__ import annotations

from typing import Any, Dict

CANONICAL_STEPS = [
    {"canonical_step_no": 1, "canonical_step_key": "url_collection", "script_step_label": "Step 1"},
    {"canonical_step_no": 2, "canonical_step_key": "metadata_collection", "script_step_label": "Step 2"},
    {"canonical_step_no": 3, "canonical_step_key": "meta_sync_orphan_cleanup", "script_step_label": "Step 2.1+2.5"},
    {"canonical_step_no": 4, "canonical_step_key": "transcript_collection", "script_step_label": "Step 3"},
    {"canonical_step_no": 5, "canonical_step_key": "context_generation", "script_step_label": "Step 3.1"},
    {"canonical_step_no": 6, "canonical_step_key": "frames_heatmap", "script_step_label": "Step 4"},
    {"canonical_step_no": 7, "canonical_step_key": "transcript_enrichment", "script_step_label": "Step 6.1"},
    {"canonical_step_no": 8, "canonical_step_key": "gemini_data_analysis", "script_step_label": "Step 7"},
    {"canonical_step_no": 9, "canonical_step_key": "target_selection", "script_step_label": "Step 08"},
    {"canonical_step_no": 10, "canonical_step_key": "rule_evaluation", "script_step_label": "Step 09"},
    {"canonical_step_no": 11, "canonical_step_key": "laaj_evaluation", "script_step_label": "Step 10"},
    {"canonical_step_no": 12, "canonical_step_key": "publish_results", "script_step_label": "Step 11+12"},
]

STEP_KEY_BY_NO = {step["canonical_step_no"]: step["canonical_step_key"] for step in CANONICAL_STEPS}
STEP_LABEL_BY_NO = {step["canonical_step_no"]: step["script_step_label"] for step in CANONICAL_STEPS}

VALID_STEP_STATUSES = {"queued", "running", "success", "failed", "timeout", "partial", "skipped"}
VALID_TRIGGER_SOURCES = {"schedule", "manual_admin"}
VALID_CORRELATION_STATES = {
    "pending_dispatch",
    "dispatched_unmatched",
    "matched",
    "reconciled_timeout",
    "reconciled_error",
    "completed",
}

ROW_DELTA_TEMPLATE: Dict[int, Dict[str, Any]] = {
    1: {"new_urls": 0, "deleted_urls": 0, "total_urls": 0},
    2: {"meta_updated": 0, "meta_skipped": 0},
    3: {"meta_upserts": 0, "orphans_deleted": 0},
    4: {"transcript_success": 0, "transcript_failed": 0, "transcript_skipped": 0},
    5: {"context_generated": 0, "context_skipped": 0},
    6: {"frames_extracted": 0, "heatmaps_generated": 0},
    7: {"documents_enriched": 0, "peak_docs": 0},
    8: {
        "description_table": "map_url_crawling",
        "description_row_delta": 0,
        "description_status": "skipped",
        "gemini_calls": 0,
        "gemini_success": 0,
        "gemini_fail": 0,
    },
    9: {"selected_count": 0, "not_selected_count": 0},
    10: {"rule_success": 0, "rule_fail": 0},
    11: {"laaj_success": 0, "laaj_fail": 0},
    12: {
        "target_table": "restaurants",
        "db_row_delta": 0,
        "db_inserted": 0,
        "db_skipped": 0,
        "db_failed": 0,
        "transform_rows": 0,
    },
}


def merge_row_delta(step_no: int, row_delta: Dict[str, Any] | None) -> Dict[str, Any]:
    base = dict(ROW_DELTA_TEMPLATE.get(step_no, {}))
    if row_delta:
        base.update(row_delta)
    return base
