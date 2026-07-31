import hashlib
import importlib.util
import os
import stat
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def _install_optional_dependency_stubs() -> None:
    try:
        import googleapiclient.discovery  # noqa: F401
    except ImportError:
        googleapiclient = types.ModuleType("googleapiclient")
        discovery = types.ModuleType("googleapiclient.discovery")
        discovery.build = lambda *args, **kwargs: None
        googleapiclient.discovery = discovery
        sys.modules["googleapiclient"] = googleapiclient
        sys.modules["googleapiclient.discovery"] = discovery

    try:
        import openai  # noqa: F401
    except ImportError:
        openai = types.ModuleType("openai")
        openai.OpenAI = type("OpenAI", (), {})
        sys.modules["openai"] = openai


_install_optional_dependency_stubs()
MODULE_PATH = Path(__file__).resolve().parents[1] / "02-collect-meta.py"
SPEC = importlib.util.spec_from_file_location("collect_meta_thumbnail_security", MODULE_PATH)
collect_meta = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = collect_meta
SPEC.loader.exec_module(collect_meta)


JPEG_FIXTURE = b"\xff\xd8\xfffixture-01"
PNG_FIXTURE = b"\x89PNG\r\n\x1a\nfixture"
VALID_URL = "https://i.ytimg.com/vi/abcDEF_1234/maxresdefault.jpg"
VALID_VIDEO_ID = "abcDEF_1234"


class FixtureResponse:
    def __init__(self, *, status_code=200, headers=None, chunks=()):
        self.status_code = status_code
        self.headers = headers or {"Content-Type": "image/jpeg"}
        self._chunks = chunks
        self.closed = False
        self.iterated = False

    def iter_content(self, *, chunk_size, decode_unicode=False):
        self.iterated = True
        yield from self._chunks

    def close(self):
        self.closed = True


class CollectMetaThumbnailSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.channel_dir = Path(self.tmp.name) / "channel"
        self.channel_dir.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_rejects_redirect_private_and_unallowlisted_urls_without_dispatch(self):
        redirect = FixtureResponse(status_code=302, headers={"Location": "https://i.ytimg.com/next"})
        with patch.object(collect_meta.requests, "get", return_value=redirect) as request_get:
            self.assertIsNone(collect_meta.get_image_hash(VALID_URL))
            request_get.assert_called_once()
            self.assertFalse(request_get.call_args.kwargs["allow_redirects"])
            self.assertTrue(redirect.closed)

        for unsafe_url in (
            "https://127.0.0.1/private.jpg",
            "https://[::1]/private.jpg",
            "https://example.test/image.jpg",
            "http://i.ytimg.com/image.jpg",
            "https://user:password@i.ytimg.com/image.jpg",
            "https://i.ytimg.com:8443/image.jpg",
        ):
            with self.subTest(url=unsafe_url):
                with patch.object(collect_meta.requests, "get") as request_get:
                    self.assertIsNone(collect_meta.get_image_hash(unsafe_url))
                    request_get.assert_not_called()

    def test_enforces_total_deadline_chunk_cap_and_declared_length_cap(self):
        slow = FixtureResponse(chunks=[JPEG_FIXTURE])
        with (
            patch.object(collect_meta.requests, "get", return_value=slow),
            patch.object(collect_meta, "THUMBNAIL_TOTAL_TIMEOUT_SECONDS", 1),
            patch.object(collect_meta.time, "monotonic", side_effect=[0, 0, 2]),
        ):
            self.assertIsNone(collect_meta.get_image_hash(VALID_URL))
            self.assertTrue(slow.closed)

        chunked = FixtureResponse(chunks=[JPEG_FIXTURE, b"over-limit"])
        with (
            patch.object(collect_meta.requests, "get", return_value=chunked),
            patch.object(collect_meta, "THUMBNAIL_MAX_BYTES", len(JPEG_FIXTURE)),
        ):
            self.assertIsNone(collect_meta.get_image_hash(VALID_URL))
            self.assertTrue(chunked.iterated)

        declared_oversize = FixtureResponse(headers={"Content-Type": "image/jpeg", "Content-Length": "14"})
        with (
            patch.object(collect_meta.requests, "get", return_value=declared_oversize),
            patch.object(collect_meta, "THUMBNAIL_MAX_BYTES", len(JPEG_FIXTURE)),
        ):
            self.assertIsNone(collect_meta.get_image_hash(VALID_URL))
            self.assertFalse(declared_oversize.iterated)

    def test_rejects_compressed_wrong_mime_and_wrong_signature_responses(self):
        cases = (
            FixtureResponse(headers={"Content-Type": "image/jpeg", "Content-Encoding": "gzip"}, chunks=[JPEG_FIXTURE]),
            FixtureResponse(headers={"Content-Type": "image/jpeg"}, chunks=[PNG_FIXTURE]),
            FixtureResponse(headers={"Content-Type": "image/gif"}, chunks=[JPEG_FIXTURE]),
            FixtureResponse(headers={"Content-Type": "image/jpeg"}, chunks=[b"not-an-image"]),
        )
        for response in cases:
            with self.subTest(headers=response.headers):
                with patch.object(collect_meta.requests, "get", return_value=response):
                    self.assertIsNone(collect_meta.get_image_hash(VALID_URL))
                    self.assertTrue(response.closed)

    def test_rejects_traversal_and_out_of_range_persistence_identifiers(self):
        unsafe_targets = (
            ("../outside", 0),
            (VALID_VIDEO_ID, -1),
            (VALID_VIDEO_ID, collect_meta.MAX_RECOLLECT_ID + 1),
            (VALID_VIDEO_ID, True),
        )
        for video_id, recollect_id in unsafe_targets:
            with self.subTest(video_id=video_id, recollect_id=recollect_id):
                with patch.object(collect_meta.requests, "get") as request_get:
                    collect_meta.save_thumbnail_file(self.channel_dir, video_id, recollect_id, VALID_URL)
                    request_get.assert_not_called()
                self.assertFalse((self.channel_dir / "thumbnails").exists())

    def test_rejects_thumbnail_directory_symlink_collision(self):
        external_dir = Path(self.tmp.name) / "external"
        external_dir.mkdir()
        thumbnail_dir = self.channel_dir / "thumbnails"
        try:
            os.symlink(external_dir, thumbnail_dir, target_is_directory=True)
        except (NotImplementedError, OSError) as error:
            self.skipTest(f"directory symlinks unavailable: {type(error).__name__}")

        with patch.object(collect_meta.requests, "get") as request_get:
            collect_meta.save_thumbnail_file(self.channel_dir, VALID_VIDEO_ID, 0, VALID_URL)
            request_get.assert_not_called()
        self.assertEqual([], list(external_dir.iterdir()))

    def test_removes_partial_temporary_file_after_stream_failure(self):
        def interrupted_chunks():
            yield JPEG_FIXTURE
            raise RuntimeError("fixture interruption")

        response = FixtureResponse(chunks=interrupted_chunks())
        with patch.object(collect_meta.requests, "get", return_value=response):
            collect_meta.save_thumbnail_file(self.channel_dir, VALID_VIDEO_ID, 0, VALID_URL)

        thumbnail_dir = self.channel_dir / "thumbnails"
        self.assertTrue(thumbnail_dir.is_dir())
        self.assertEqual([], list(thumbnail_dir.iterdir()))

    def test_hashes_and_persists_a_valid_small_image_from_verified_magic(self):
        hash_response = FixtureResponse(chunks=[JPEG_FIXTURE[:4], JPEG_FIXTURE[4:]])
        with patch.object(collect_meta.requests, "get", return_value=hash_response) as request_get:
            self.assertEqual(hashlib.md5(JPEG_FIXTURE).hexdigest(), collect_meta.get_image_hash(VALID_URL))
            self.assertEqual("identity", request_get.call_args.kwargs["headers"]["Accept-Encoding"])
            self.assertTrue(request_get.call_args.kwargs["stream"])

        save_response = FixtureResponse(chunks=[JPEG_FIXTURE])
        with patch.object(collect_meta.requests, "get", return_value=save_response):
            collect_meta.save_thumbnail_file(self.channel_dir, VALID_VIDEO_ID, 0, VALID_URL)

        thumbnail_path = self.channel_dir / "thumbnails" / f"{VALID_VIDEO_ID}-0.jpg"
        self.assertEqual(JPEG_FIXTURE, thumbnail_path.read_bytes())
        if os.name != "nt":
            self.assertEqual(0, stat.S_IMODE(thumbnail_path.stat().st_mode) & 0o077)


if __name__ == "__main__":
    unittest.main()
