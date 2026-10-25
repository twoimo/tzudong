import base64
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.bin import terminal_completion_cache as cache


class TerminalCompletionCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source, self.target = self.base / "source", self.base / "target"
        self.source.mkdir()
        self.target.mkdir()
        self.archive = self.base / "cache.json.gz"
        self.video = "abcdefghijk"
        self.paths = cache._paths(self.video)
        self.write(self.paths[0], {"duration": 1000})
        self.write(self.paths[1], {"transcript": "public source fixture"})
        self.write(self.paths[5], {"is_notSelected": True, "notSelected_reason": "no_restaurants"})

    def write(self, relative, value):
        path = self.source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) + "\n", encoding="utf-8")

    def export(self):
        with patch.object(cache, "fresh_ids", return_value={self.video}):
            return cache.export_cache(self.source, self.archive, {})

    def packet(self):
        return json.loads(gzip.decompress(self.archive.read_bytes()))

    def replace_packet(self, packet):
        self.archive.write_bytes(gzip.compress(json.dumps(packet).encode()))

    def test_roundtrip_preserves_exact_public_bytes_and_missing_cache_is_cold(self):
        self.assertEqual(cache.restore_cache(self.target, self.archive)["transportedVideos"], 0)
        self.assertEqual(self.export()["videos"], 1)
        self.assertEqual(cache.restore_cache(self.target, self.archive)["transportedVideos"], 1)
        for relative in [self.paths[0], self.paths[1], self.paths[5]]:
            self.assertEqual((self.source / relative).read_bytes(), (self.target / relative).read_bytes())

    def test_existing_identical_evidence_is_idempotent(self):
        self.export()
        first = cache.restore_cache(self.target, self.archive)
        self.assertEqual(first, cache.restore_cache(self.target, self.archive))

    def test_credentials_logs_and_positive_write_state_are_never_exported(self):
        for relative in ["backend/.env", "backend/log/provider.log", "backend/log/cron/hosted-apply-preview.json",
                         "backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl"]:
            self.write(relative, {"fixture": "must remain local"})
        self.export()
        self.assertEqual({entry["path"] for entry in self.packet()["files"]},
                         {self.paths[0], self.paths[1], self.paths[5]})

    def test_stale_outcome_is_not_exported(self):
        with patch.object(cache, "fresh_ids", return_value=set()):
            self.assertEqual(cache.export_cache(self.source, self.archive, {})["videos"], 0)

    def test_other_terminal_reasons_are_not_exported(self):
        self.write(self.paths[5], {"notSelected_reason": "selected"})
        self.assertEqual(self.export()["videos"], 0)

    def test_late_corruption_rejects_entire_packet_before_any_restore(self):
        self.export()
        packet = self.packet()
        packet["files"][-1]["content"] = base64.b64encode(b"different").decode()
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(list(self.target.rglob("*")), [])

    def test_traversal_and_credential_paths_are_rejected(self):
        self.export()
        for invalid in ["../../outside", "backend/.env", "/absolute", self.paths[0] + "/../other"]:
            with self.subTest(invalid=invalid):
                packet = self.packet()
                packet["files"][0]["path"] = invalid
                self.replace_packet(packet)
                with self.assertRaises(ValueError):
                    cache.restore_cache(self.target, self.archive)

    def test_duplicate_entry_and_invalid_video_are_rejected(self):
        self.export()
        packet = self.packet()
        packet["files"].append(dict(packet["files"][0]))
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        packet["files"].pop()
        packet["videos"] = ["../invalid"]
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)

    def test_local_conflict_preserves_all_existing_evidence(self):
        self.export()
        destination = self.target / self.paths[5]
        destination.parent.mkdir(parents=True)
        destination.write_text("new local evidence")
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(destination.read_text(), "new local evidence")
        self.assertFalse((self.target / self.paths[0]).exists())

    def test_source_symlink_cannot_export_an_unrelated_file(self):
        source = self.source / self.paths[1]
        source.unlink()
        source.symlink_to(self.base / "outside")
        (self.base / "outside").write_text("private local fixture")
        with self.assertRaises(ValueError):
            self.export()
        self.assertFalse(self.archive.exists())

    def test_target_parent_symlink_is_rejected_without_writes(self):
        self.export()
        (self.target / "backend").symlink_to(self.source / "backend", target_is_directory=True)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)

    def test_oversize_file_skips_whole_video(self):
        with patch.object(cache, "MAX_FILE_BYTES", 1):
            result = self.export()
        self.assertEqual((result["videos"], result["files"], result["skippedByBounds"]), (0, 0, 1))

    def test_compressed_bomb_is_bounded_before_parsing(self):
        self.archive.write_bytes(gzip.compress(b" " * 1000))
        with patch.object(cache, "MAX_BYTES", 100):
            with self.assertRaises(ValueError):
                cache.restore_cache(self.target, self.archive)

    def test_total_packet_bound_keeps_complete_videos_without_partial_entries(self):
        other = "mnopqrstuvw"
        other_paths = cache._paths(other)
        self.write(other_paths[0], {"duration": 60})
        self.write(other_paths[5], {"notSelected_reason": "shorts:is_shorts_le_180"})
        with patch.object(cache, "fresh_ids", return_value={self.video, other}):
            result = cache.export_cache(self.source, self.archive, {})
            self.assertEqual(result["videos"], 2)
            cap = len(gzip.decompress(self.archive.read_bytes())) - 1
            with patch.object(cache, "MAX_BYTES", cap):
                result = cache.export_cache(self.source, self.archive, {})
            self.assertEqual(result["videos"], 1)
            self.assertLessEqual(len(gzip.decompress(self.archive.read_bytes())), cap)
        self.assertEqual({entry["path"] for entry in self.packet()["files"]},
                         {self.paths[0], self.paths[1], self.paths[5]})


if __name__ == "__main__":
    unittest.main()
