"""Filesystem queue boundary tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control import queue


class FilesystemQueueTests(unittest.TestCase):
    def test_drain_streams_valid_rows_and_quarantines_invalid_entries(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "pipeline.jsonl"
            path.write_text(
                "\n"
                '{"job": "one"}\n'
                "[]\n"
                "not-json\n"
                '{"job": "two"}\n',
                encoding="utf-8",
            )

            self.assertEqual(queue.drain(path), [{"job": "one"}, {"job": "two"}])
            self.assertFalse(path.exists())
            self.assertFalse(path.with_suffix(path.suffix + ".taking").exists())
            self.assertEqual(
                path.with_suffix(path.suffix + ".poison").read_text(encoding="utf-8"),
                "[]\nnot-json\n",
            )

    def test_drain_missing_or_empty_queue_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "pipeline.jsonl"
            self.assertEqual(queue.drain(path), [])
            path.write_text("\n  \n", encoding="utf-8")
            self.assertEqual(queue.drain(path), [])
            self.assertFalse(path.exists())

    def test_drain_restores_taken_queue_when_input_read_fails(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "pipeline.jsonl"
            original = b"not-json\n\xff\n"
            path.write_bytes(original)

            with self.assertRaises(UnicodeDecodeError):
                queue.drain(path)

            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(path.with_suffix(path.suffix + ".taking").exists())
            self.assertFalse(path.with_suffix(path.suffix + ".poison").exists())


if __name__ == "__main__":
    unittest.main()
