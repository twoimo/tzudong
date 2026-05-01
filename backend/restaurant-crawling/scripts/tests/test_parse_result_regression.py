import argparse
import importlib.util
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "parse_result.py"
SPEC = importlib.util.spec_from_file_location("parse_result", MODULE_PATH)
parse_result = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(parse_result)


class ParseResultRegressionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.scripts_dir = self.root / "scripts"
        self.channel = "testchannel"

        self.channel_dir = self.root / "data" / self.channel
        for sub in [
            "crawling",
            "map_url_crawling",
            "crawling_errors",
            "meta",
            "transcript",
        ]:
            (self.channel_dir / sub).mkdir(parents=True, exist_ok=True)

        self.url = "https://www.youtube.com/watch?v=abc123xyz00"
        (self.channel_dir / "urls.txt").write_text(self.url + "\n", encoding="utf-8")

        # 기본 메타/자막은 존재하게 세팅
        self._write_jsonl(self.channel_dir / "meta" / "abc123xyz00.jsonl", {"title": "t"})
        self._write_jsonl(
            self.channel_dir / "transcript" / "abc123xyz00.jsonl",
            {"transcript": [{"text": "hello"}]},
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @staticmethod
    def _write_jsonl(path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")

    def _run_scan_pending(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        args = argparse.Namespace(channel=self.channel)

        with patch.object(parse_result, "__file__", str(self.scripts_dir / "parse_result.py")):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                parse_result.scan_pending(args)

        pending = [line.strip() for line in stdout.getvalue().splitlines() if line.strip()]
        return pending, stderr.getvalue()

    def test_scan_pending_retries_when_crawling_has_empty_restaurants(self):
        self._write_jsonl(
            self.channel_dir / "crawling" / "abc123xyz00.jsonl",
            {"youtube_link": self.url, "restaurants": []},
        )

        pending, _ = self._run_scan_pending()
        self.assertEqual(pending, [self.url])

    def test_scan_pending_skips_when_map_exists_even_if_crawling_is_empty(self):
        self._write_jsonl(
            self.channel_dir / "crawling" / "abc123xyz00.jsonl",
            {"youtube_link": self.url, "restaurants": []},
        )
        self._write_jsonl(
            self.channel_dir / "map_url_crawling" / "abc123xyz00.jsonl",
            {"youtube_link": self.url, "restaurants": [{"origin_name": "x", "address": "y", "category": "z"}]},
        )

        pending, _ = self._run_scan_pending()
        self.assertEqual(pending, [])

    def test_validate_restaurant_data_rejects_empty_restaurants(self):
        ok = parse_result.validate_restaurant_data({"restaurants": []})
        self.assertFalse(ok)

    def test_validate_rejects_keyword_only_restaurant_identity_inference(self):
        ok = parse_result.validate_restaurant_data({
            "restaurants": [{
                "origin_name": "청량리 할머니 냉면",
                "address": "서울특별시 동대문구 제기동 457",
                "category": ["한식", "분식"],
                "reasoning_basis": "영상 내 45년 전통, 청량리 시장, 매운 냉면이라는 키워드와 간판의 글씨체, 할머니가 언급되는 점을 종합할 때 청량리 할머니 냉면으로 특정됩니다.",
            }]
        })
        self.assertFalse(ok)

    def test_manual_place_correction_overrides_verified_video(self):
        corrections_path = self.root / "data" / "manual_place_corrections.json"
        corrections_path.write_text(json.dumps({
            "https://www.youtube.com/watch?v=GQyNACahbyM": {
                "source": "unit_test",
                "reason": "verified onscreen",
                "restaurants": [{
                    "origin_name": "춘천냉면",
                    "address": "서울 동대문구 왕산로37길 50",
                    "category": ["한식", "분식"],
                }],
            }
        }, ensure_ascii=False), encoding="utf-8")

        with patch.object(parse_result, "__file__", str(self.scripts_dir / "parse_result.py")):
            corrected = parse_result.apply_manual_place_correction(
                "https://www.youtube.com/watch?v=GQyNACahbyM",
                {"restaurants": [{"origin_name": "청량리 할머니 냉면", "address": "x", "category": ["한식"]}]},
            )

        self.assertEqual("춘천냉면", corrected["restaurants"][0]["origin_name"])
        self.assertIn("왕산로37길 50", corrected["restaurants"][0]["address"])


if __name__ == "__main__":
    unittest.main()
