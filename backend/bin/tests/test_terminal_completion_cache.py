import base64
import gzip
import hashlib
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
        self.write(self.paths["meta"], {"duration": 1000})
        self.write(self.paths["transcript"], {"transcript": "public source fixture"})
        self.write(self.paths["marker"], {"is_notSelected": True, "notSelected_reason": "no_restaurants"})

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
        for relative in [self.paths["meta"], self.paths["transcript"], self.paths["marker"]]:
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
                         {self.paths["meta"], self.paths["transcript"], self.paths["marker"]})

    def test_stale_outcome_is_not_exported(self):
        with patch.object(cache, "fresh_ids", return_value=set()):
            self.assertEqual(cache.export_cache(self.source, self.archive, {})["videos"], 0)

    def test_other_terminal_reasons_are_not_exported(self):
        self.write(self.paths["marker"], {"notSelected_reason": "selected"})
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
        for invalid in ["../../outside", "backend/.env", "/absolute", self.paths["meta"] + "/../other"]:
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
        destination = self.target / self.paths["marker"]
        destination.parent.mkdir(parents=True)
        destination.write_text("new local evidence")
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(destination.read_text(), "new local evidence")
        self.assertFalse((self.target / self.paths["meta"]).exists())

    def test_source_symlink_cannot_export_an_unrelated_file(self):
        source = self.source / self.paths["transcript"]
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
        self.write(other_paths["meta"], {"duration": 60})
        self.write(other_paths["marker"], {"notSelected_reason": "shorts:is_shorts_le_180"})
        with patch.object(cache, "fresh_ids", return_value={self.video, other}):
            result = cache.export_cache(self.source, self.archive, {})
            self.assertEqual(result["videos"], 2)
            cap = len(gzip.decompress(self.archive.read_bytes())) - 1
            with patch.object(cache, "MAX_BYTES", cap):
                result = cache.export_cache(self.source, self.archive, {})
            self.assertEqual(result["videos"], 1)
            self.assertLessEqual(len(gzip.decompress(self.archive.read_bytes())), cap)
        self.assertEqual({entry["path"] for entry in self.packet()["files"]},
                         {self.paths["meta"], self.paths["transcript"], self.paths["marker"]})

    def test_visual_source_excludes_whole_video_from_export(self):
        self.write(f"backend/restaurant-crawling/data/tzuyang/visual-location/{self.video}.jsonl",
                   {"evidence": {"visual": [{"texts": ["unexportable visual fixture"]}]}})
        result = self.export()
        self.assertEqual((result["videos"], result["files"], result["skippedVisualInputs"]), (0, 0, 1))

    def test_restore_rejects_visual_ocr_path_before_writing_public_inputs(self):
        self.export()
        packet = self.packet()
        content = json.dumps({"evidence": {"visual": [{"texts": ["unexportable visual fixture"]}]}}).encode()
        packet["files"].append({"path": f"backend/restaurant-crawling/data/tzuyang/visual-location/{self.video}.jsonl",
                                "content": base64.b64encode(content).decode(),
                                "sha256": hashlib.sha256(content).hexdigest()})
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(list(self.target.rglob("*")), [])

    def test_shorts_transport_only_metadata_and_marker_despite_stale_other_files(self):
        self.write(self.paths["marker"], {"notSelected_reason": "shorts:is_shorts_le_180"})
        self.write(self.paths["selection"], {"evidence": {"visual": [{"texts": ["old visual fixture"]}]}})
        self.export()
        self.assertEqual({entry["path"] for entry in self.packet()["files"]},
                         {self.paths["meta"], self.paths["marker"]})

    def test_old_visual_material_excludes_video_even_when_latest_record_is_clean(self):
        self.write(self.paths["crawl"], {"evidence": {"visual": [{"texts": ["old visual fixture"]}]}})
        with (self.source / self.paths["crawl"]).open("a") as output:
            output.write(json.dumps({"restaurants": [], "no_restaurant_reason": "none"}) + "\n")
        self.assertEqual(self.export()["videos"], 0)

    def test_restore_rejects_visual_copy_in_allowed_crawl_path_before_any_writes(self):
        self.export()
        packet = self.packet()
        content = json.dumps({"evidence": {"visual": [{"texts": ["old visual fixture"]}]}}).encode()
        packet["files"].append({"path": self.paths["crawl"], "content": base64.b64encode(content).decode(),
                                "sha256": hashlib.sha256(content).hexdigest()})
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(list(self.target.rglob("*")), [])

    def test_visual_symlink_fails_closed_even_when_dangling(self):
        visual = self.source / f"backend/restaurant-crawling/data/tzuyang/visual-location/{self.video}.jsonl"
        visual.parent.mkdir(parents=True)
        visual.symlink_to(self.base / "absent")
        with self.assertRaises(ValueError):
            self.export()
        self.assertFalse(self.archive.exists())

    def test_restore_rejects_unused_short_files_even_if_they_have_no_visual_material(self):
        self.write(self.paths["marker"], {"notSelected_reason": "shorts:is_shorts_le_180"})
        self.export()
        packet = self.packet()
        content = b'{"transcript":"stale unused input"}'
        packet["files"].append({"path": self.paths["transcript"], "content": base64.b64encode(content).decode(),
                                "sha256": hashlib.sha256(content).hexdigest()})
        self.replace_packet(packet)
        with self.assertRaises(ValueError):
            cache.restore_cache(self.target, self.archive)
        self.assertEqual(list(self.target.rglob("*")), [])

    def test_all_names_null_cannot_export_ocr_in_extra_restaurant_fields(self):
        for key in ("raw_ocr", "ocr_text"):
            with self.subTest(key=key):
                self.write(self.paths["marker"], {"notSelected_reason": "all_names_null"})
                self.write(self.paths["crawl"], {"restaurants": [{"origin_name": None, key: "visual fixture"}]})
                self.assertEqual(self.export()["videos"], 0)

    def test_duplicate_json_keys_cannot_hide_visual_material_in_transported_bytes(self):
        (self.source / self.paths["transcript"]).write_bytes(b'{"texts":["visual fixture"],"texts":[]}')
        with self.assertRaises(ValueError):
            self.export()
        self.assertFalse(self.archive.exists())


if __name__ == "__main__":
    unittest.main()
