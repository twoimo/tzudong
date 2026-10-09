from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import rag_worker

TOKEN = "boundary-test-capability-00000000000000000000000"
PNG = b"\x89PNG\r\n\x1a\n" + b"approved image fixture"


async def request(path, body, authorization=None, client="127.0.0.1", scheme="http", extra_headers=()):
    messages = []
    received = False

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
        await asyncio.Future()

    async def send(message):
        messages.append(message)

    headers = [(b"content-type", b"application/json"), *extra_headers]
    if authorization is not None:
        headers.append((b"authorization", authorization.encode()))
    await rag_worker.app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": scheme, "path": path, "raw_path": path.encode(),
        "query_string": b"", "headers": headers, "client": (client, 1234), "server": ("worker", 8765)}, receive, send)
    return messages[0]["status"], b"".join(item.get("body", b"") for item in messages)


class RagWorkerBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"STORYBOARD_RAG_WORKER_TOKEN": TOKEN,
            "GEMINI_CREDITS_API_KEY": "provider-only-test-fixture", "STORYBOARD_GEMINI_API_KEY": "", "GEMINI_API_KEY": ""})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.temp = tempfile.TemporaryDirectory(prefix="rag-artifact-boundary-")
        self.addCleanup(self.temp.cleanup)
        # macOS /tmp itself may be a symlink: approve the canonical path instead.
        self.root = Path(self.temp.name).resolve()
        os.environ["STORYBOARD_RAG_FRAME_ROOT"] = str(self.root)
        self.addCleanup(lambda: os.environ.pop("STORYBOARD_RAG_FRAME_ROOT", None))
        self.frame = self.root / "frame.png"
        self.frame.write_bytes(PNG)

    def test_all_paid_endpoints_authenticate_before_validation_or_provider(self):
        with mock.patch.object(rag_worker, "_gemini_call") as paid:
            for path in ("/embed", "/rerank", "/caption"):
                for header in (None, "Bearer wrong", f"Bearer {TOKEN},extra"):
                    status, payload = asyncio.run(request(path, {}, header))
                    self.assertEqual(status, 401)
                    self.assertNotIn(TOKEN.encode(), payload)
            paid.assert_not_called()

    def test_missing_or_reused_capability_fails_closed(self):
        for value in ("", "short", os.environ["GEMINI_CREDITS_API_KEY"]):
            with mock.patch.dict(os.environ, {"STORYBOARD_RAG_WORKER_TOKEN": value}), mock.patch.object(rag_worker, "_gemini_call") as paid:
                self.assertEqual(asyncio.run(request("/embed", {"texts": ["query"]}, f"Bearer {value}"))[0], 503)
                paid.assert_not_called()
        with mock.patch.dict(os.environ, {"GEMINI_CREDITS_API_KEY": TOKEN}):
            self.assertEqual(asyncio.run(request("/embed", {}, f"Bearer {TOKEN}"))[0], 503)

    def test_remote_http_and_spoofed_forwarding_are_rejected_before_paid_work(self):
        with mock.patch.object(rag_worker, "_gemini_call") as paid:
            result = asyncio.run(request("/embed", {"texts": ["query"]}, f"Bearer {TOKEN}", client="192.0.2.10",
                extra_headers=((b"x-forwarded-proto", b"https"), (b"x-forwarded-for", b"127.0.0.1"))))
            self.assertEqual(result[0], 403)
            paid.assert_not_called()

    def test_authorized_loopback_and_direct_https_reach_mock_provider_once(self):
        for client, scheme in (("127.0.0.1", "http"), ("::1", "http"), ("192.0.2.10", "https")):
            rag_worker._WORKLOAD_SEMAPHORES.clear()
            with mock.patch.object(rag_worker, "_gemini_call", return_value={"embeddings": [{"values": [1.0] + [0.0]*1023}]}) as paid:
                status, payload = asyncio.run(request("/embed", {"texts": ["query"]}, f"Bearer {TOKEN}", client, scheme))
                self.assertEqual(status, 200, payload)
                paid.assert_called_once()
                self.assertEqual(json.loads(payload)["fingerprint"], rag_worker.EMBED_FINGERPRINT)

    def test_duplicate_authorization_is_rejected(self):
        status, _ = asyncio.run(request("/embed", {}, f"Bearer {TOKEN}", extra_headers=((b"authorization", f"Bearer {TOKEN}".encode()),)))
        self.assertEqual(status, 401)

    def test_approved_file_reaches_caption_provider_and_preserves_model(self):
        with mock.patch.object(rag_worker, "_gemini_call", return_value={"candidates": [{"content": {"parts": [{"text": "caption"}]}}]}) as paid:
            result = rag_worker._caption_frames(rag_worker.CaptionRequest(framePaths=[str(self.frame)]))
            self.assertEqual(result.frameCount, 1)
            self.assertEqual(result.model, rag_worker.CAPTION_MODEL_ID)
            self.assertEqual(paid.call_args.args[:2], (rag_worker.CAPTION_MODEL_ID, "generateContent"))

    def test_unapproved_paths_and_symlinks_and_hardlinks_fail_before_provider(self):
        outside = self.root.parent / "unapproved-rag-file.png"
        link = self.root / "link.png"
        link.symlink_to(self.frame)
        directory = self.root / "linked-dir"
        directory.symlink_to(self.root, target_is_directory=True)
        hard = self.root / "hard.png"
        os.link(self.frame, hard)
        for path in (str(outside), str(link), str(directory / "frame.png"), str(hard), "frame.png", str(self.root / ".." / self.root.name / "frame.png")):
            with mock.patch.object(rag_worker, "_gemini_call") as paid:
                with self.assertRaises(rag_worker.RagWorkerError):
                    rag_worker._caption_frames(rag_worker.CaptionRequest(framePaths=[path]))
                paid.assert_not_called()

    def test_configured_root_symlink_is_not_followed(self):
        link = self.root / "root-link"
        link.symlink_to(self.root, target_is_directory=True)
        with mock.patch.dict(os.environ, {"STORYBOARD_RAG_FRAME_ROOT": str(link)}):
            with self.assertRaises(rag_worker.RagWorkerError):
                rag_worker._read_approved_frame(str(link / "frame.png"), 1024)

    def test_missing_root_type_size_special_and_total_size_fail_before_provider(self):
        for root in ("", "relative", "/"):
            with mock.patch.dict(os.environ, {"STORYBOARD_RAG_FRAME_ROOT": root}):
                with self.assertRaises(rag_worker.RagWorkerError):
                    rag_worker._read_approved_frame(str(self.frame), 1024)
        self.frame.write_bytes(b"private content pretending to be a png")
        with self.assertRaises(rag_worker.RagWorkerError):
            rag_worker._read_approved_frame(str(self.frame), 1024)
        self.frame.write_bytes(PNG)
        with self.assertRaises(rag_worker.RagWorkerError):
            rag_worker._read_approved_frame(str(self.frame), len(PNG)-1)
        fifo = self.root / "fifo.png"
        os.mkfifo(fifo)
        with self.assertRaises(rag_worker.RagWorkerError):
            rag_worker._read_approved_frame(str(fifo), 1024)
        self.frame.write_bytes(PNG + b"x" * (5 * 1024 * 1024))
        with mock.patch.object(rag_worker, "_gemini_call") as paid:
            with self.assertRaises(rag_worker.RagWorkerError):
                rag_worker._caption_frames(rag_worker.CaptionRequest(framePaths=[str(self.frame), str(self.frame)]))
            paid.assert_not_called()

    def test_launcher_keeps_loopback_and_disables_forwarded_transport(self):
        with mock.patch.dict(sys.modules, {"uvicorn": types.ModuleType("uvicorn")}):
            spec = importlib.util.spec_from_file_location("rag_launcher", ROOT / "scripts/run_rag_worker.py")
            launcher = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(launcher)
        with mock.patch.dict(os.environ, {"STORYBOARD_RAG_WORKER_TLS_CERT": "", "STORYBOARD_RAG_WORKER_TLS_KEY": ""}):
            self.assertFalse(launcher.listener_options("127.0.0.1")["proxy_headers"])
            with self.assertRaises(SystemExit):
                launcher.listener_options("0.0.0.0")
            with self.assertRaises(SystemExit):
                launcher.listener_options("remote.example")
        with mock.patch.dict(os.environ, {"STORYBOARD_RAG_WORKER_TLS_CERT": "/fixture/cert", "STORYBOARD_RAG_WORKER_TLS_KEY": "/fixture/key"}):
            self.assertFalse(launcher.listener_options("0.0.0.0")["proxy_headers"])


if __name__ == "__main__":
    unittest.main()
