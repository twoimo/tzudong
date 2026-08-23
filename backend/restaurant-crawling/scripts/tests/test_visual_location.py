import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "03-2-visual-location.py"
SPEC = importlib.util.spec_from_file_location("visual_location", MODULE_PATH)
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)


class VisualLocationTests(unittest.TestCase):
    def test_script_does_not_import_claude_video(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("claude-video", source)
        self.assertNotIn("bradautomates", source)
        self.assertIn("yt-dlp", source)
        self.assertIn("ffmpeg", source)

    def test_omitting_video_id_batches_discovered_channel_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "urls.txt").write_text("https://www.youtube.com/watch?v=VYv06RZqe8k\n", encoding="utf-8")
            self.assertEqual(mod.discover_channel_video_ids(root), ["VYv06RZqe8k"])
            empty = Path(temp) / "empty"
            empty.mkdir()
            self.assertEqual(mod.main(["--channel", "tzuyang", "--data-root", str(empty)]), 0)

    def test_generic_ocr_text_becomes_origin_without_address(self) -> None:
        frames = [(12, Path("t12.jpg"), ["줄포상회", "SUBSCRIBE"])]
        record = mod.build_record("h-VhD5u6ZwI", frames)
        self.assertEqual(record["origin_name"], "줄포상회")
        self.assertIn("줄포상회", record["sign_hints"])
        self.assertEqual(record["address_status"], "unknown")
        self.assertIsNone(record["address"])

    def test_sign_hints_do_not_confirm_an_address(self) -> None:
        frames = [
            (18, Path("t18.jpg"), ["요기라면 & 참참2", "24시 무인라면"]),
            (21, Path("t21.jpg"), ["아이스크림 할인점"]),
        ]
        record = mod.build_record("VYv06RZqe8k", frames)
        self.assertEqual(record["origin_name"], "요기라면")
        self.assertIn("요기라면", record["sign_hints"])
        self.assertIn("24시무인라면", record["sign_hints"])
        self.assertEqual(record["address_status"], "unknown")
        self.assertIsNone(record["address"])
        self.assertEqual(record["evidence"]["external"], [])
        self.assertEqual(record["evidence"]["visual"][0]["t"], 18)

    def test_invalid_video_id_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(
                mod.main(["--channel", "tzuyang", "--video-id", "bad", "--data-root", temp]),
                2,
            )


if __name__ == "__main__":
    unittest.main()
