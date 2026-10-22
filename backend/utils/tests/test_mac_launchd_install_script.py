import os
import plistlib
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.utils.runtime_paths import load_backend_env

ROOT = Path(__file__).resolve().parents[3]
INSTALL = ROOT / "backend" / "bin" / "install_mac_hosted_pipeline_launchd.sh"


class MacLaunchdInstallScriptTests(unittest.TestCase):
    def test_generated_wrapper_uses_gemini_path_and_explicit_review_opt_in(self) -> None:
        for opt_in in (None, "1"):
            with self.subTest(opt_in=opt_in), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                checkout = root / "checkout with spaces"
                script = checkout / "backend/bin/install_mac_hosted_pipeline_launchd.sh"
                script.parent.mkdir(parents=True)
                script.write_bytes(INSTALL.read_bytes())
                (checkout / "backend/.env").write_text("TZUDONG_LAAJ_PROVIDER=opencode-go\n")
                home = root / "home with spaces"
                fake_bin = root / "fake bin"
                fake_bin.mkdir()
                node = fake_bin / "node"
                node.write_text("#!/bin/sh\nexit 0\n")
                node.chmod(0o700)
                python = fake_bin / "python"
                python.write_text(
                    '#!/bin/sh\n'
                    'if [ "$1" = "-c" ]; then exit 0; fi\n'
                    'printf "provider=%s\\n" "${TZUDONG_LAAJ_PROVIDER-absent}" > "$TEST_ARGS_FILE"\n'
                    'printf "%s\\n" "$@" >> "$TEST_ARGS_FILE"\n'
                )
                python.chmod(0o700)
                launchctl = fake_bin / "launchctl"
                launchctl.write_text('#!/bin/sh\nprintf "%s\\n" "$@" >> "$TEST_LAUNCHCTL_FILE"\n')
                launchctl.chmod(0o700)
                args_file = root / "runner-args.txt"
                launchctl_file = root / "launchctl-args.txt"
                env = {**os.environ, "HOME": str(home), "NODE_CMD": str(node),
                       "PYTHON_CMD": str(python), "PATH": str(fake_bin) + ":" + os.environ["PATH"],
                       "TZUDONG_LAAJ_PROVIDER": "opencode-go",
                       "TEST_ARGS_FILE": str(args_file), "TEST_LAUNCHCTL_FILE": str(launchctl_file)}
                env.pop("TZUDONG_MAC_REVIEW_AUTOMATION", None)
                if opt_in is not None:
                    env["TZUDONG_MAC_REVIEW_AUTOMATION"] = opt_in
                installed = subprocess.run(["/bin/bash", str(script)], env=env,
                                           capture_output=True, text=True, timeout=10)
                self.assertEqual(installed.returncode, 0, installed.stderr)
                self.assertIn("bootstrap", launchctl_file.read_text())
                wrapper = home / "Library/Application Support/tzudong/run-hosted-new-video.sh"
                wrapper_text = wrapper.read_text()
                self.assertIn('export TZUDONG_LAAJ_PROVIDER="gemini"', wrapper_text)
                self.assertNotIn("export PRIMARY_MODEL=", wrapper_text)
                self.assertNotIn("export LIVE_MAX_NEW_ITEMS=", wrapper_text)
                plist = plistlib.loads((home / "Library/LaunchAgents/dev.tzudong.hosted-new-video.plist").read_bytes())
                self.assertEqual(plist["StartCalendarInterval"], {"Hour": 5, "Minute": 15})
                ran = subprocess.run(["/bin/bash", str(wrapper)], env=env,
                                     capture_output=True, text=True, timeout=10)
                self.assertEqual(ran.returncode, 0, ran.stderr)
                arguments = args_file.read_text().splitlines()
                self.assertEqual(arguments[0], "provider=gemini")
                # The runner loads backend/.env with override=False; the stale
                # deferred value must not replace the wrapper's explicit route.
                with patch.dict(os.environ, {"TZUDONG_LAAJ_PROVIDER": arguments[0].removeprefix("provider=")}):
                    load_backend_env(checkout / "backend", prefer_local=True, override=False)
                    self.assertEqual(os.environ["TZUDONG_LAAJ_PROVIDER"], "gemini")
                self.assertEqual(arguments[1], str(checkout / "backend/bin/run_hosted_new_video_pipeline.py"))
                self.assertEqual(arguments[2:5], ["--channel", "tzuyang", "--limit"])
                self.assertEqual(arguments[5], "3")
                self.assertEqual(arguments.count("--review-automation"), int(opt_in or "0"))
                self.assertEqual(arguments.count("--receipt-out"), 1)
                receipt_path = Path(arguments[arguments.index("--receipt-out") + 1])
                self.assertEqual(receipt_path.parent, checkout / "backend/log/cron")
                self.assertRegex(receipt_path.name, r"^hosted-run-\d{8}T\d{6}Z\.json$")

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
            node = root / "bin/node"
            node.parent.mkdir()
            node.write_text("#!/bin/sh\nexit 0\n")
            node.chmod(0o700)
            (root / "backend").mkdir()
            env = {**os.environ, "NODE_CMD": str(node)}
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
            invalid_review = subprocess.run(["/bin/bash", "-eu", "-c", script],
                env={**env, "PYTHON_CMD": str(explicit), "TZUDONG_MAC_REVIEW_AUTOMATION": "yes"},
                capture_output=True, text=True)
            self.assertEqual(invalid_review.returncode, 2)
            self.assertIn("invalid_review_automation_opt_in", invalid_review.stderr)

    def test_non_node_basename_is_rejected_before_touching_launchd(self) -> None:
        text = INSTALL.read_text()
        selection = text[text.index('if [[ -n "${PYTHON_CMD:-}"') : text.index('mkdir -p')]
        with tempfile.TemporaryDirectory() as raw:
            node = Path(raw) / "different-node-name"
            node.write_text("#!/bin/sh\nexit 0\n")
            node.chmod(0o700)
            script = 'REPO_ROOT=' + shlex.quote(raw) + '\n' + selection
            result = subprocess.run(["/bin/bash", "-eu", "-c", script],
                env={**os.environ, "NODE_CMD": str(node)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('node_runtime_unavailable', result.stderr)

    def test_launchd_uses_one_calendar_event_without_replay_interval(self) -> None:
        text = INSTALL.read_text(encoding="utf-8")
        self.assertEqual(text.count("<key>StartCalendarInterval</key>"), 1)
        self.assertNotIn("<key>StartInterval</key>", text)
        self.assertNotIn("<key>KeepAlive</key>", text)
        self.assertNotRegex(text, r"(?m)^\s*(?:while|until)\s+")


if __name__ == "__main__":
    unittest.main()
