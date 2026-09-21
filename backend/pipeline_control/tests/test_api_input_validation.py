"""HTTP regression coverage for fail-closed control-plane request boundaries."""

from __future__ import annotations

import io
import json
import socket
import tempfile
import threading
import unittest
from email.message import Message
from http.client import HTTPConnection
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from backend.pipeline_control import api, queue
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.state_machine import ControlPlaneError


class ApiInputValidationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.store_path = Path(temporary.name) / "store.json"
        self.queue_path = Path(temporary.name) / "queue.jsonl"
        self.store = FileStore(path=self.store_path)
        self.enterContext(mock.patch.object(api, "STORE", self.store))
        self.enterContext(mock.patch.object(queue, "DEFAULT_QUEUE", self.queue_path))
        self.enterContext(mock.patch.dict("os.environ", {
            "TZUDONG_DATA_ENV": "local_db",
            "PIPELINE_CONTROL_DSN": "postgresql://tzudong@127.0.0.1:54322/postgres",
            "TZUDONG_PIPELINE_PERSIST": "0",
        }))
        self.server = api.serve("127.0.0.1", 0)
        self.thread = threading.Thread(
            target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True,
        )
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, method="POST", path="/v1/runs", body=b"", headers=None):
        conn = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def enqueue(self, body):
        return self.request(body=json.dumps(body).encode(), headers={"Idempotency-Key": "input-test-01"})

    def assert_no_mutation(self):
        self.assertFalse(self.store_path.exists())
        self.assertFalse(self.queue_path.exists())
        self.assertEqual(self.store.runs, {})

    def test_invalid_dry_run_types_never_enqueue(self):
        for value in (None, 0, 1, "false", "true", "", [], {}):
            with self.subTest(value=value):
                self.assertEqual(self.enqueue({"target": "tzuyang", "dryRun": value}),
                                 (400, {"error": "dry_run_invalid"}))
                self.assert_no_mutation()

    def test_default_and_explicit_boolean_preserve_store_and_queue_contract(self):
        for index, fields in enumerate(({}, {"dryRun": True}, {"dryRun": False})):
            with self.subTest(fields=fields):
                payload = {"target": "tzuyang", **fields}
                headers = {"Idempotency-Key": f"valid-input-{index}"}
                status, body = self.request(body=json.dumps(payload).encode(), headers=headers)
                self.assertEqual(status, 202)
                replay_status, replay = self.request(body=json.dumps(payload).encode(), headers=headers)
                self.assertEqual((replay_status, replay["id"]), (202, body["id"]))
                persisted = FileStore(path=self.store_path).get(body["id"])
                self.assertIs(persisted.dry_run, fields.get("dryRun", True))
                rows = queue.drain(self.queue_path)
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["id"], body["id"])
                self.assertIs(rows[0]["dry_run"], persisted.dry_run)
                # Release the existing target lease via the supported control path.
                status, cancelled = self.request(path=f"/v1/runs/{body['id']}/cancel")
                self.assertEqual((status, cancelled["status"]), (200, "Cancelled"))

    def test_non_string_idempotency_keys_are_rejected(self):
        for value in (12345678, ["12345678"], {"id": "12345678"}, None):
            with self.subTest(value=value):
                self.assertEqual(self.request(body=json.dumps({
                    "target": "tzuyang", "idempotencyKey": value,
                }).encode()), (400, {"error": "idempotency_key_invalid"}))
                self.assert_no_mutation()

    def test_empty_body_and_unknown_target_remain_bounded(self):
        for payload in (b"", b"{}", b'{"target":"not-admitted"}'):
            with self.subTest(payload=payload):
                self.assertEqual(self.request(body=payload), (400, {"error": "target_not_admitted"}))
                self.assert_no_mutation()

    def test_invalid_json_utf8_and_deep_nesting_are_bounded(self):
        for payload in (b"\xff", b"{", b"[]", b"null", b"[" * 2000 + b"]" * 2000):
            with self.subTest(payload=payload[:10]):
                self.assertEqual(self.request(body=payload), (400, {"error": "invalid_json"}))
                self.assert_no_mutation()

    def test_invalid_and_excessive_lengths_are_rejected(self):
        for length, status, code in (
            ("private-diagnostic", 400, "invalid_content_length"),
            ("-1", 400, "invalid_content_length"),
            ("+2", 400, "invalid_content_length"),
            ("16385", 413, "request_body_too_large"),
            ("9" * 5000, 413, "request_body_too_large"),
        ):
            with self.subTest(length=length[:20]):
                self.assertEqual(self.request(headers={"Content-Length": length}), (status, {"error": code}))
                self.assert_no_mutation()

    def test_ambiguous_framing_closes_connection_without_second_request(self):
        for framing in (
            "Content-Length: 2\r\nContent-Length: 2\r\n",
            "Transfer-Encoding: chunked\r\n",
            "Content-Length: 16385\r\n",
        ):
            with self.subTest(framing=framing):
                request = (
                    "POST /v1/runs HTTP/1.1\r\nHost: localhost\r\n" + framing +
                    "\r\n{}GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n"
                ).encode()
                with socket.create_connection(self.server.server_address, timeout=5) as client:
                    client.sendall(request)
                    chunks = []
                    while chunk := client.recv(4096):
                        chunks.append(chunk)
                response = b"".join(chunks)
                self.assertEqual(response.count(b"HTTP/1.1 "), 1)
                self.assertNotIn(b"200 OK", response)
                self.assert_no_mutation()

    def test_truncated_body_is_rejected_and_closed(self):
        headers = Message()
        headers["Content-Length"] = "10"
        handler = SimpleNamespace(headers=headers, rfile=io.BytesIO(b"{}"), close_connection=False)
        with self.assertRaises(ControlPlaneError) as caught:
            api._read_json(handler)
        self.assertEqual(caught.exception.code, "invalid_json")
        self.assertTrue(handler.close_connection)

    def test_invalid_control_paths_cannot_mutate_an_existing_run(self):
        status, run = self.enqueue({"target": "tzuyang"})
        self.assertEqual(status, 202)
        before = self.store_path.read_bytes()
        for path in ("/pause", "/v1/pause", "/v1/runs//pause",
                     f"/wrong/runs/{run['id']}/pause", f"/v1/runs/{run['id']}/extra/cancel"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path=path), (404, {"error": "not_found"}))
                self.assertEqual(self.store_path.read_bytes(), before)

    def test_permission_failures_return_bounded_service_error(self):
        for method, path in (("GET", "/v1/runs"), ("POST", "/v1/runs")):
            with self.subTest(method=method), mock.patch.object(
                api, "current_store", side_effect=PermissionError("private-path-diagnostic"),
            ):
                payload = b'{"target":"tzuyang"}' if method == "POST" else b""
                self.assertEqual(self.request(method, path, payload,
                                              {"Idempotency-Key": "permission01"}),
                                 (503, {"error": "control_plane_io_failed"}))
                self.assert_no_mutation()

    def test_corrupt_store_returns_bounded_failure_and_preserves_bytes(self):
        self.store_path.write_text("private-corrupt-store", encoding="utf-8")
        before = self.store_path.read_bytes()
        self.assertEqual(self.request("GET", "/v1/runs"),
                         (500, {"error": "control_plane_invalid_state"}))
        self.assertEqual(self.enqueue({"target": "tzuyang"}),
                         (500, {"error": "control_plane_invalid_state"}))
        self.assertEqual(self.store_path.read_bytes(), before)
        self.assertFalse(self.queue_path.exists())

    def test_unknown_value_error_diagnostics_are_not_exposed(self):
        with mock.patch.object(api, "current_store", side_effect=ValueError("private-provider-detail")):
            self.assertEqual(self.request("GET", "/v1/runs"),
                             (500, {"error": "control_plane_invalid_state"}))


if __name__ == "__main__":
    unittest.main()
