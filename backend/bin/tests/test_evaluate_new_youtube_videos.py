#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "backend" / "bin" / "evaluate_new_youtube_videos.py"
spec = importlib.util.spec_from_file_location("evaluate_new_youtube_videos", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class EvaluateNewYoutubeVideosTests(unittest.TestCase):
    def test_skips_when_all_urls_already_hosted(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            return 0

        with patch.object(module, "assert_hosted_target"), patch.object(
            module,
            "fetch_hosted_restaurant_snapshot",
            return_value=([], ["abcdefghijk"]),
        ), patch.object(module, "_load_urls", return_value=["https://www.youtube.com/watch?v=abcdefghijk"]), patch.object(
            module, "_write_urls"
        ), patch.object(module, "_run", side_effect=fake_run):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertTrue(str(calls[0][1]).endswith("01-collect-urls.py"))

    def test_rejects_invalid_limit(self) -> None:
        self.assertEqual(module.main(["--limit", "0"]), 2)
        self.assertEqual(module.main(["--limit", "9"]), 2)
    def test_continues_when_optional_context_fails(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
            calls.append(argv)
            joined = " ".join(argv)
            if "03-1-generate-transcript-context.py" in joined:
                if required:
                    raise SystemExit("context_should_be_optional")
                return 1
            return 0

        with patch.object(module, "assert_hosted_target"), patch.object(
            module,
            "fetch_hosted_restaurant_snapshot",
            return_value=([], []),
        ), patch.object(
            module,
            "_load_urls",
            side_effect=[
                [],
                ["https://www.youtube.com/watch?v=dNTE6DuEWGg"],
            ],
        ), patch.object(module, "_write_urls"), patch.object(
            module, "_run", side_effect=fake_run
        ):
            code = module.main(["--channel", "tzuyang", "--limit", "1"])
        self.assertEqual(code, 0)
        self.assertTrue(any("08-chunk-multimodal-crawling.sh" in " ".join(call) for call in calls))
    def test_laaj_script_keeps_absolute_evaluation_path(self) -> None:
        script = (
            ROOT
            / "backend"
            / "restaurant-evaluation"
            / "scripts"
            / "11-laaj-evaluation.sh"
        )
        text = script.read_text(encoding="utf-8")
        self.assertIn('if [[ "$EVALUATION_PATH" = /* ]]; then', text)
        self.assertIn('--video-id) VIDEO_ID_FILTER="$2"; shift 2 ;;', text)
        self.assertIn('VIDEO_IDS=("$VIDEO_ID_FILTER")', text)
        self.assertIn('FULL_EVALUATION_PATH="$EVALUATION_PATH"', text)
        self.assertIn(
            "Node.js API Health Check 실패 & Gemini CLI 미설치. Node API로 평가를 계속합니다.",
            text,
        )
        self.assertNotIn(
            "Node.js API Health Check 실패 & Gemini CLI 미설치. 평가를 건너뜁니다.",
            text,
        )

if __name__ == "__main__":
    unittest.main()
