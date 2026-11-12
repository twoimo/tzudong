"""Run the repository's real Security scope policy for source-contract paths."""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterable
from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[3]
_CLASSIFY_SECURITY_PATHS = """
import { readFileSync } from 'node:fs';
import { classifyPaths } from './.github/scripts/classify-security-scope.mjs';
const paths = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(paths.map((path) => classifyPaths([path]))));
"""


def assert_security_scope(test_case: TestCase, paths: Iterable[str]) -> None:
    """Require each path to select Security through the retained path policy."""
    selected_paths = list(paths)
    test_case.assertGreater(len(selected_paths), 0, "Security coverage paths are empty")
    test_case.assertLessEqual(len(selected_paths), 1000, "Security coverage paths exceed the test bound")
    for path in selected_paths:
        test_case.assertIsInstance(path, str)
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", _CLASSIFY_SECURITY_PATHS],
            cwd=ROOT,
            input=json.dumps(selected_paths),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        test_case.fail("Security scope classifier could not complete")
    test_case.assertEqual(result.returncode, 0, "Security scope classifier failed")
    try:
        decisions = json.loads(result.stdout)
    except json.JSONDecodeError:
        test_case.fail("Security scope classifier returned invalid JSON")
    test_case.assertIsInstance(decisions, list)
    test_case.assertEqual(len(decisions), len(selected_paths))
    for path, decision in zip(selected_paths, decisions):
        with test_case.subTest(security_path=path):
            test_case.assertIsInstance(decision, dict)
            test_case.assertIs(decision.get("security"), True)
            test_case.assertIs(decision.get("fatal"), False)
            # An unknown-input fallback must not hide a removed coverage rule.
            test_case.assertEqual(decision.get("reason"), "SECURITY_INPUT_CHANGED")
