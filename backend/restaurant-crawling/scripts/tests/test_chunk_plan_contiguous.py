import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SCRIPT = Path(__file__).resolve().parents[1] / "chunk_planner.py"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("chunk_planner_under_test", SCRIPT)
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class ChunkPlanContiguousTests(unittest.TestCase):
    def test_short_video_stays_one_chunk(self) -> None:
        segments = [{"start": 0.0, "duration": 10.0, "text": "안녕"}]
        chunks = planner.plan_chunks("short", 1200.0, segments)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]["start_sec"], 0.0)
        self.assertEqual(chunks[0]["end_sec"], 1200.0)

    def test_long_video_plan_does_not_overlap(self) -> None:
        segments = [
            {"start": float(second), "duration": 1.0, "text": "말"}
            for second in range(0, 6664, 10)
        ]
        chunks = planner.plan_chunks("long", 6663.0, segments)
        self.assertGreaterEqual(len(chunks), 2)
        previous_end = 0.0
        for index, chunk in enumerate(chunks):
            self.assertEqual(chunk["chunk_index"], index)
            self.assertGreaterEqual(chunk["start_sec"], previous_end)
            self.assertGreater(chunk["end_sec"], chunk["start_sec"])
            self.assertLessEqual(chunk["end_sec"] - chunk["start_sec"], 6 * 60 * 60)
            previous_end = chunk["end_sec"]
        self.assertEqual(chunks[-1]["end_sec"], 6663.0)
        self.assertTrue(chunks[1]["transcript_text"])


if __name__ == "__main__":
    unittest.main()
