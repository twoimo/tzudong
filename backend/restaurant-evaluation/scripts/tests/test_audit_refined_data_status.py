from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "audit_refined_data_status.py"
spec = importlib.util.spec_from_file_location("audit_refined_data_status", SCRIPT)
audit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(audit)


def ready_record(**overrides):
    row = {
        "trace_id": "ready",
        "status": "pending",
        "geocoding_success": True,
        "is_missing": False,
        "is_notSelected": False,
        "evaluation_results": {
            "visit_authenticity": {"eval_value": 1},
            "rb_inference_score": {"eval_value": 1},
            "rb_grounding_TF": {"eval_value": True},
            "review_faithfulness_score": {"eval_value": 1},
            "category_validity_TF": {"eval_value": True},
            "category_TF": {"eval_value": True},
        },
    }
    row.update(overrides)
    return row


class AuditRefinedDataStatusTest(unittest.TestCase):
    def test_local_counts_separate_overlapping_buckets(self):
        records = [
            ready_record(trace_id="ready"),
            ready_record(trace_id="geo", geocoding_success=False, evaluation_results=None),
            ready_record(trace_id="missing", geocoding_success=False, is_missing=True, evaluation_results=None),
            ready_record(trace_id="not-selected", geocoding_success=False, is_notSelected=True, evaluation_results=None),
            ready_record(trace_id="approved", status="approved"),
            ready_record(trace_id="deleted", status="deleted"),
        ]

        counts = audit.local_counts(records)

        self.assertEqual(6, counts["total"])
        self.assertEqual(3, counts["geocoding_failed"])
        self.assertEqual(1, counts["pure_geocoding_failed"])
        self.assertEqual(1, counts["missing"])
        self.assertEqual(1, counts["not_selected"])
        self.assertEqual(1, counts["ready_for_approval"])
        self.assertEqual(1, counts["approved"])
        self.assertEqual(1, counts["deleted"])

    def test_db_overlay_subtracts_admin_locked_queue_items(self):
        records = [
            ready_record(trace_id="ready"),
            ready_record(trace_id="geo", geocoding_success=False, evaluation_results=None),
            ready_record(trace_id="missing", geocoding_success=False, is_missing=True, evaluation_results=None),
        ]
        db_rows = {
            "ready": {"trace_id": "ready", "status": "approved", "updated_by_admin_id": "admin"},
            "geo": {"trace_id": "geo", "status": "pending", "updated_by_admin_id": "admin"},
            "missing": {"trace_id": "missing", "status": "pending", "updated_by_admin_id": None},
        }

        comparison = audit.compare_with_db(records, db_rows)

        self.assertEqual(3, comparison["db_matched_by_trace_id"])
        self.assertEqual(2, comparison["admin_locked_rows"])
        self.assertEqual(0, comparison["actionable_queue_counts_after_db_lock"]["02_approval_ready"])
        self.assertEqual(0, comparison["actionable_queue_counts_after_db_lock"]["01_pure_geocoding_failures"])
        self.assertEqual(1, comparison["actionable_queue_counts_after_db_lock"]["03_missing_recovery"])
        self.assertEqual(["missing"], comparison["actionable_trace_ids_by_queue"]["03_missing_recovery"])
        self.assertEqual([], comparison["db_missing_local_records"])

    def test_db_overlay_writes_actionable_and_missing_files(self):
        records = [
            ready_record(trace_id="ready"),
            ready_record(trace_id="geo", geocoding_success=False, evaluation_results=None),
            ready_record(trace_id="no-db", geocoding_success=False, evaluation_results=None),
        ]
        queues = audit.queue_records(records)
        comparison = audit.compare_with_db(
            records,
            {
                "ready": {"trace_id": "ready", "status": "approved", "updated_by_admin_id": "admin"},
                "geo": {"trace_id": "geo", "status": "pending", "updated_by_admin_id": None},
            },
        )

        with tempfile.TemporaryDirectory() as tmp:
            report_dir = Path(tmp)
            audit.write_supabase_overlay_outputs(report_dir, queues, comparison)
            actionable_geo = report_dir / "actionable_after_db_lock" / "01_pure_geocoding_failures.jsonl"
            missing = report_dir / "supabase_missing_local_records.jsonl"

            actionable_rows = [json.loads(line) for line in actionable_geo.read_text().splitlines()]
            missing_rows = [json.loads(line) for line in missing.read_text().splitlines()]

        self.assertEqual(["geo", "no-db"], [row["trace_id"] for row in actionable_rows])
        self.assertEqual(["no-db"], [row["trace_id"] for row in missing_rows])


if __name__ == "__main__":
    unittest.main()
