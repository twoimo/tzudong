"""The pipeline API returns run ids intact and still redacts phone numbers."""

from __future__ import annotations

import io
import json
import random
import tempfile
import threading
import time
import unittest
import uuid
from dataclasses import asdict
from email.message import Message
from http.client import HTTPConnection
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from backend.pipeline_control import api
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.state_machine import RunRecord
from backend.utils.privacy_log import REDACTED, redact_log_text, sanitize_log_value

UUID_SEED = 20261116
# The first and second version-4 UUIDs from random.Random(UUID_SEED) that the
# free-text phone redactor rewrites.
FAILED_RUN_ID = "d107033f-3a53-4406-af19-13543470ddb2"
QUEUED_RUN_ID = "236c9b37-b991-48c2-b14a-340a28638282"
PHONES = ("010-1234-5678", "01012345678", "+82 10 1234 5678")


def seeded_uuids(count: int) -> list[str]:
    rng = random.Random(UUID_SEED)
    return [str(uuid.UUID(int=rng.getrandbits(128), version=4)) for _ in range(count)]


def respond(body: dict) -> dict:
    handler = SimpleNamespace(
        headers=Message(),
        wfile=io.BytesIO(),
        send_response=lambda status: None,
        send_header=lambda name, value: None,
        end_headers=lambda: None,
    )
    api._json(handler, 200, body)
    return json.loads(handler.wfile.getvalue())


def run_record(run_id: str, status: str, **fields) -> RunRecord:
    return RunRecord(
        id=run_id,
        target="tzuyang",
        profile="heavy_local",
        status=status,
        idempotency_key=f"seeded-{run_id[:8]}",
        payload_hash="0" * 64,
        actor="admin",
        request_id="seeded",
        lease_until=0.0,
        heartbeat_at=time.time(),
        **fields,
    )


class RunIdResponseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        store_path = Path(temporary.name) / "store.json"
        failed = run_record(FAILED_RUN_ID, "Failed", error_code="adapter_failed")
        queued = run_record(QUEUED_RUN_ID, "Queued")
        queued.lease_until = time.time() + 3600
        store_path.write_text(json.dumps({
            "runs": {run.id: asdict(run) for run in (failed, queued)},
            "locks": {"tzuyang:heavy_local": QUEUED_RUN_ID},
            "audit": [],
            "idempotency": {},
        }), encoding="utf-8")
        self.enterContext(mock.patch.object(api, "STORE", FileStore(path=store_path)))
        self.enterContext(mock.patch.dict("os.environ", {"TZUDONG_PIPELINE_PERSIST": "0"}))
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

    def request(self, method: str, path: str) -> tuple[int, dict]:
        conn = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            conn.request(method, path)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_seeded_run_ids_are_ones_the_phone_redactor_rewrites(self):
        self.assertEqual(seeded_uuids(16)[12], FAILED_RUN_ID)
        self.assertEqual(seeded_uuids(16)[15], QUEUED_RUN_ID)
        for run_id in (FAILED_RUN_ID, QUEUED_RUN_ID):
            self.assertNotEqual(redact_log_text(run_id), run_id)

    def test_run_list_snapshot_and_readback_return_run_ids_intact(self):
        for path in ("/v1/runs", "/v1/targets"):
            with self.subTest(path=path):
                status, body = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual([job["id"] for job in body["jobs"]], [QUEUED_RUN_ID])
                self.assertEqual([run["id"] for run in body["failures"]], [FAILED_RUN_ID])
        status, body = self.request("GET", f"/v1/runs/{FAILED_RUN_ID}")
        self.assertEqual((status, body["id"]), (200, FAILED_RUN_ID))

    def test_control_response_returns_the_run_id_intact(self):
        status, body = self.request("POST", f"/v1/runs/{QUEUED_RUN_ID}/cancel")
        self.assertEqual((status, body["id"], body["status"]), (200, QUEUED_RUN_ID, "Cancelled"))

    def test_no_random_canonical_run_id_is_rewritten(self):
        run_ids = seeded_uuids(20_000)
        self.assertGreater(sum(redact_log_text(run_id) != run_id for run_id in run_ids), 0)
        mangled = []
        for run_id in run_ids:
            body = respond({"id": run_id, "jobs": [{"id": run_id}], "failures": [{"id": run_id}]})
            if {body["id"], body["jobs"][0]["id"], body["failures"][0]["id"]} != {run_id}:
                mangled.append(run_id)
        self.assertEqual(mangled, [])

    def test_phone_numbers_stay_redacted_in_free_text_and_non_canonical_ids(self):
        for phone in PHONES:
            id_lookalikes = (
                phone,
                f"run-{phone}",
                f"{FAILED_RUN_ID} {phone}",
                f"{FAILED_RUN_ID[:24]}{phone.replace(' ', '')}",
                f"{{{FAILED_RUN_ID}}} {phone}",
                f"urn:uuid:{FAILED_RUN_ID} {phone}",
            )
            for value in id_lookalikes:
                with self.subTest(phone=phone, value=value):
                    body = respond({
                        "id": value,
                        "actor": f"운영자 {phone} 연락",
                        "failures": [{"id": value, "error_code": phone}],
                    })
                    self.assertIn(REDACTED, body["id"])
                    self.assertEqual(body["failures"][0]["id"], body["id"])
                    self.assertEqual(body["actor"], f"운영자 {REDACTED} 연락")
                    self.assertEqual(body["failures"][0]["error_code"], REDACTED)
                    self.assertNotIn(phone, json.dumps(body, ensure_ascii=False))

    def test_values_outside_the_canonical_id_contract_keep_free_text_redaction(self):
        for body in (
            {"id": FAILED_RUN_ID.upper()},
            {"id": f" {FAILED_RUN_ID}"},
            {"id": f"{FAILED_RUN_ID}\n"},
            {"id": FAILED_RUN_ID.replace("-", "")},
            {"actor": FAILED_RUN_ID},
            {"request_id": FAILED_RUN_ID},
        ):
            with self.subTest(body=body):
                [(key, value)] = body.items()
                self.assertEqual(respond(body)[key], redact_log_text(value))
                self.assertNotEqual(respond(body)[key], value)

    def test_only_a_canonical_uuid_string_directly_under_the_exact_id_key_is_exempt(self):
        phone_hyphen_run = "010-1234-5678-010-1234-5678-010-1234"
        version_0 = FAILED_RUN_ID[:14] + "0" + FAILED_RUN_ID[15:]
        version_9 = FAILED_RUN_ID[:14] + "9" + FAILED_RUN_ID[15:]
        variant_c = FAILED_RUN_ID[:19] + "c" + FAILED_RUN_ID[20:]
        variant_0 = FAILED_RUN_ID[:19] + "0" + FAILED_RUN_ID[20:]
        cases = [
            ({"id": phone_hyphen_run}, {"id": redact_log_text(phone_hyphen_run)}),
            ({"id": version_0}, {"id": redact_log_text(version_0)}),
            ({"id": version_9}, {"id": redact_log_text(version_9)}),
            ({"id": variant_c}, {"id": redact_log_text(variant_c)}),
            ({"id": variant_0}, {"id": redact_log_text(variant_0)}),
            ({"Id": FAILED_RUN_ID}, {"Id": redact_log_text(FAILED_RUN_ID)}),
            ({"ID": FAILED_RUN_ID}, {"ID": redact_log_text(FAILED_RUN_ID)}),
            ({"_id": FAILED_RUN_ID}, {"_id": redact_log_text(FAILED_RUN_ID)}),
            ({"id": [FAILED_RUN_ID]}, {"id": [redact_log_text(FAILED_RUN_ID)]}),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                self.assertNotEqual(expected, body)
                self.assertEqual(respond(body), expected)
        self.assertNotIn("010-1234-5678", json.dumps(respond({"id": phone_hyphen_run})))

    def test_a_bare_string_is_rejected_as_the_uuid_key_set(self):
        with self.assertRaises(TypeError):
            sanitize_log_value({"i": FAILED_RUN_ID, "d": FAILED_RUN_ID, "": FAILED_RUN_ID}, uuid_keys="id")


if __name__ == "__main__":
    unittest.main()
