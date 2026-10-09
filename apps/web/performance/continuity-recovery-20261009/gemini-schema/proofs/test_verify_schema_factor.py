import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("verify_schema_factor.py")
ROOT = next(parent for parent in SCRIPT.parents if (parent / "backend/knowledge_graph/longform_analysis.py").is_file())


class CheckoutBoundaryTests(unittest.TestCase):
    def run_verifier(self, *args):
        env = dict(os.environ)
        env.pop("TZUDONG_CLAUDE_VIDEO_CHECKOUT", None)
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_missing_checkout_is_bounded_rejection(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout), {"status": "rejected", "code": "WATCH_CHECKOUT_REQUIRED"})

    def test_unverified_checkout_is_bounded_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = self.run_verifier("--watch-checkout", temporary)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout), {"status": "rejected", "code": "WATCH_CHECKOUT_UNAVAILABLE"})

    def test_source_has_no_default_checkout_fallback(self):
        source = SCRIPT.read_text()
        self.assertNotIn("analysis.DEFAULT_CHECKOUT", source)
        self.assertIn("TZUDONG_CLAUDE_VIDEO_CHECKOUT", source)
        self.assertIn("analysis.verify_checkout(config)", source)


if __name__ == "__main__":
    unittest.main()

