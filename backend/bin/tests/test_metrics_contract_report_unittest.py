#!/usr/bin/env python3
"""Unit tests for the metric-contract checker ``backend/bin/metrics_contract_report.py``
(Task 20; Requirement 12.5, 12.6, 12.14, 12.15).

These verify the observable branches: the full 13-metric catalog is required as
dashboard-query targets, any absence fails closed with
``metrics_contract_incomplete`` and the sorted missing list, broker-dependent
metrics are live only when the broker is started, and a not-started broker /
log-search component degrades its panels to no-data while the overall contract
stays successful — recording a not-started reason code. Following the
``backend/bin`` convention (no ``__init__.py``), the module is loaded by path.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

# backend/bin/tests/test_*.py -> tests -> bin -> backend -> <repo root>
_ROOT = Path(__file__).resolve().parents[3]
_MODULE_PATH = _ROOT / "backend" / "bin" / "metrics_contract_report.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mcr = _load("metrics_contract_report", _MODULE_PATH)

_FULL = list(mcr.CATALOG_METRICS)


class CatalogShapeTests(unittest.TestCase):
    def test_catalog_has_thirteen_metrics(self):
        self.assertEqual(len(mcr.CATALOG_METRICS), 13)

    def test_catalog_is_four_counters_one_extra_eight_gauges(self):
        report = mcr.build_report(_FULL)
        self.assertEqual(report["counterCount"], 5)  # 4 frozen + 1 extra
        self.assertEqual(report["gaugeCount"], 8)
        self.assertEqual(report["catalogMetricCount"], 13)

    def test_catalog_matches_frozen_json_file(self):
        payload = json.loads(
            (_ROOT / "backend" / "pipeline-control" / "metrics.v1.json").read_text(
                encoding="utf-8"
            )
        )
        expected = (
            payload["metrics"] + payload["extraCounters"] + payload["gauges"]
        )
        self.assertEqual(list(mcr.CATALOG_METRICS), expected)

    def test_broker_dependent_gauge_names_exist_in_catalog(self):
        for name in mcr.BROKER_DEPENDENT_METRICS:
            self.assertIn(name, mcr.CATALOG_METRICS, name)


class ContractCompletenessTests(unittest.TestCase):
    def test_full_catalog_broker_up_is_all_data(self):
        report = mcr.check_metrics_contract(
            _FULL, broker_started=True, log_search_started=True
        )
        self.assertTrue(report["ok"])
        self.assertIsNone(report["errorCode"])
        self.assertEqual(report["missing"], [])
        self.assertEqual(report["noDataPanels"], [])
        self.assertEqual(report["notStartedComponents"], [])
        self.assertTrue(all(p["state"] == "data" for p in report["panels"]))
        self.assertEqual(len(report["panels"]), 13)

    def test_single_missing_metric_fails_closed(self):
        exposed = [m for m in _FULL if m != "tzudong_pipeline_active_jobs"]
        report = mcr.check_metrics_contract(
            exposed, broker_started=True, log_search_started=True
        )
        self.assertFalse(report["ok"])
        self.assertEqual(report["errorCode"], mcr.METRICS_CONTRACT_INCOMPLETE)
        self.assertEqual(report["missing"], ["tzudong_pipeline_active_jobs"])
        # No per-panel state is asserted on the incomplete branch.
        self.assertEqual(report["panels"], [])

    def test_missing_list_is_sorted_and_complete(self):
        exposed = _FULL[:5]
        report = mcr.check_metrics_contract(exposed)
        expected = sorted(set(_FULL) - set(exposed))
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], expected)

    def test_empty_exposed_reports_all_missing(self):
        report = mcr.check_metrics_contract([])
        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"], sorted(_FULL))

    def test_error_code_is_in_closed_set(self):
        report = mcr.check_metrics_contract([])
        self.assertIn(report["errorCode"], mcr.CONTRACT_RESULT_CODES)
        report_ok = mcr.check_metrics_contract(_FULL, broker_started=True)
        self.assertIn(report_ok["errorCode"], mcr.CONTRACT_RESULT_CODES)

    def test_non_string_exposed_entries_ignored(self):
        exposed = _FULL + [None, 123, {"x": 1}]
        report = mcr.check_metrics_contract(
            exposed, broker_started=True, log_search_started=True
        )
        self.assertTrue(report["ok"])


class OptionalComponentNoDataTests(unittest.TestCase):
    def test_broker_down_marks_broker_panels_no_data_but_succeeds(self):
        report = mcr.check_metrics_contract(
            _FULL, broker_started=False, log_search_started=True
        )
        # Contract still succeeds: the rest stay successful (12.15).
        self.assertTrue(report["ok"])
        self.assertIsNone(report["errorCode"])
        self.assertEqual(
            report["noDataPanels"], sorted(mcr.BROKER_DEPENDENT_METRICS)
        )
        # Not-started reason code recorded for the broker component.
        self.assertEqual(
            report["notStartedComponents"],
            [
                {
                    "component": mcr.BROKER_COMPONENT,
                    "reasonCode": mcr.OPTIONAL_COMPONENT_NOT_STARTED,
                }
            ],
        )

    def test_log_search_down_marks_es_panel_no_data(self):
        report = mcr.check_metrics_contract(
            _FULL, broker_started=True, log_search_started=False
        )
        self.assertTrue(report["ok"])
        self.assertEqual(report["noDataPanels"], ["tzudong_pipeline_es_rows_per_sec"])
        self.assertEqual(
            report["notStartedComponents"],
            [
                {
                    "component": mcr.LOG_SEARCH_COMPONENT,
                    "reasonCode": mcr.OPTIONAL_COMPONENT_NOT_STARTED,
                }
            ],
        )

    def test_both_optional_components_down(self):
        report = mcr.check_metrics_contract(
            _FULL, broker_started=False, log_search_started=False
        )
        self.assertTrue(report["ok"])
        expected_no_data = sorted(
            list(mcr.BROKER_DEPENDENT_METRICS) + list(mcr.LOG_SEARCH_DEPENDENT_METRICS)
        )
        self.assertEqual(report["noDataPanels"], expected_no_data)
        self.assertEqual(
            [c["component"] for c in report["notStartedComponents"]],
            [mcr.BROKER_COMPONENT, mcr.LOG_SEARCH_COMPONENT],
        )

    def test_broker_metrics_live_only_when_broker_started(self):
        up = mcr.check_metrics_contract(_FULL, broker_started=True)
        broker_states_up = {
            p["name"]: p["state"]
            for p in up["panels"]
            if p["name"] in mcr.BROKER_DEPENDENT_METRICS
        }
        self.assertTrue(all(s == "data" for s in broker_states_up.values()))

        down = mcr.check_metrics_contract(_FULL, broker_started=False)
        broker_states_down = {
            p["name"]: p["state"]
            for p in down["panels"]
            if p["name"] in mcr.BROKER_DEPENDENT_METRICS
        }
        self.assertTrue(all(s == "no_data" for s in broker_states_down.values()))

    def test_dependency_component_mapping(self):
        self.assertEqual(
            mcr.dependency_component("tzudong_pipeline_kafka_lag"),
            mcr.BROKER_COMPONENT,
        )
        self.assertEqual(
            mcr.dependency_component("tzudong_pipeline_es_rows_per_sec"),
            mcr.LOG_SEARCH_COMPONENT,
        )
        self.assertIsNone(
            mcr.dependency_component("tzudong_pipeline_runs_enqueued_total")
        )

    def test_missing_broker_metric_still_fails_even_if_broker_down(self):
        # A broker-dependent target that is simply absent from the dashboard is
        # a contract defect, distinct from a no-data panel.
        exposed = [m for m in _FULL if m != "tzudong_pipeline_kafka_lag"]
        report = mcr.check_metrics_contract(exposed, broker_started=False)
        self.assertFalse(report["ok"])
        self.assertEqual(report["errorCode"], mcr.METRICS_CONTRACT_INCOMPLETE)
        self.assertEqual(report["missing"], ["tzudong_pipeline_kafka_lag"])


class CliTests(unittest.TestCase):
    def test_main_writes_artifact_and_returns_zero_on_full_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "report.json"
            code = mcr.main(["--broker-started", "--log-search-started",
                             "--artifact", str(artifact)])
            self.assertEqual(code, 0)
            written = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertTrue(written["ok"])
            self.assertEqual(written["catalogMetricCount"], 13)

    def test_main_returns_one_on_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            exposed_path = Path(tmp) / "exposed.json"
            exposed_path.write_text(json.dumps(_FULL[:3]), encoding="utf-8")
            artifact = Path(tmp) / "report.json"
            code = mcr.main(["--exposed", str(exposed_path),
                             "--artifact", str(artifact)])
            self.assertEqual(code, 1)
            written = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertFalse(written["ok"])
            self.assertEqual(written["errorCode"], mcr.METRICS_CONTRACT_INCOMPLETE)

    def test_main_reads_object_form_exposed_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            exposed_path = Path(tmp) / "exposed.json"
            exposed_path.write_text(
                json.dumps({"exposedMetrics": _FULL}), encoding="utf-8"
            )
            artifact = Path(tmp) / "report.json"
            code = mcr.main(["--exposed", str(exposed_path),
                             "--broker-started", "--log-search-started",
                             "--artifact", str(artifact)])
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
