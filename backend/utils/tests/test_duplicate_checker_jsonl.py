"""Contract tests for the shared JSONL duplicate-check utilities.

Feature: crawler-pipeline-orchestration

`backend/utils/duplicate_checker.py` is documented as a reusable helper for the
long-running crawl/evaluation scripts. These tests pin the two properties those
runs depend on:

  1. well-formed JSONL produces exactly the same extracted sets, and
  2. a damaged line (broken JSON, or JSON that parses to a non-object) is skipped
     with a warning instead of raising, so one bad line cannot abort a whole run.

The tests only read and write inside a TemporaryDirectory.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.utils.duplicate_checker import (  # noqa: E402
    append_to_jsonl,
    filter_new_items,
    get_file_stats,
    load_multiple_processed_restaurants,
    load_multiple_processed_urls,
    load_processed_restaurants,
    load_processed_unique_ids,
    load_processed_urls,
)


class DuplicateCheckerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write_lines(self, name: str, lines: list[str]) -> Path:
        path = self.dir / name
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def write_records(self, name: str, records: list[object]) -> Path:
        return self.write_lines(
            name, [json.dumps(record, ensure_ascii=False) for record in records]
        )


class LoaderContractTests(DuplicateCheckerTestCase):
    def test_missing_file_returns_empty_sets(self) -> None:
        missing = str(self.dir / "does-not-exist.jsonl")

        self.assertEqual(load_processed_urls(missing), set())
        self.assertEqual(load_processed_restaurants(missing), set())
        self.assertEqual(load_processed_unique_ids(missing), set())
        self.assertEqual(load_multiple_processed_urls(missing), set())
        self.assertEqual(load_multiple_processed_restaurants(missing), set())

    def test_load_processed_urls_dedupes_and_skips_blank_lines(self) -> None:
        path = self.write_lines(
            "urls.jsonl",
            [
                json.dumps({"youtube_link": "https://youtu.be/a"}),
                "",
                "   ",
                json.dumps({"youtube_link": "https://youtu.be/b"}),
                json.dumps({"youtube_link": "https://youtu.be/a"}),
                json.dumps({"name": "링크 없음"}),
            ],
        )

        self.assertEqual(
            load_processed_urls(str(path)),
            {"https://youtu.be/a", "https://youtu.be/b"},
        )

    def test_load_processed_restaurants_reads_nested_and_flat_records(self) -> None:
        nested_path = self.write_records(
            "nested.jsonl",
            [
                {"restaurants": [{"name": "가"}, {"name": ""}, {"other": 1}, "문자열", 7]},
                {"restaurants": [{"name": "나"}, {"name": "가"}]},
                {"restaurants": []},
            ],
        )

        self.assertEqual(load_processed_restaurants(str(nested_path)), {"가", "나"})

        flat_path = self.write_records(
            "flat.jsonl",
            [{"name": "다"}, {"name": ""}, {"other": 1}],
        )

        self.assertEqual(
            load_processed_restaurants(str(flat_path), key="name", nested_key=None),
            {"다"},
        )

    def test_load_processed_restaurants_warns_when_nested_value_is_not_an_array(self) -> None:
        path = self.write_records(
            "not-array.jsonl",
            [{"restaurants": {"name": "가"}}, {"restaurants": "나"}],
        )

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(load_processed_restaurants(str(path)), set())

        self.assertIn("배열이 아님", out.getvalue())

    def test_load_processed_unique_ids_ignores_missing_and_empty_values(self) -> None:
        path = self.write_records(
            "ids.jsonl",
            [{"unique_id": "id1"}, {"unique_id": ""}, {}, {"unique_id": "id2"}],
        )

        self.assertEqual(load_processed_unique_ids(str(path)), {"id1", "id2"})

    def test_multiple_file_loaders_union_their_results(self) -> None:
        first = self.write_records("first.jsonl", [{"youtube_link": "a"}, {"youtube_link": "b"}])
        second = self.write_records("second.jsonl", [{"youtube_link": "b"}])

        self.assertEqual(load_multiple_processed_urls(str(first), str(second)), {"a", "b"})

        first_restaurants = self.write_records("r1.jsonl", [{"restaurants": [{"name": "가"}]}])
        second_restaurants = self.write_records("r2.jsonl", [{"restaurants": [{"name": "나"}]}])

        self.assertEqual(
            load_multiple_processed_restaurants(str(first_restaurants), str(second_restaurants)),
            {"가", "나"},
        )

    def test_clean_input_emits_no_warnings(self) -> None:
        path = self.write_records("clean.jsonl", [{"youtube_link": "a"}, {"unique_id": "i"}])

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            load_processed_urls(str(path))
            load_processed_unique_ids(str(path))
            load_processed_restaurants(str(path))

        self.assertEqual(out.getvalue(), "")


class DamagedLineResilienceTests(DuplicateCheckerTestCase):
    def damaged_lines(self) -> Path:
        return self.write_lines(
            "damaged.jsonl",
            [
                json.dumps({"youtube_link": "a"}),
                '{"youtube_link":',
                "123",
                '"bare string"',
                "[1, 2]",
                "null",
                json.dumps({"youtube_link": "b"}),
            ],
        )

    def test_loaders_survive_damaged_lines_and_keep_valid_records(self) -> None:
        path = self.damaged_lines()

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            urls = load_processed_urls(str(path))
            ids = load_processed_unique_ids(str(path))
            restaurants = load_processed_restaurants(str(path))

        self.assertEqual(urls, {"a", "b"})
        self.assertEqual(ids, set())
        self.assertEqual(restaurants, set())

        warnings = out.getvalue()
        self.assertIn("JSON 파싱 오류", warnings)
        self.assertIn("JSON 객체가 아님", warnings)

    def test_damaged_lines_do_not_raise(self) -> None:
        path = self.damaged_lines()

        with contextlib.redirect_stdout(io.StringIO()):
            for loader in (load_processed_urls, load_processed_unique_ids, load_processed_restaurants):
                with self.subTest(loader=loader.__name__):
                    loader(str(path))


class FilterAndAppendTests(DuplicateCheckerTestCase):
    def test_filter_new_items_drops_already_processed_keys(self) -> None:
        items = [{"u": "a"}, {"u": "b"}, {"u": "c"}]

        self.assertEqual(
            filter_new_items(items, {"a", "c"}, lambda item: item["u"]),
            [{"u": "b"}],
        )
        self.assertEqual(filter_new_items([], {"a"}, lambda item: item["u"]), [])

    def test_append_to_jsonl_creates_dirs_and_round_trips_records(self) -> None:
        target = self.dir / "nested" / "out.jsonl"

        self.assertEqual(append_to_jsonl(str(target), {"youtube_link": "a", "name": "정원분식"}), 1)
        self.assertEqual(
            append_to_jsonl(str(target), [{"youtube_link": "b"}, {"youtube_link": "c"}]),
            2,
        )

        self.assertEqual(load_processed_urls(str(target)), {"a", "b", "c"})

        raw = target.read_text(encoding="utf-8")
        self.assertIn("정원분식", raw)
        self.assertNotIn("\\u", raw)

    def test_get_file_stats_counts_blank_json_and_broken_lines(self) -> None:
        path = self.write_lines(
            "stats.jsonl",
            [json.dumps({"a": 1}), "{broken", json.dumps({"b": 2}), "", "   "],
        )

        stats = get_file_stats(str(path))

        self.assertTrue(stats["exists"])
        self.assertEqual(stats["total_lines"], 3)
        self.assertEqual(stats["valid_lines"], 2)
        self.assertEqual(stats["invalid_lines"], 1)
        self.assertGreater(stats["size_bytes"], 0)
        self.assertAlmostEqual(stats["size_mb"], stats["size_bytes"] / (1024 * 1024))

    def test_get_file_stats_reports_missing_file(self) -> None:
        self.assertEqual(
            get_file_stats(str(self.dir / "nope.jsonl")),
            {
                "exists": False,
                "total_lines": 0,
                "valid_lines": 0,
                "invalid_lines": 0,
                "size_bytes": 0,
                "size_mb": 0,
            },
        )


if __name__ == "__main__":
    unittest.main()
