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


if __name__ == "__main__":
    unittest.main()
