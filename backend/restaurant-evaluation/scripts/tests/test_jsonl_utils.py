import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


PROJECT_ROOT = Path(__file__).resolve().parents[3]
import sys

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.jsonl_utils import load_last_jsonl_record, read_last_non_empty_line


class JsonlUtilsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_read_last_non_empty_line_ignores_blank_lines(self):
        p = self.base / "sample.jsonl"
        p.write_text('{"a":1}\n\n{"b":2}\n\n', encoding="utf-8")
        self.assertEqual(read_last_non_empty_line(p), '{"b":2}')

    def test_load_last_jsonl_record_returns_latest_json_object(self):
        p = self.base / "records.jsonl"
        lines = [json.dumps({"idx": i}, ensure_ascii=False) for i in range(30)]
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.assertEqual(load_last_jsonl_record(p), {"idx": 29})

    def test_load_last_jsonl_record_handles_invalid_tail(self):
        p = self.base / "broken.jsonl"
        p.write_text('{"ok":true}\n{broken json}\n', encoding="utf-8")
        self.assertIsNone(load_last_jsonl_record(p))

    def test_read_last_non_empty_line_returns_none_for_empty_file(self):
        p = self.base / "empty.jsonl"
        p.write_text("", encoding="utf-8")
        self.assertIsNone(read_last_non_empty_line(p))

    def test_load_last_jsonl_record_returns_none_when_file_missing(self):
        p = self.base / "missing.jsonl"
        self.assertIsNone(load_last_jsonl_record(p))


if __name__ == "__main__":
    unittest.main()
