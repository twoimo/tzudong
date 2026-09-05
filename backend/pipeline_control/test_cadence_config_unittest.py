"""Unit tests for the committed cadence configuration artifact.

Covers task 1.7 (Requirement 1.5): assert the committed
``backend/pipeline_control/cadence.schedule.json`` parses, carries both runner
windows (GHA_Runner and Mac_Runner) with ``kstStart``/``kstEnd``, encodes the
required top-level fields, and passes ``validate_cadence`` (ok=true).

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from backend.pipeline_control.schedule import (
    ERROR_GHA_CRON_MISMATCH,
    ERROR_MAC_AGENT_MISMATCH,
    ERROR_MAC_CALENDAR_MISMATCH,
    ERROR_SOURCE_CONFIG_INVALID,
    GHA_RUNNER,
    MAC_RUNNER,
    inspect_committed_cadence_sources,
    validate_cadence_sources,
    validate_cadence,
)

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "cadence.schedule.json"
)
_REPO_ROOT = Path(__file__).resolve().parents[2]
_WORKFLOW_PATH = _REPO_ROOT / ".github/workflows/daily-crawler.yml"
_INSTALLER_PATH = _REPO_ROOT / "backend/bin/install_mac_hosted_pipeline_launchd.sh"


class CadenceConfigSchemaTests(unittest.TestCase):
    def setUp(self) -> None:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as handle:
            self.raw = handle.read()

    def test_config_parses_as_json(self) -> None:
        config = json.loads(self.raw)
        self.assertIsInstance(config, dict)

    def test_required_top_level_fields(self) -> None:
        config = json.loads(self.raw)
        self.assertEqual(config.get("schemaVersion"), 1)
        self.assertEqual(config.get("timezone"), "Asia/Seoul")
        self.assertEqual(config.get("utcOffsetMinutes"), 540)
        self.assertEqual(config.get("minBufferMinutes"), 30)

    def test_carries_both_runner_windows_with_kst_bounds(self) -> None:
        config = json.loads(self.raw)
        windows = config.get("windows")
        self.assertIsInstance(windows, list)

        by_runner = {w.get("runner"): w for w in windows}
        self.assertIn(GHA_RUNNER, by_runner)
        self.assertIn(MAC_RUNNER, by_runner)

        for runner in (GHA_RUNNER, MAC_RUNNER):
            window = by_runner[runner]
            self.assertIsInstance(window.get("kstStart"), str, runner)
            self.assertIsInstance(window.get("kstEnd"), str, runner)

    def test_windows_pass_validate_cadence(self) -> None:
        config = json.loads(self.raw)
        result = validate_cadence(config)
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["errorCode"])
        self.assertEqual(result["conflictingWindows"], [])


class CommittedScheduleSourceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = json.loads(Path(_CONFIG_PATH).read_text(encoding="utf-8"))
        self.workflow = _WORKFLOW_PATH.read_text(encoding="utf-8")
        self.installer = _INSTALLER_PATH.read_text(encoding="utf-8")

    def test_committed_config_workflow_and_installer_agree(self) -> None:
        self.assertEqual(
            inspect_committed_cadence_sources(_REPO_ROOT),
            {"ok": True, "errorCode": None, "source": None},
        )

    def test_gha_cron_drift_uses_closed_mismatch_code(self) -> None:
        result = validate_cadence_sources(
            self.config,
            self.workflow.replace("cron: '0 19 * * *'", "cron: '5 19 * * *'"),
            self.installer,
        )
        self.assertEqual(
            result,
            {"ok": False, "errorCode": ERROR_GHA_CRON_MISMATCH, "source": "gha"},
        )

    def test_mac_calendar_drift_uses_closed_mismatch_code(self) -> None:
        result = validate_cadence_sources(
            self.config,
            self.workflow,
            self.installer.replace("<integer>15</integer>", "<integer>0</integer>"),
        )
        self.assertEqual(
            result,
            {
                "ok": False,
                "errorCode": ERROR_MAC_CALENDAR_MISMATCH,
                "source": "mac",
            },
        )

    def test_mac_agent_drift_uses_closed_mismatch_code(self) -> None:
        result = validate_cadence_sources(
            self.config,
            self.workflow,
            self.installer.replace(
                'LABEL="dev.tzudong.hosted-new-video"',
                'LABEL="dev.tzudong.wrong"',
            ),
        )
        self.assertEqual(
            result,
            {"ok": False, "errorCode": ERROR_MAC_AGENT_MISMATCH, "source": "mac"},
        )

    def test_configured_cron_must_derive_exact_kst_window_start(self) -> None:
        config = json.loads(json.dumps(self.config))
        config["windows"][0]["utcCron"] = "5 19 * * *"
        result = validate_cadence_sources(config, self.workflow, self.installer)
        self.assertEqual(
            result,
            {
                "ok": False,
                "errorCode": ERROR_SOURCE_CONFIG_INVALID,
                "source": "cadence",
            },
        )

    def test_duplicate_runner_identity_is_rejected(self) -> None:
        config = json.loads(json.dumps(self.config))
        config["windows"][1]["runner"] = GHA_RUNNER
        result = validate_cadence_sources(config, self.workflow, self.installer)
        self.assertEqual(result["errorCode"], ERROR_SOURCE_CONFIG_INVALID)
        self.assertEqual(result["source"], "cadence")


if __name__ == "__main__":
    unittest.main()
