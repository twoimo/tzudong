import importlib.util
import sys
import types
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "gemini_scrapling_fallback.py"


def load_module():
    fake_camoufox = types.ModuleType("camoufox")
    fake_sync_api = types.ModuleType("camoufox.sync_api")

    class FakeCamoufox:  # pragma: no cover - import shim only
        pass

    fake_sync_api.Camoufox = FakeCamoufox
    fake_camoufox.sync_api = fake_sync_api

    sys.modules.setdefault("camoufox", fake_camoufox)
    sys.modules.setdefault("camoufox.sync_api", fake_sync_api)

    spec = importlib.util.spec_from_file_location("gemini_scrapling_fallback", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


gemini_scrapling_fallback = load_module()


class FakeLocator:
    def __init__(self, count=0, visible=False):
        self._count = count
        self._visible = visible

    def count(self):
        return self._count

    @property
    def first(self):
        return self

    def is_visible(self):
        return self._visible


class FakePage:
    def __init__(self, url, locators=None):
        self.url = url
        self._locators = locators or {}

    def locator(self, query):
        for key, locator in self._locators.items():
            if key in query:
                return locator
        return FakeLocator()


class GeminiWebFallbackRegressionTests(unittest.TestCase):
    def test_is_logged_in_rejects_landing_page_login_cta_even_when_textbox_exists(self):
        page = FakePage(
            "https://gemini.google.com/app",
            {
                "ServiceLogin": FakeLocator(count=1, visible=True),
                'div.ql-editor[contenteditable="true"]': FakeLocator(count=1, visible=True),
            },
        )

        self.assertFalse(gemini_scrapling_fallback.is_logged_in(page))

    def test_is_logged_in_accepts_textbox_when_login_cta_missing(self):
        page = FakePage(
            "https://gemini.google.com/app",
            {
                'div.ql-editor[contenteditable="true"]': FakeLocator(count=1, visible=True),
            },
        )

        self.assertTrue(gemini_scrapling_fallback.is_logged_in(page))

    def test_detect_retryable_ui_problem_flags_logged_out_landing_page(self):
        page = FakePage(
            "https://gemini.google.com/app",
            {
                "ServiceLogin": FakeLocator(count=1, visible=True),
                "개인 AI 어시스턴트인 Gemini를 만나 보세요": FakeLocator(count=1, visible=True),
            },
        )

        self.assertEqual(
            "logged_out_landing_page",
            gemini_scrapling_fallback.detect_retryable_ui_problem(page),
        )

    def test_detect_retryable_ui_problem_flags_generic_issue_banner(self):
        page = FakePage(
            "https://gemini.google.com/app",
            {
                "text=문제가 발생했습니다": FakeLocator(count=1, visible=True),
            },
        )

        self.assertEqual(
            "gemini_issue_banner",
            gemini_scrapling_fallback.detect_retryable_ui_problem(page),
        )


if __name__ == "__main__":
    unittest.main()
