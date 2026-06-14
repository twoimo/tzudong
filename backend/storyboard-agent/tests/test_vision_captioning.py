import importlib
import os
import sys
import unittest
from unittest.mock import patch


class VisionCaptioningProviderTests(unittest.TestCase):
    def setUp(self):
        self.previous = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.previous)

    def test_import_is_lightweight_and_does_not_load_llava_stack(self):
        sys.modules.pop("vision_captioning", None)
        sys.modules.pop("vision_captioning.providers", None)
        sys.modules.pop("torch", None)
        sys.modules.pop("transformers", None)
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        module = importlib.import_module("vision_captioning")
        self.assertTrue(hasattr(module, "get_provider"))
        self.assertNotIn("torch", sys.modules)
        self.assertNotIn("transformers", sys.modules)

    def test_resolve_provider_defaults_and_remote_kill_switch(self):
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        from vision_captioning import resolve_provider_id

        os.environ.pop("STORYBOARD_CAPTION_PROVIDER", None)
        os.environ.pop("STORYBOARD_CAPTION_DISABLE_REMOTE", None)
        self.assertEqual(resolve_provider_id(), "llava_next_video")

        os.environ["STORYBOARD_CAPTION_PROVIDER"] = "openai_vision_gpt55"
        self.assertEqual(resolve_provider_id(), "openai_vision_gpt55")

        os.environ["STORYBOARD_CAPTION_DISABLE_REMOTE"] = "1"
        self.assertEqual(resolve_provider_id(), "llava_next_video")

    def test_codex_provider_requires_trusted_local_flag_before_login_probe(self):
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        from vision_captioning.providers import CaptionProviderUnavailable, CodexCliVisionProvider

        os.environ.pop("STORYBOARD_CAPTION_ALLOW_CODEX_CLI", None)
        with patch("subprocess.run") as run:
            with self.assertRaises(CaptionProviderUnavailable):
                CodexCliVisionProvider()._require_local_trust()
            run.assert_not_called()

    def test_codex_provider_reports_missing_cli_as_unavailable(self):
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        from vision_captioning.providers import CaptionProviderUnavailable, CodexCliVisionProvider

        os.environ["STORYBOARD_CAPTION_ALLOW_CODEX_CLI"] = "1"
        with patch("subprocess.run", side_effect=FileNotFoundError("missing codex")):
            with self.assertRaises(CaptionProviderUnavailable) as caught:
                CodexCliVisionProvider()._require_local_trust()
        self.assertIn("codex login status unavailable", str(caught.exception))

    def test_openai_provider_requires_platform_api_key(self):
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        from vision_captioning import CaptionRequest
        from vision_captioning.providers import CaptionProviderUnavailable, OpenAIVisionProvider

        os.environ.pop("OPENAI_API_KEY", None)
        with self.assertRaises(CaptionProviderUnavailable):
            OpenAIVisionProvider().generate(
                CaptionRequest(
                    video_id="abc",
                    recollect_id=0,
                    rank=1,
                    start_sec=1,
                    end_sec=2,
                    duration=3,
                    frame_paths=[],
                )
            )

    def test_codex_child_env_strips_ambient_service_role_and_api_keys(self):
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))
        from vision_captioning.providers import _codex_child_env

        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-secret"
        os.environ["DATABASE_URL"] = "postgres://secret"
        os.environ["OPENAI_API_KEY"] = "sk-secret"
        os.environ["PATH"] = "/usr/bin"
        child_env = _codex_child_env()
        self.assertEqual(child_env.get("PATH"), "/usr/bin")
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", child_env)
        self.assertNotIn("DATABASE_URL", child_env)
        self.assertNotIn("OPENAI_API_KEY", child_env)

class FrameCaptionEntrypointTests(unittest.TestCase):
    def test_frame_caption_help_runs_on_python38_runtime_annotations(self):
        import subprocess
        from pathlib import Path

        script = Path(__file__).resolve().parents[2] / "restaurant-crawling" / "scripts" / "06-frame-caption.py"
        completed = subprocess.run(
            [sys.executable, str(script), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--provider", completed.stdout)

    def test_frame_caption_openai_provider_fails_fast_without_api_key(self):
        import shutil
        import subprocess
        from pathlib import Path

        script = Path(__file__).resolve().parents[2] / "restaurant-crawling" / "scripts" / "06-frame-caption.py"
        data_dir = script.parents[1] / "data" / "__caption_preflight_fixture__"
        try:
            (data_dir / "frames").mkdir(parents=True, exist_ok=True)
            (data_dir / "meta").mkdir(parents=True, exist_ok=True)
            env = dict(os.environ)
            env.pop("OPENAI_API_KEY", None)
            completed = subprocess.run(
                [sys.executable, str(script), "--youtuber", data_dir.name, "--provider", "openai_vision_gpt55"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20,
                check=False,
                env=env,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("requires OPENAI_API_KEY", completed.stderr + completed.stdout)
        finally:
            shutil.rmtree(data_dir, ignore_errors=True)

    def test_frame_caption_resolves_shared_frames_root(self):
        import importlib.util
        import tempfile
        from pathlib import Path

        script = Path(__file__).resolve().parents[2] / "restaurant-crawling" / "scripts" / "06-frame-caption.py"
        spec = importlib.util.spec_from_file_location("frame_caption_script", script)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            channel_dir = base / "tzuyang"
            shared_frames = base / "frames"
            channel_dir.mkdir()
            shared_frames.mkdir()
            self.assertEqual(module.resolve_frames_dir(channel_dir, base), shared_frames)

            channel_frames = channel_dir / "frames"
            channel_frames.mkdir()
            self.assertEqual(module.resolve_frames_dir(channel_dir, base), channel_frames)

    def test_frame_caption_finds_nested_extracted_frame_files(self):
        import importlib.util
        import tempfile
        from pathlib import Path

        script = Path(__file__).resolve().parents[2] / "restaurant-crawling" / "scripts" / "06-frame-caption.py"
        spec = importlib.util.spec_from_file_location("frame_caption_script_nested", script)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            segment = Path(tmp) / "1_10_20"
            nested = segment / "jpg" / "360p_1.0fps"
            nested.mkdir(parents=True)
            for name in ("frame_10.jpg", "frame_2.jpg", "frame_0.jpg"):
                (nested / name).write_bytes(b"fake")
            paths = [Path(p).name for p in module.get_frame_paths(segment)]
            self.assertEqual(paths, ["frame_0.jpg", "frame_2.jpg", "frame_10.jpg"])

    def test_frame_caption_provider_runtime_failure_is_fail_closed(self):
        import importlib.util
        import tempfile
        from pathlib import Path

        script = Path(__file__).resolve().parents[2] / "restaurant-crawling" / "scripts" / "06-frame-caption.py"
        spec = importlib.util.spec_from_file_location("frame_caption_script_fail_closed", script)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        class FailingProvider:
            def generate(self, request):
                raise module.CaptionProviderError("provider exploded")

        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            segment = base / "frames" / "video123" / "0" / "1_10_20"
            segment.mkdir(parents=True)
            (segment / "frame_0.jpg").write_bytes(b"fake")
            with self.assertRaises(module.CaptionProviderError):
                module.process_video_frames(
                    video_id="video123",
                    frames_dir=base / "frames",
                    output_dir=base / "captions",
                    meta_dir=base / "meta",
                    caption_provider=FailingProvider(),
                    prompt="describe",
                )


class CaptionStoreScriptTests(unittest.TestCase):
    def _load_script(self):
        import importlib.util
        from pathlib import Path

        script = Path(__file__).resolve().parents[1] / "scripts" / "02-video-caption-store-supbase.py"
        spec = importlib.util.spec_from_file_location("caption_store_script", script)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_caption_store_sanitizes_local_provenance_before_db_record(self):
        module = self._load_script()
        sanitized = module.sanitize_caption_provenance(
            {
                "providerId": "codex_cli_vision_gpt55",
                "model": "gpt-5.5",
                "authMode": "codex_cli_oauth_local",
                "requestHash": "abc",
                "fileNameHashes": ["h1", "h2"],
                "frames": ["/tmp/private/frame_0.jpg"],
                "apiKey": "sk-secret",
            }
        )
        self.assertEqual(sanitized["providerId"], "codex_cli_vision_gpt55")
        self.assertEqual(sanitized["fileNameHashes"], ["h1", "h2"])
        self.assertNotIn("frames", sanitized)
        self.assertNotIn("apiKey", sanitized)

    def test_caption_store_loads_single_input_file_without_directory_scan(self):
        import json
        import tempfile
        from pathlib import Path

        module = self._load_script()
        with tempfile.TemporaryDirectory() as tmp:
            input_file = Path(tmp) / "video123.jsonl"
            input_file.write_text(
                json.dumps(
                    {
                        "recollect_id": 0,
                        "start_sec": 1,
                        "end_sec": 2,
                        "duration": 3,
                        "rank": 1,
                        "raw_caption": "테스트 캡션",
                        "caption_provider": "codex_cli_vision_gpt55",
                        "caption_model": "gpt-5.5",
                        "caption_auth_mode": "codex_cli_oauth_local",
                        "caption_provenance": {
                            "providerId": "codex_cli_vision_gpt55",
                            "frames": ["/private/path.jpg"],
                        },
                        "caption_schema_version": 2,
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            rows = module.load_captions(input_file=input_file)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["video_id"], "video123")
        self.assertEqual(rows[0]["caption_provider"], "codex_cli_vision_gpt55")
        self.assertNotIn("frames", rows[0]["caption_provenance"])

    def test_caption_store_dry_run_does_not_fetch_data_branch(self):
        module = self._load_script()
        with patch.object(sys, "argv", ["caption-store", "--dry-run"]):
            with patch.object(module, "fetch_data_from_git") as fetch:
                with patch.object(module, "load_captions", return_value=[]):
                    module.main()
        fetch.assert_not_called()

    def test_caption_store_upsert_failure_is_fail_closed(self):
        module = self._load_script()

        class FailingExecute:
            def execute(self):
                raise RuntimeError("db exploded")

        class FakeTable:
            def upsert(self, *args, **kwargs):
                return FailingExecute()

        class FakeSupabase:
            def table(self, name):
                return FakeTable()

        with self.assertRaises(RuntimeError) as caught:
            module.store_captions(
                FakeSupabase(),
                [
                    {
                        "video_id": "video123",
                        "recollect_id": 0,
                        "start_sec": 1,
                    }
                ],
                batch_size=1,
            )
        self.assertIn("upsert failed", str(caught.exception))

    def test_caption_store_readback_missing_is_fail_closed(self):
        module = self._load_script()

        class EmptyResponse:
            data = []

        class FakeQuery:
            def select(self, *args, **kwargs):
                return self

            def eq(self, *args, **kwargs):
                return self

            def limit(self, *args, **kwargs):
                return self

            def execute(self):
                return EmptyResponse()

        class FakeSupabase:
            def table(self, name):
                return FakeQuery()

        with self.assertRaises(RuntimeError) as caught:
            module.readback_captions(
                FakeSupabase(),
                [
                    {
                        "video_id": "video123",
                        "recollect_id": 0,
                        "start_sec": 1,
                    }
                ],
            )
        self.assertIn("readback missing", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
