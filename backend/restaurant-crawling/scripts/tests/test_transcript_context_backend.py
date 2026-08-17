import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "03-1-generate-transcript-context.py"
SPEC = importlib.util.spec_from_file_location("transcript_context", MODULE_PATH)
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)


class TranscriptContextBackendTests(unittest.TestCase):
    def test_default_backend_is_openai_compatible_omlx(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            backend = mod.resolve_transcript_context_backend()
            self.assertEqual(backend, "openai")
            self.assertEqual(
                mod.resolve_transcript_context_base_url(backend),
                "http://127.0.0.1:8080/v1",
            )
            self.assertEqual(
                mod.resolve_transcript_context_model(backend, None),
                "Qwen3.6-35B-A3B-4bit",
            )

    def test_ollama_host_alone_does_not_switch_backend(self) -> None:
        with patch.dict("os.environ", {"OLLAMA_HOST": "http://localhost:11434"}, clear=True):
            backend = mod.resolve_transcript_context_backend()
            self.assertEqual(backend, "openai")
            self.assertEqual(
                mod.resolve_transcript_context_base_url(backend),
                "http://127.0.0.1:8080/v1",
            )

    def test_explicit_ollama_backend_uses_ollama_host(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "TRANSCRIPT_CONTEXT_BACKEND": "ollama",
                "OLLAMA_HOST": "http://localhost:11434",
            },
            clear=True,
        ):
            backend = mod.resolve_transcript_context_backend()
            self.assertEqual(backend, "ollama")
            self.assertEqual(
                mod.resolve_transcript_context_base_url(backend),
                "http://localhost:11434",
            )
            self.assertEqual(
                mod.resolve_transcript_context_model(backend, None),
                "cookieshake/a.x-4.0-light-imatrix:Q8_0",
            )

    def test_openai_backend_wins_over_leftover_ollama_host(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "TRANSCRIPT_CONTEXT_BACKEND": "openai",
                "OLLAMA_HOST": "http://localhost:11434",
            },
            clear=True,
        ):
            self.assertEqual(mod.resolve_transcript_context_backend(), "openai")
            self.assertEqual(
                mod.resolve_transcript_context_base_url("openai"),
                "http://127.0.0.1:8080/v1",
            )

    def test_openai_connection_requires_matching_model_id(self) -> None:
        class FakeResponse:
            status_code = 200

            def json(self):
                return {"data": [{"id": "Qwen3.6-35B-A3B-4bit"}]}

        with patch.object(mod.requests, "get", return_value=FakeResponse()):
            self.assertTrue(
                mod.check_openai_compatible_connection(
                    "http://127.0.0.1:8080/v1",
                    "Qwen3.6-35B-A3B-4bit",
                )
            )
            self.assertFalse(
                mod.check_openai_compatible_connection(
                    "http://127.0.0.1:8080/v1",
                    "missing-model",
                )
            )

    def test_ollama_connection_fails_closed_when_model_missing(self) -> None:
        class FakeResponse:
            status_code = 200

            def json(self):
                return {"models": [{"name": "other:tag"}]}

        with patch.object(mod.requests, "get", return_value=FakeResponse()):
            self.assertFalse(
                mod.check_ollama_connection(
                    "http://localhost:11434",
                    "cookieshake/a.x-4.0-light-imatrix:Q8_0",
                )
            )
    def test_missing_openai_model_exits_nonzero(self) -> None:
        class FakeResponse:
            status_code = 200

            def json(self):
                return {"data": [{"id": "Qwen3.6-35B-A3B-4bit"}]}

        with patch.object(mod.requests, "get", return_value=FakeResponse()):
            with patch.object(mod.sys, "argv", ["03-1-generate-transcript-context.py", "--check-connection-only", "--model", "missing-model"]):
                self.assertEqual(mod.main(), 1)


if __name__ == "__main__":
    unittest.main()
