from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("sanitize-results.py")
SPEC = importlib.util.spec_from_file_location("sanitize_results", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot import evidence sanitizer")
SANITIZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SANITIZER)


class SanitizationTests(unittest.TestCase):
    def test_only_declared_private_path_is_replaced(self) -> None:
        value = {
            "expectedNodeModulesTarget": "/Users/example/private/node_modules",
            "metric": 42,
        }
        sanitized = SANITIZER.sanitize(
            value, ["/expectedNodeModulesTarget"]
        )
        self.assertEqual(
            sanitized["expectedNodeModulesTarget"], SANITIZER.PLACEHOLDER
        )
        self.assertEqual(sanitized["metric"], 42)
        self.assertEqual(SANITIZER.private_path_pointers(sanitized), [])

    def test_undeclared_private_path_fails_closed(self) -> None:
        value = {
            "expectedNodeModulesTarget": "/Users/example/private/node_modules",
            "extra": "/Users/example/unexpected",
        }
        with self.assertRaisesRegex(RuntimeError, "inventory differs"):
            SANITIZER.sanitize(value, ["/expectedNodeModulesTarget"])


if __name__ == "__main__":
    unittest.main()
