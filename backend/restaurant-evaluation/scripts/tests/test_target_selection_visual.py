import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "09-target-selection.py"
SPEC = importlib.util.spec_from_file_location("target_selection", MODULE_PATH)
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)


class TargetSelectionVisualTests(unittest.TestCase):
    def test_visual_origin_becomes_pending_candidate_without_address(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            visual_dir = root / "visual-location"
            visual_dir.mkdir()
            (visual_dir / "VYv06RZqe8k.jsonl").write_text(
                json.dumps(
                    {
                        "video_id": "VYv06RZqe8k",
                        "origin_name": "요기라면",
                        "address_status": "unknown",
                        "address": None,
                        "evidence": {"visual": [{"t": 18, "texts": ["요기라면 & 참참2"]}]},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            result = mod.create_evaluation_targets("VYv06RZqe8k", root, "tzuyang")
            self.assertIsNotNone(result)
            self.assertFalse(result["is_not_selected"])
            self.assertEqual(result["data"]["visual_origin_name"], "요기라면")
            self.assertEqual(result["data"]["address_status"], "unknown")
            self.assertEqual(result["data"]["restaurants"][0]["origin_name"], "요기라면")
            self.assertIsNone(result["data"]["restaurants"][0]["address"])
            self.assertEqual(result["data"]["restaurants"][0]["address_status"], "unknown")
            self.assertFalse(result["data"]["evaluation_target"]["요기라면"])

    def test_caption_restaurants_are_unchanged_when_visual_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            crawling = root / "crawling"
            crawling.mkdir()
            (crawling / "pp5dpgqtO4s.jsonl").write_text(
                json.dumps(
                    {
                        "youtube_link": "https://www.youtube.com/watch?v=pp5dpgqtO4s",
                        "restaurants": [{"origin_name": "La Flauta", "address": "Carrer de la Diputació"}],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            result = mod.create_evaluation_targets("pp5dpgqtO4s", root, "tzuyang")
            self.assertFalse(result["is_not_selected"])
            self.assertEqual(result["data"]["restaurants"][0]["origin_name"], "La Flauta")
            self.assertTrue(result["data"]["evaluation_target"]["La Flauta"])


if __name__ == "__main__":
    unittest.main()
