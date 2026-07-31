from __future__ import annotations

import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
SHARED_SOURCE = BACKEND_ROOT / "storyboard-agent" / "src" / "_shared.py"
STYLE_SOURCE = BACKEND_ROOT / "storyboard-agent" / "STYLE.md"


class StoryboardAgentSharedSecurityTests(unittest.TestCase):
    def test_privileged_client_uses_canonical_server_only_credentials(self) -> None:
        source = SHARED_SOURCE.read_text(encoding="utf-8")

        self.assertIn("resolve_privileged_supabase_rest_credentials()", source)
        self.assertIn("credentials.service_role_key", source)
        self.assertNotIn("PUBLIC_SUPABASE_URL", source)
        self.assertNotIn("NEXT_PUBLIC_SUPABASE", source)
        self.assertNotIn("VITE_SUPABASE", source)

    def test_tool_log_records_field_names_without_values(self) -> None:
        source = SHARED_SOURCE.read_text(encoding="utf-8")
        style = STYLE_SOURCE.read_text(encoding="utf-8")

        self.assertIn("field_names = sorted", source)
        self.assertIn("field_count={len(kwargs)}", source)
        self.assertIn("os.O_NOFOLLOW", source)
        self.assertIn("0o600", source)
        self.assertNotIn("kwargs.items()", source)
        self.assertNotIn("{v!r}", source)
        self.assertIn("인자 값, 검색어, 식당명, 자막, 자격 증명, 개인정보 원문은 기록하지 않는다", style)


if __name__ == "__main__":
    unittest.main()
