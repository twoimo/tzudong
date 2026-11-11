"""The GoTrue renderer must leave no template placeholders behind.

The gotrue image ships `text/template` migrations; a replay that skips rendering
fails on the first `{{ index .Options "Namespace" }}`. This test pins the
rendering rule, including the spelling variants GoTrue uses across files.
"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/render_gotrue_migrations.py"


def _load():
    spec = importlib.util.spec_from_file_location("render_gotrue_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


render = _load()


class RenderGotrueMigrationsTests(unittest.TestCase):
    def test_both_spellings_are_replaced(self) -> None:
        source = 'CREATE SCHEMA IF NOT EXISTS {{ index .Options "Namespace" }};\nSET search_path = {{index .Options "Namespace" }};\n'
        rendered = render.render(source, "auth")
        self.assertEqual(rendered.count("auth"), 2)
        self.assertIsNone(render.PLACEHOLDER.search(rendered))

    def test_a_foreign_placeholder_is_reported(self) -> None:
        source = "SELECT '{{ .Something }}';\n"
        self.assertIsNotNone(render.PLACEHOLDER.search(render.render(source, "auth")))


if __name__ == "__main__":
    unittest.main()
