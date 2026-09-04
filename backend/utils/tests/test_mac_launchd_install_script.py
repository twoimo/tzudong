import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INSTALL = ROOT / "backend" / "bin" / "install_mac_hosted_pipeline_launchd.sh"


class MacLaunchdInstallScriptTests(unittest.TestCase):
    def test_launchd_program_is_bash_wrapper_outside_documents(self) -> None:
        text = INSTALL.read_text(encoding="utf-8")
        self.assertIn('WRAPPER="$SUPPORT/run-hosted-new-video.sh"', text)
        self.assertIn("<string>/bin/bash</string>", text)
        self.assertIn("Library/Logs/tzudong", text)
        self.assertIn("TZUDONG_REPO_ROOT", text)
        self.assertIn("<key>Hour</key>\n    <integer>5</integer>", text)
        self.assertIn("<key>Minute</key>\n    <integer>15</integer>", text)
        self.assertIn("schedule=05:15", text)
        self.assertNotIn(
            "<string>${PYTHON}</string>",
            text,
        )
        self.assertNotIn(
            "${REPO_ROOT}/backend/log/cron/mac-hosted-new-video.err.log",
            text,
        )

    def test_launchd_uses_one_calendar_event_without_replay_interval(self) -> None:
        text = INSTALL.read_text(encoding="utf-8")
        self.assertEqual(text.count("<key>StartCalendarInterval</key>"), 1)
        self.assertNotIn("<key>StartInterval</key>", text)
        self.assertNotIn("<key>KeepAlive</key>", text)
        self.assertNotRegex(text, r"(?m)^\s*(?:while|until)\s+")


if __name__ == "__main__":
    unittest.main()
