from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
COLLECT_URLS_SCRIPT = BACKEND_ROOT / "restaurant-crawling" / "scripts" / "01-collect-urls.py"
EMBEDDINGS_SCRIPT = (
    BACKEND_ROOT / "storyboard-agent" / "scripts" / "99-openai-embed-and-store-supabase.py"
)
THUMBNAIL_SCRIPT = (
    BACKEND_ROOT / "thumbnail-agent" / "scripts" / "retrieve-thumbnail-references.py"
)
SENSITIVE_VALUES = (
    "Bearer provider-token-123456",
    ".".join(("eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "signaturevalue")),
    "person@example.test",
    "010-1234-5678",
    "37.566500, 126.978000",
    r"C:\private\customers\record.json",
)
SENSITIVE_ERROR = " | ".join(SENSITIVE_VALUES)

for path in (REPO_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def load_script_module(name: str, path: Path) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"unable to load {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(name, None)
    return module


class HttpError(Exception):
    def __init__(self) -> None:
        self.resp = SimpleNamespace(status=429)
        super().__init__(SENSITIVE_ERROR)


class ProviderFailure(Exception):
    status_code = 403

    def __init__(self) -> None:
        super().__init__(SENSITIVE_ERROR)


class RecordingLogger:
    def __init__(self) -> None:
        self.messages: list[str] = []

    @contextlib.contextmanager
    def timer(self, _operation: str):
        yield

    def error(self, message: str) -> None:
        self.messages.append(message)

    def info(self, message: str) -> None:
        self.messages.append(message)

    def debug(self, message: str) -> None:
        self.messages.append(message)

    def success(self, message: str) -> None:
        self.messages.append(message)

    def add_statistic(self, _name: str, _value: int) -> None:
        return None
    def start_stage(self) -> None:
        return None

    def end_stage(self) -> None:
        return None

    def save_json_log(self) -> None:
        return None


class FailingYouTubeClient:
    def channels(self) -> "FailingYouTubeClient":
        return self

    def list(self, **_kwargs: object) -> "FailingYouTubeClient":
        return self

    def execute(self) -> object:
        raise HttpError()


class VerificationQuery:
    def __init__(self) -> None:
        self.count_query = False

    def select(self, *_fields: str, **kwargs: object) -> "VerificationQuery":
        self.count_query = kwargs.get("count") == "exact"
        return self

    def limit(self, _value: int) -> "VerificationQuery":
        return self

    def execute(self) -> SimpleNamespace:
        return SimpleNamespace(
            count=1,
            data=[
                {
                    "video_id": SENSITIVE_VALUES[-1],
                    "page_content": SENSITIVE_ERROR,
                    "metadata": {"restaurants": [SENSITIVE_ERROR]},
                }
            ],
        )


class VerificationClient:
    def table(self, _name: str) -> VerificationQuery:
        return VerificationQuery()


class BackendRawErrorClosureTests(unittest.TestCase):
    def assert_sensitive_values_absent(self, output: str) -> None:
        for value in SENSITIVE_VALUES:
            self.assertNotIn(value, output)

    def test_production_sources_do_not_interpolate_raw_exception_messages(self) -> None:
        sources = [path.read_text(encoding="utf-8") for path in (
            COLLECT_URLS_SCRIPT,
            EMBEDDINGS_SCRIPT,
            THUMBNAIL_SCRIPT,
        )]

        for source in sources:
            self.assertIn("safe_error_name", source)
            self.assertNotIn("str(exc)", source)
            self.assertNotIn("str(error)", source)
            self.assertNotRegex(source, r"[\"']error[\"']\s*:\s*str\(")

        self.assertNotIn('logger.info(f"  [New URL] {url}")', sources[0])
        self.assertNotIn("입력 디렉토리 없음: {INPUT_DIR}", sources[1])
        self.assertNotIn('"error": str(', sources[2])

    def test_youtube_provider_failure_uses_fixed_codes_without_exception_details(self) -> None:
        google_api = types.ModuleType("googleapiclient")
        google_api.__path__ = []  # type: ignore[attr-defined]
        discovery = types.ModuleType("googleapiclient.discovery")
        discovery.build = lambda *_args, **_kwargs: FailingYouTubeClient()  # type: ignore[attr-defined]
        errors = types.ModuleType("googleapiclient.errors")
        errors.HttpError = HttpError  # type: ignore[attr-defined]

        with patch.dict(
            sys.modules,
            {
                "googleapiclient": google_api,
                "googleapiclient.discovery": discovery,
                "googleapiclient.errors": errors,
            },
        ):
            module = load_script_module("collect_urls_raw_error_test", COLLECT_URLS_SCRIPT)

        logger = RecordingLogger()
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with self.assertRaises(HttpError):
                module.fetch_all_video_urls("api-key", "channel-id", logger)

        output = "\n".join([stdout.getvalue(), stderr.getvalue(), *logger.messages])
        self.assert_sensitive_values_absent(output)
        self.assertIn("op=youtube_video_url_collection_failed", output)
        self.assertIn("reason=youtube_api_rate_limited", output)
        self.assertIn("error=HttpError", output)


        def fail_collection(*_args: object, **_kwargs: object) -> dict[str, object]:
            raise HttpError()

        logger.messages.clear()
        module.PipelineLogger = lambda **_kwargs: logger
        module.get_api_key = lambda _provider: "api-key"
        module.get_all_channels = lambda: {"channel-id": {}}
        module.collect_channel_urls = fail_collection
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with patch.object(sys, "argv", ["01-collect-urls.py"]):
                with self.assertRaises(SystemExit) as exit_context:
                    module.main()

        output = "\n".join([stdout.getvalue(), stderr.getvalue(), *logger.messages])
        self.assertEqual(exit_context.exception.code, 1)
        self.assert_sensitive_values_absent(output)
        self.assertIn("op=collect_urls_failed reason=unexpected_failure", output)
        self.assertIn("error=HttpError", output)

    def test_embedding_batch_failure_and_verification_keep_provider_data_private(self) -> None:
        tqdm_module = types.ModuleType("tqdm")
        tqdm_module.tqdm = lambda iterable, **_kwargs: iterable  # type: ignore[attr-defined]
        openai_module = types.ModuleType("openai")
        openai_module.OpenAI = lambda **_kwargs: SimpleNamespace()  # type: ignore[attr-defined]
        supabase_module = types.ModuleType("supabase")
        supabase_module.Client = object  # type: ignore[attr-defined]
        supabase_module.create_client = lambda *_args, **_kwargs: object()  # type: ignore[attr-defined]
        dotenv_module = types.ModuleType("dotenv")
        dotenv_module.load_dotenv = lambda: None  # type: ignore[attr-defined]

        with patch.dict(
            sys.modules,
            {
                "tqdm": tqdm_module,
                "openai": openai_module,
                "supabase": supabase_module,
                "dotenv": dotenv_module,
            },
        ):
            module = load_script_module("embedding_raw_error_test", EMBEDDINGS_SCRIPT)

        def fail_embeddings(_texts: list[str]) -> list[list[float]]:
            raise ProviderFailure()

        module.get_embeddings = fail_embeddings
        document = {
            "video_id": "video-id",
            "chunk_index": 0,
            "recollect_id": 0,
            "page_content": "document",
            "metadata": {},
        }
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            module.embed_and_store(object(), [document], batch_size=1)
            module.verify_embeddings(VerificationClient())

        output = "\n".join([stdout.getvalue(), stderr.getvalue()])
        self.assert_sensitive_values_absent(output)
        self.assertIn("op=embedding_batch_failed", output)
        self.assertIn("reason=provider_auth_failed", output)
        self.assertIn("error=ProviderFailure", output)
        self.assertIn("op=embedding_verification_sample status=checked sample_count=1", output)

    def test_thumbnail_invalid_payload_json_contains_only_fixed_fallback_fields(self) -> None:
        malformed_payload = '{"query":"' + SENSITIVE_ERROR + '","unfinished":'
        environment = os.environ.copy()
        environment["THUMBNAIL_RETRIEVAL_JSON"] = malformed_payload
        result = subprocess.run(
            [sys.executable, str(THUMBNAIL_SCRIPT)],
            cwd=REPO_ROOT,
            env=environment,
            input="",
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0)
        output = "\n".join([result.stdout, result.stderr])
        self.assert_sensitive_values_absent(output)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed["evidence"], [])
        self.assertEqual(
            parsed["diagnostics"],
            {"candidateCount": 0, "fallbackReason": "invalid_json"},
        )
        self.assertNotIn("error", parsed["diagnostics"])


if __name__ == "__main__":
    unittest.main()
