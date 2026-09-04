import os
import shlex
import subprocess
import tempfile
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

    def test_interpreter_selection_prefers_explicit_then_repository_venv(self) -> None:
        text = INSTALL.read_text()
        selection = text[text.index('if [[ -n "${PYTHON_CMD:-}"') : text.index('mkdir -p')]
        # Execute only selection/preflight; never touch a LaunchAgent or HOME.
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            venv = root / ".venv/bin/python"
            venv.parent.mkdir(parents=True)
            venv.write_text("#!/bin/sh\nexit 0\n")
            venv.chmod(0o700)
            explicit = root / "explicit-python"
            explicit.write_text("#!/bin/sh\nexit 0\n")
            explicit.chmod(0o700)
            env = dict(os.environ)
            env.pop("PYTHON_CMD", None)
            script = 'REPO_ROOT=' + shlex.quote(str(root)) + '\n' + selection + '\nprintf "%s" "$PYTHON"'
            default = subprocess.run(["/bin/bash", "-eu", "-c", script], env=env, capture_output=True, text=True)
            self.assertEqual(default.returncode, 0)
            self.assertEqual(default.stdout, str(venv))
            chosen = subprocess.run(["/bin/bash", "-eu", "-c", script], env={**env, "PYTHON_CMD": str(explicit)}, capture_output=True, text=True)
            self.assertEqual(chosen.stdout, str(explicit))
            invalid = subprocess.run(["/bin/bash", "-eu", "-c", script], env={**env, "PYTHON_CMD": "/usr/bin/false"}, capture_output=True, text=True)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertEqual(invalid.stdout, "")
            self.assertIn("python_runtime_unavailable", invalid.stderr)

    def test_launchd_uses_one_calendar_event_without_replay_interval(self) -> None:
        text = INSTALL.read_text(encoding="utf-8")
        self.assertEqual(text.count("<key>StartCalendarInterval</key>"), 1)
        self.assertNotIn("<key>StartInterval</key>", text)
        self.assertNotIn("<key>KeepAlive</key>", text)
        self.assertNotRegex(text, r"(?m)^\s*(?:while|until)\s+")


if __name__ == "__main__":
    unittest.main()
