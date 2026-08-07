import importlib.util
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "02-5-cleanup-orphans.py"
SPEC = importlib.util.spec_from_file_location("cleanup_orphans", MODULE_PATH)
cleanup_orphans = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = cleanup_orphans
SPEC.loader.exec_module(cleanup_orphans)


class CleanupOrphansSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.backend = self.root / "backend"
        self.config_path = self.backend / "config" / "channels.yaml"
        self.config_path.parent.mkdir(parents=True)
        self.config_path.write_text(
            "channels:\n"
            "  configured:\n"
            "    channel_id: UCconfigured\n"
            "    data_path: restaurant-crawling/data/configured\n",
            encoding="utf-8",
        )
        self.channel_dir = self.backend / "restaurant-crawling" / "data" / "configured"
        self.transcript_dir = self.channel_dir / "transcript"
        self.meta_dir = self.channel_dir / "meta"
        self.transcript_dir.mkdir(parents=True)
        self.meta_dir.mkdir()
        self.external = self.root / "external-sentinel"
        self.external.mkdir()
        self.patches = [
            patch.object(cleanup_orphans, "BACKEND_ROOT", self.backend),
            patch.object(cleanup_orphans, "CHANNELS_CONFIG_PATH", self.config_path),
        ]
        for active_patch in self.patches:
            active_patch.start()

    def tearDown(self) -> None:
        for active_patch in reversed(self.patches):
            active_patch.stop()
        self.tmp.cleanup()

    def _write_jsonl(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    def _write_orphan(self, name: str = "orphan.jsonl", recollect_id: int = 1) -> Path:
        path = self.transcript_dir / name
        self._write_jsonl(path, {"recollect_id": recollect_id, "text": "sensitive transcript"})
        return path

    def _run(self, *args: str):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = cleanup_orphans.main(["--channel", "configured", *args])
        output = stdout.getvalue()
        document = json.loads(output) if output else None
        return status, document, stderr.getvalue()

    def _preview(self):
        status, document, errors = self._run()
        self.assertEqual(0, status, errors)
        self.assertIsNotNone(document)
        return document, errors

    def test_rejects_traversal_absolute_unc_drive_device_and_control_channels(self):
        sentinel = self._write_orphan()
        unsafe_channels = [
            "../configured",
            "/tmp/configured",
            r"\\server\share",
            r"\\?\C:\configured",
            r"C:\configured",
            "NUL",
            "configured\x01",
        ]

        for channel in unsafe_channels:
            with self.subTest(channel=repr(channel)):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    status = cleanup_orphans.main(["--channel", channel])
                self.assertEqual(1, status)
                self.assertEqual("", stdout.getvalue())
                self.assertIn("code=orphan_cleanup_channel_invalid", stderr.getvalue())
                self.assertTrue(sentinel.exists())

    def test_accepts_only_exact_configured_channel_identifier(self):
        status, document, errors = self._run()
        self.assertEqual(0, status, errors)
        self.assertEqual("configured", document["manifest"]["channel"])

        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = cleanup_orphans.main(["--channel", "not-configured"])
        self.assertEqual(1, status)
        self.assertEqual("", stdout.getvalue())
        self.assertIn("code=orphan_cleanup_channel_unconfigured", stderr.getvalue())

    def test_rejects_external_transcript_symlink_without_touching_sentinel(self):
        sentinel = self.external / "sentinel.jsonl"
        self._write_jsonl(sentinel, {"recollect_id": 99, "text": "do not touch"})
        self.transcript_dir.rmdir()
        try:
            os.symlink(self.external, self.transcript_dir, target_is_directory=True)
        except (NotImplementedError, OSError) as error:
            self.skipTest(f"directory symlinks unavailable: {type(error).__name__}")

        status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_transcript_directory_unsafe", errors)
        self.assertTrue(sentinel.exists())

    def test_default_mode_emits_privacy_minimized_preview_without_deleting(self):
        orphan = self._write_orphan()

        document, errors = self._preview()

        self.assertTrue(orphan.exists())
        self.assertEqual(1, document["manifest"]["version"])
        self.assertEqual(1, len(document["manifest"]["candidates"]))
        candidate = document["manifest"]["candidates"][0]
        self.assertEqual("orphan.jsonl", candidate["name"])
        self.assertEqual("metadata_missing", candidate["reason"])
        self.assertEqual(64, len(candidate["sha256"]))
        self.assertIn("device", candidate["identity"])
        self.assertIn("inode", candidate["identity"])
        self.assertNotIn("sensitive transcript", json.dumps(document))
        self.assertNotIn("sensitive transcript", errors)
        self.assertIn("code=orphan_cleanup_preview_complete", errors)

    def test_apply_rejects_digest_mismatch_without_deleting(self):
        orphan = self._write_orphan()
        self._preview()

        status, _, errors = self._run("--apply", "--preview-digest", "0" * 64)

        self.assertEqual(1, status)
        self.assertTrue(orphan.exists())
        self.assertIn("code=orphan_cleanup_preview_digest_mismatch", errors)

    def test_apply_rejects_mutated_renamed_or_new_preview_candidates(self):
        orphan = self._write_orphan()
        document, _ = self._preview()
        old_digest = document["preview_digest"]

        self._write_jsonl(orphan, {"recollect_id": 2, "text": "changed"})
        status, _, errors = self._run("--apply", "--preview-digest", old_digest)
        self.assertEqual(1, status)
        self.assertTrue(orphan.exists())
        self.assertIn("code=orphan_cleanup_preview_digest_mismatch", errors)

        document, _ = self._preview()
        old_digest = document["preview_digest"]
        renamed = self.transcript_dir / "renamed.jsonl"
        orphan.rename(renamed)
        status, _, errors = self._run("--apply", "--preview-digest", old_digest)
        self.assertEqual(1, status)
        self.assertTrue(renamed.exists())
        self.assertIn("code=orphan_cleanup_preview_digest_mismatch", errors)
        document, _ = self._preview()
        old_digest = document["preview_digest"]
        new_candidate = self._write_orphan("new.jsonl", recollect_id=3)
        status, _, errors = self._run("--apply", "--preview-digest", old_digest)
        self.assertEqual(1, status)
        self.assertTrue(renamed.exists())
        self.assertTrue(new_candidate.exists())
        self.assertIn("code=orphan_cleanup_preview_digest_mismatch", errors)

    def test_apply_deletes_only_exact_digest_bound_preview(self):
        if not cleanup_orphans._supports_no_follow_directory_boundary():
            self.skipTest("platform cannot provide a no-follow directory boundary")

        orphan = self._write_orphan()
        document, _ = self._preview()

        status, _, errors = self._apply_or_skip_if_atomic_quarantine_unavailable(
            document["preview_digest"]
        )

        self.assertEqual(0, status, errors)
        self.assertFalse(orphan.exists())
        self.assertIn("code=orphan_cleanup_apply_complete", errors)


    def _apply_or_skip_if_atomic_quarantine_unavailable(self, preview_digest: str):
        status, document, errors = self._run("--apply", "--preview-digest", preview_digest)
        if "code=orphan_cleanup_quarantine_unavailable" in errors:
            self.skipTest("platform lacks renameat2 no-replace quarantine support")
        return status, document, errors

    def test_rejects_transcript_symlink_and_hardlink_without_reading_target(self):
        sentinel = self.external / "sentinel.jsonl"
        self._write_jsonl(sentinel, {"recollect_id": 99, "text": "do not touch"})

        symlink = self.transcript_dir / "symlink.jsonl"
        try:
            os.symlink(sentinel, symlink)
        except (NotImplementedError, OSError) as error:
            self.skipTest(f"file symlinks unavailable: {type(error).__name__}")

        status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_unsafe", errors)
        self.assertTrue(sentinel.exists())
        symlink.unlink()

        hardlink = self.transcript_dir / "hardlink.jsonl"
        try:
            os.link(sentinel, hardlink)
        except OSError as error:
            self.skipTest(f"hardlinks unavailable: {type(error).__name__}")

        status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_unsafe", errors)
        self.assertTrue(sentinel.exists())

    def test_apply_swap_before_quarantine_restores_replacement_and_deletes_nothing(self):
        if not cleanup_orphans._supports_no_follow_directory_boundary():
            self.skipTest("platform cannot provide a no-follow directory boundary")
        orphan = self._write_orphan()
        document, _ = self._preview()
        original_rename = cleanup_orphans._rename_no_replace
        swapped = False

        def swap_then_rename(directory, source, destination):
            nonlocal swapped
            if not swapped and source == orphan.name:
                replacement = self.transcript_dir / "replacement.tmp"
                self._write_jsonl(replacement, {"recollect_id": 2, "text": "replacement"})
                os.replace(replacement, orphan)
                swapped = True
            return original_rename(directory, source, destination)

        with patch.object(cleanup_orphans, "_rename_no_replace", side_effect=swap_then_rename):
            status, _, errors = self._apply_or_skip_if_atomic_quarantine_unavailable(
                document["preview_digest"]
            )

        self.assertEqual(1, status)
        self.assertIn("code=orphan_cleanup_apply_revalidation_failed", errors)
        self.assertTrue(orphan.exists())
        self.assertIn("replacement", orphan.read_text(encoding="utf-8"))
        self.assertEqual(
            [],
            [path.name for path in self.transcript_dir.iterdir() if path.name.startswith(".orphan-")],
        )

    def test_apply_mismatch_restores_previously_staged_candidates(self):
        if not cleanup_orphans._supports_no_follow_directory_boundary():
            self.skipTest("platform cannot provide a no-follow directory boundary")
        first = self._write_orphan("a.jsonl", recollect_id=1)
        second = self._write_orphan("b.jsonl", recollect_id=2)
        document, _ = self._preview()
        original_rename = cleanup_orphans._rename_no_replace
        swapped = False

        def swap_second_then_rename(directory, source, destination):
            nonlocal swapped
            if not swapped and source == second.name:
                replacement = self.transcript_dir / "replacement.tmp"
                self._write_jsonl(replacement, {"recollect_id": 3, "text": "replacement"})
                os.replace(replacement, second)
                swapped = True
            return original_rename(directory, source, destination)

        with patch.object(cleanup_orphans, "_rename_no_replace", side_effect=swap_second_then_rename):
            status, _, errors = self._apply_or_skip_if_atomic_quarantine_unavailable(
                document["preview_digest"]
            )

        self.assertEqual(1, status)
        self.assertIn("code=orphan_cleanup_apply_revalidation_failed", errors)
        self.assertTrue(first.exists())
        self.assertIn("sensitive transcript", first.read_text(encoding="utf-8"))
        self.assertTrue(second.exists())
        self.assertIn("replacement", second.read_text(encoding="utf-8"))
        self.assertEqual(
            [],
            [path.name for path in self.transcript_dir.iterdir() if path.name.startswith(".orphan-")],
        )

    def test_apply_swap_immediately_before_quarantine_delete_preserves_replacement(self):
        if not cleanup_orphans._supports_no_follow_directory_boundary():
            self.skipTest("platform cannot provide a no-follow directory boundary")
        orphan = self._write_orphan()
        document, _ = self._preview()
        original_unlink = cleanup_orphans.os.unlink
        swapped = False

        def swap_then_unlink(name, *, dir_fd=None):
            nonlocal swapped
            if not swapped and name.startswith(cleanup_orphans.QUARANTINE_NAME_PREFIX):
                self._write_jsonl(orphan, {"recollect_id": 2, "text": "replacement"})
                swapped = True
            return original_unlink(name, dir_fd=dir_fd)

        with patch.object(cleanup_orphans.os, "unlink", side_effect=swap_then_unlink):
            status, _, errors = self._apply_or_skip_if_atomic_quarantine_unavailable(
                document["preview_digest"]
            )

        self.assertEqual(0, status, errors)
        self.assertTrue(orphan.exists())
        self.assertIn("replacement", orphan.read_text(encoding="utf-8"))
        self.assertEqual(
            [],
            [path.name for path in self.transcript_dir.iterdir() if path.name.startswith(".orphan-")],
        )

    def test_apply_quarantine_collision_preserves_existing_file_and_recovers(self):
        if not cleanup_orphans._supports_no_follow_directory_boundary():
            self.skipTest("platform cannot provide a no-follow directory boundary")
        orphan = self._write_orphan()
        document, _ = self._preview()
        collision_name = cleanup_orphans.QUARANTINE_NAME_PREFIX + "collision"
        collision = self.transcript_dir / collision_name
        self._write_jsonl(collision, {"recollect_id": 99, "text": "collision sentinel"})

        with patch.object(
            cleanup_orphans.secrets,
            "token_hex",
            side_effect=["collision", "fresh"],
        ):
            status, _, errors = self._apply_or_skip_if_atomic_quarantine_unavailable(
                document["preview_digest"]
            )

        self.assertEqual(0, status, errors)
        self.assertFalse(orphan.exists())
        self.assertTrue(collision.exists())
        self.assertIn("collision sentinel", collision.read_text(encoding="utf-8"))
        self.assertIn("code=orphan_cleanup_apply_complete", errors)

    def test_rejects_opened_file_size_limit_for_regular_and_sparse_jsonl(self):
        for name, writer in (
            (
                "regular.jsonl",
                lambda path: path.write_bytes(b'{"recollect_id":1,"text":"oversized"}\n'),
            ),
            (
                "sparse.jsonl",
                lambda path: self._write_sparse_jsonl(path),
            ),
        ):
            with self.subTest(name=name):
                path = self.transcript_dir / name
                writer(path)
                with patch.object(cleanup_orphans, "MAX_OPENED_FILE_BYTES", 16):
                    status, document, errors = self._run()
                self.assertEqual(1, status)
                self.assertIsNone(document)
                self.assertIn("code=orphan_cleanup_entry_limits_exceeded", errors)
                self.assertTrue(path.exists())
                path.unlink()

    def _write_sparse_jsonl(self, path: Path) -> None:
        with path.open("wb") as output:
            output.seek(32)
            output.write(b"\n")

    def test_rejects_long_lines_and_excessive_line_count(self):
        long_line = self.transcript_dir / "long.jsonl"
        long_line.write_bytes(b'{"recollect_id":1,"text":"this line is too long"}\n')
        with patch.object(cleanup_orphans, "MAX_JSONL_LINE_BYTES", 16):
            status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_limits_exceeded", errors)
        self.assertTrue(long_line.exists())
        long_line.unlink()

        many_lines = self.transcript_dir / "many.jsonl"
        many_lines.write_bytes(b"{}\n{}\n{}\n")
        with patch.object(cleanup_orphans, "MAX_JSONL_LINES_PER_FILE", 2):
            status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_limits_exceeded", errors)
        self.assertTrue(many_lines.exists())

    def test_rejects_aggregate_parse_byte_and_line_limits(self):
        first = self.transcript_dir / "first.jsonl"
        second = self.transcript_dir / "second.jsonl"
        first.write_bytes(b'{"recollect_id":1}\n')
        second.write_bytes(b'{"recollect_id":2}\n')

        with patch.object(cleanup_orphans, "MAX_AGGREGATE_PARSE_BYTES", 30):
            status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_limits_exceeded", errors)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())

        with patch.object(cleanup_orphans, "MAX_AGGREGATE_PARSE_LINES", 1):
            status, document, errors = self._run()
        self.assertEqual(1, status)
        self.assertIsNone(document)
        self.assertIn("code=orphan_cleanup_entry_limits_exceeded", errors)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
if __name__ == "__main__":
    unittest.main()
