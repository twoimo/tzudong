from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.pipeline import nodes
from backend.utils.logger import LogLevel, PipelineLogger
from backend.utils.privacy_log import REDACTED, redact_log_text, safe_error_name, sanitize_log_value


class ExplosiveObject:
    def __str__(self) -> str:
        raise AssertionError("unsafe stringification")


class ExplosiveError(Exception):
    def __str__(self) -> str:
        raise AssertionError("unsafe exception stringification")


class PrivacyLogTests(unittest.TestCase):
    def test_redact_log_text_removes_supported_sensitive_values(self) -> None:
        secret_values = [
            "person@example.com",
            "010-1234-5678",
            "+1 202 555 0199",
            "900101-1234567",
            "900101-5234567",
            "backend-api-token-123",
            "super-secret-password",
            "cookie-session-value",
            "37.566500, 126.978000",
            "원본 OCR 텍스트",
            "service-role-secret",
        ]
        text = "\n".join(
            [
                "email=person@example.com phone=010-1234-5678 international=+1 202 555 0199 rrn=900101-1234567 foreign_id=900101-5234567",
                "Authorization: Bearer backend-api-token-123 password=super-secret-password",
                "Cookie: session=cookie-session-value; other=still-secret",
                "https://user:super-secret-password@example.test/path?api_key=backend-api-token-123",
                "SUPABASE_SERVICE_ROLE_KEY=service-role-secret",
                "coordinates: 37.566500, 126.978000",
                "raw_ocr: 원본 OCR 텍스트",
                "-----BEGIN " + "PRIVATE KEY-----\nbackend-api-token-123\n-----END PRIVATE KEY-----",
            ]
        )

        redacted = redact_log_text(text)

        self.assertIn(REDACTED, redacted)
        for value in secret_values:
            self.assertNotIn(value, redacted)
        self.assertNotIn("still-secret", redacted)
        self.assertLessEqual(len(redact_log_text("x" * 100, max_length=24)), 24)

    def test_sanitize_log_value_handles_depth_cycles_and_unsafe_objects(self) -> None:
        cycle: list[object] = []
        cycle.append(cycle)
        deep = {"first": {"second": {"third": "person@example.com"}}}
        sanitized = sanitize_log_value(
            {
                "token": "backend-api-token-123",
                "cycle": cycle,
                "deep": deep,
                "latitude": 37.5665,
                "object": ExplosiveObject(),
                "error": ExplosiveError("person@example.com"),
            },
            max_depth=3,
            max_entries=20,
        )

        self.assertEqual(sanitized["token"], REDACTED)
        self.assertEqual(sanitized["cycle"], ["<cycle>"])
        self.assertEqual(sanitized["deep"]["first"]["second"], "<max-depth>")
        self.assertEqual(sanitized["latitude"], REDACTED)
        self.assertEqual(sanitized["object"], "<ExplosiveObject>")
        self.assertEqual(sanitized["error"], {"error": "ExplosiveError"})
        self.assertEqual(safe_error_name(ExplosiveError("backend-api-token-123")), "ExplosiveError")
        self.assertEqual(
            sanitize_log_value([0, 1, 2], max_entries=2),
            [0, "[TRUNCATED]"],
        )

    def test_logger_redacts_terminal_files_json_and_stats(self) -> None:
        secret = "logger-secret-987"
        with TemporaryDirectory() as directory:
            terminal = io.StringIO()
            with contextlib.redirect_stdout(terminal):
                logger = PipelineLogger(
                    "privacy-test",
                    log_dir=Path(directory),
                    log_level=LogLevel.DEBUG,
                )
                logger.error(
                    f"contact=person@example.com Authorization: Bearer {secret}",
                    {"password": secret, "raw_ocr": "raw OCR payload", "nested": {"phone": "010-1234-5678"}},
                )
                logger.error(ExplosiveError("never stringify"))
                logger.add_stat("details", {"token": secret})
                summary = logger.save_summary()

            file_contents = "\n".join(
                [
                    logger.log_file.read_text(encoding="utf-8"),
                    logger.json_log_file.read_text(encoding="utf-8"),
                    logger.summary_file.read_text(encoding="utf-8"),
                ]
            )
            serialized_stats = json.dumps(summary, ensure_ascii=False)
            terminal_output = terminal.getvalue()

        for output in (file_contents, serialized_stats, terminal_output):
            self.assertNotIn(secret, output)
            self.assertNotIn("person@example.com", output)
            self.assertNotIn("010-1234-5678", output)
            self.assertNotIn("raw OCR payload", output)
            self.assertIn(REDACTED, output)

    def test_subprocess_output_is_redacted_bounded_and_keeps_nonzero_status(self) -> None:
        result = subprocess.CompletedProcess(
            ["fake-command"],
            9,
            stdout="token=subprocess-secret " + ("x" * 5000),
            stderr="Authorization: Bearer subprocess-error-secret",
        )
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exit_code = nodes._emit_subprocess_output(result)

        self.assertEqual(exit_code, 9)
        self.assertEqual(result.returncode, 9)
        self.assertNotIn("subprocess-secret", stdout.getvalue())
        self.assertNotIn("subprocess-error-secret", stderr.getvalue())
        self.assertLessEqual(len(stdout.getvalue()), 4096)
        self.assertIn(REDACTED, stdout.getvalue())
        self.assertIn(REDACTED, stderr.getvalue())
        status_log = io.StringIO()
        with contextlib.redirect_stdout(status_log):
            nodes._log_subprocess_result("test", result, 1.0)
        self.assertIn("실패", status_log.getvalue())


if __name__ == "__main__":
    unittest.main()
