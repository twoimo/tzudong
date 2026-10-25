import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "merge_chunk_results.py"
SPEC = importlib.util.spec_from_file_location("merge_chunk_results", MODULE_PATH)
mod = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mod)


class MergeChunkVisualTests(unittest.TestCase):
    def merge_responses(self, records, *, expected=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index, record in enumerate(records):
                (root / f"chunk_response_{index}.json").write_text(
                    record if isinstance(record, str) else json.dumps(record), encoding="utf-8"
                )
            args = ["--dir", str(root)]
            if expected is not None:
                args += ["--expected-chunks", str(expected)]
            stdout = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
                mod.main(args)
            return json.loads(stdout.getvalue())

    def test_absence_requires_explicit_reason_from_every_chunk(self):
        with self.assertRaises(SystemExit):
            self.merge_responses([
                {"restaurants": [], "no_restaurant_reason": "home meal"},
                {"restaurants": []},
            ])

    def test_malformed_chunk_cannot_be_hidden_by_valid_restaurant(self):
        with self.assertRaises(SystemExit):
            self.merge_responses([
                {"restaurants": [{"origin_name": "Test restaurant"}]},
                "invalid JSON",
            ])

    def test_complete_explicit_absence_preserves_each_reason(self):
        payload = self.merge_responses([
            {"restaurants": [], "no_restaurant_reason": "home meal"},
            {"restaurants": [], "no_restaurant_reason": "studio conversation"},
        ], expected=2)
        self.assertEqual(payload["restaurants"], [])
        self.assertIn("home meal", payload["no_restaurant_reason"])
        self.assertIn("studio conversation", payload["no_restaurant_reason"])

    def test_missing_expected_chunk_rejects_partial_result(self):
        with self.assertRaises(SystemExit):
            self.merge_responses([
                {"restaurants": [{"origin_name": "Test restaurant"}]},
            ], expected=2)

    def test_unknown_name_is_preserved_as_candidate_instead_of_absence(self):
        payload = self.merge_responses([
            {"restaurants": [{"origin_name": None, "address": None, "category": []}]},
            {"restaurants": [], "no_restaurant_reason": "studio conversation"},
        ], expected=2)
        self.assertEqual(payload["restaurants"], [{"origin_name": None, "address": None, "category": []}])
        self.assertNotIn("no_restaurant_reason", payload)

    def test_visual_name_is_attached_when_caption_chunks_are_empty(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            responses = root / "responses"
            responses.mkdir()
            (responses / "chunk_response_0.json").write_text(
                json.dumps({"restaurants": [], "no_restaurant_reason": "no_name_in_captions"}),
                encoding="utf-8",
            )
            visual = root / "VYv06RZqe8k.jsonl"
            visual.write_text(
                json.dumps(
                    {
                        "origin_name": "요기라면",
                        "address": None,
                        "address_status": "unknown",
                        "evidence": {"visual": [{"t": 54, "texts": ["요기라면 &참참24"]}]},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mod.main(["--dir", str(responses), "--visual-location", str(visual)])
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["restaurants"][0]["origin_name"], "요기라면")
            self.assertIsNone(payload["restaurants"][0]["address"])
            self.assertEqual(payload["restaurants"][0]["address_status"], "unknown")
            self.assertEqual(payload["restaurants"][0]["evidence"]["visual"][0]["t"], 54)

    def test_caption_restaurants_are_kept_without_visual_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            responses = root / "responses"
            responses.mkdir()
            (responses / "chunk_response_0.json").write_text(
                json.dumps({"restaurants": [{"origin_name": "La Flauta", "address": "Carrer"}]}),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                mod.main(["--dir", str(responses)])
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["restaurants"][0]["origin_name"], "La Flauta")


if __name__ == "__main__":
    unittest.main()
