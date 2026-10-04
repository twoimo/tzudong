#!/usr/bin/env python3
"""Run real process-boundary tests without retaining child output or env values."""

from __future__ import annotations

import contextlib
import json
import os
import platform
from pathlib import Path
import sys
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]


class BoundedResult(unittest.TestResult):
    def __init__(self) -> None:
        super().__init__()
        self.outcomes: list[dict[str, str]] = []

    def _exc_info_to_string(self, err, test):
        return err[0].__name__

    def addSuccess(self, test) -> None:
        super().addSuccess(test)
        self.outcomes.append({"test": test.id(), "outcome": "PASS"})

    def addFailure(self, test, err) -> None:
        super().addFailure(test, err)
        self.outcomes.append({"test": test.id(), "outcome": "FAIL", "type": err[0].__name__})

    def addError(self, test, err) -> None:
        super().addError(test, err)
        self.outcomes.append({"test": test.id(), "outcome": "ERROR", "type": err[0].__name__})

    def addSkip(self, test, reason) -> None:
        super().addSkip(test, "platform-specific test")
        self.outcomes.append({"test": test.id(), "outcome": "SKIP"})


def main() -> int:
    sys.path.insert(0, str(ROOT))
    os.chdir(ROOT)
    result = BoundedResult()
    started = time.monotonic()
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        unittest.defaultTestLoader.loadTestsFromName("backend.pipeline.test_nodes_unittest").run(result)
    print(json.dumps({
        "schemaVersion": 1,
        "target": "backend.pipeline.test_nodes_unittest",
        "python": platform.python_version(),
        "platform": sys.platform,
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "run": result.testsRun,
        "passed": sum(x["outcome"] == "PASS" for x in result.outcomes),
        "failures": len(result.failures),
        "errors": len(result.errors),
        "skips": len(result.skipped),
        "outcomes": result.outcomes,
        "successful": result.wasSuccessful(),
    }))
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
