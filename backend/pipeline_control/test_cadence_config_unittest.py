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

from backend.pipeline_control.schedule import (
    GHA_RUNNER,
    MAC_RUNNER,
    validate_cadence,
)

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "cadence.schedule.json"
)


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


if __name__ == "__main__":
    unittest.main()
