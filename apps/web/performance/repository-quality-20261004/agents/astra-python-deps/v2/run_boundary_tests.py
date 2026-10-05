"""Run only the affected boundary module; retain IDs, enums and counts."""
import contextlib
import json
import os
import platform
import sys
import time
import unittest
from pathlib import Path

ROOT = Path("/Users/twoimo/.codex/worktrees/python-dependency-quality-20261004/tzudong")
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

class Result(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.outcomes = []
    def _exc_info_to_string(self, err, test):
        return err[0].__name__
    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcomes.append({"test": test.id(), "outcome": "PASS"})
    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.outcomes.append({"test": test.id(), "outcome": "FAIL", "type": err[0].__name__})
    def addError(self, test, err):
        super().addError(test, err)
        self.outcomes.append({"test": test.id(), "outcome": "ERROR", "type": err[0].__name__})
    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcomes.append({"test": test.id(), "outcome": "SKIP", "reason": reason})

result = Result()
started = time.monotonic()
with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    suite = unittest.defaultTestLoader.loadTestsFromName("backend.pipeline.test_nodes_unittest")
    suite.run(result)
print(json.dumps({
    "target": "backend.pipeline.test_nodes_unittest",
    "python": platform.python_version(),
    "elapsed_seconds": round(time.monotonic() - started, 3),
    "network_policy": "MACOS_SANDBOX_DENY_NETWORK",
    "tests_run": result.testsRun,
    "passed": sum(item["outcome"] == "PASS" for item in result.outcomes),
    "failures": len(result.failures),
    "errors": len(result.errors),
    "skips": len(result.skipped),
    "outcomes": result.outcomes,
    "successful": result.wasSuccessful(),
}))
sys.exit(0 if result.wasSuccessful() else 1)
