"""Pipeline events and index documents keep the top-level run id intact and
still redact phone numbers everywhere else."""

from __future__ import annotations

import hashlib
import json
import random
import time
import unittest
import uuid
from unittest import mock

from backend.pipeline_control import adapter, es_index, events, outbox
from backend.pipeline_control.state_machine import RunRecord
from backend.utils.privacy_log import REDACTED, redact_log_text, sanitize_log_value

UUID_SEED = 20261116
DIGEST_SEED = 20261117
# The first value from each seeded generator that the free-text phone
# redactor rewrites: element 12 of seeded_uuids and element 9 of seeded_digests.
RUN_ID = "d107033f-3a53-4406-af19-13543470ddb2"
PAYLOAD_HASH = "9479d9e89f262cbd8787b7445590800ae0a452426568e9781461fdde1a38cfaf"
# A canonical UUID whose last group spells a mobile number.
PHONE_UUID = "00000000-0000-4000-8000-a01012345678"
PHONES = ("010-1234-5678", "01012345678", "+82 10 1234 5678")


class StrSubclass(str):
    pass


def seeded_uuids(count: int) -> list[str]:
    rng = random.Random(UUID_SEED)
    return [str(uuid.UUID(int=rng.getrandbits(128), version=4)) for _ in range(count)]


def seeded_digests(count: int) -> list[str]:
    rng = random.Random(DIGEST_SEED)
    return [hashlib.sha256(rng.getrandbits(256).to_bytes(32, "big")).hexdigest() for _ in range(count)]


def kafka_event(event: dict) -> dict:
    return json.loads(events.envelope(event))


def log_doc(document: dict) -> dict:
    return es_index.allowlisted_document({"type": "step.progress", **document})


def raw_doc(document: dict) -> dict:
    return es_index.allowlisted_document({"type": "adapter.raw", **document})


BOUNDARIES = {
    "kafka": (kafka_event, "run.lifecycle", events.ENVELOPE_ALLOWLIST),
    "log index": (log_doc, "step.progress", es_index.LOG_ALLOWLIST),
    "raw index": (raw_doc, "adapter.raw", es_index.RAW_ALLOWLIST),
}


def each_field_on_its_own(document: dict, allowlist: frozenset) -> dict:
    return json.loads(json.dumps({
        key: sanitize_log_value(value) for key, value in document.items() if key in allowlist
    }))


class DryRunSinkTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(mock.patch.dict("os.environ", {
            "TZUDONG_PIPELINE_OUTBOX": "memory",
            "TZUDONG_PIPELINE_EVENTS": "",
            "TZUDONG_PIPELINE_ES": "es",
            "TZUDONG_ES_URL": "http://127.0.0.1:9200",
            "TZUDONG_DATA_ENV": "local_db",
        }))
        outbox.reset_memory()
        self.addCleanup(outbox.reset_memory)
        self.indexed: list[tuple[str, dict]] = []
        indexed = self.indexed

        class CapturingClient:
            def __init__(self, _base_url: str) -> None:
                pass

            def index(self, index: str, document: dict) -> None:
                indexed.append((index, document))

        self.enterContext(mock.patch.object(es_index, "_load_es_client", lambda: CapturingClient))

    def test_a_dry_run_sends_the_run_id_intact_to_the_outbox_and_indices(self):
        run = RunRecord(
            id=RUN_ID,
            target="tzuyang",
            profile="heavy_local",
            status="Fetching",
            idempotency_key="seeded-run",
            payload_hash=PAYLOAD_HASH,
            actor="admin",
            request_id=PHONE_UUID,
            lease_until=time.time() + 3600,
            heartbeat_at=time.time(),
        )
        self.assertEqual(adapter.execute_dry_run(run, should_stop=lambda: None), "Succeeded")

        rows = outbox.unpublished_snapshot()
        self.assertTrue(rows)
        self.assertEqual({(row["job_id"], row["payload"]["job_id"]) for row in rows}, {(RUN_ID, RUN_ID)})
        raw = [document for index, document in self.indexed if index == "pipeline-raw-v1"]
        logs = [document for index, document in self.indexed if index == "pipeline-logs-v1"]
        self.assertTrue(raw)
        self.assertTrue(logs)
        self.assertEqual({document["job_id"] for _, document in self.indexed}, {RUN_ID})
        self.assertEqual({document["payload_hash"] for document in raw}, {redact_log_text(PAYLOAD_HASH)})
        self.assertEqual({document["request_id"] for document in raw}, {redact_log_text(PHONE_UUID)})
        self.assertNotIn("01012345678", json.dumps(self.indexed))

    def test_the_kafka_payload_carries_the_run_id_intact(self):
        sent: list[bytes] = []
        with mock.patch.dict("os.environ", {
            "TZUDONG_PIPELINE_OUTBOX": "",
            "TZUDONG_PIPELINE_EVENTS": "kafka",
            "TZUDONG_KAFKA_BOOTSTRAP": "kafka:9092",
        }), mock.patch.object(events, "publish_bytes", lambda _topic, payload: sent.append(payload)):
            events.publish({"type": "run.lifecycle", "job_id": RUN_ID, "status": "Succeeded"})
        self.assertEqual(json.loads(sent[0]), {"type": "run.lifecycle", "job_id": RUN_ID, "status": "Succeeded"})


class EventAndIndexBoundaryTests(unittest.TestCase):
    def test_seeded_values_are_ones_the_phone_redactor_rewrites(self):
        self.assertEqual(seeded_uuids(13)[12], RUN_ID)
        self.assertEqual(seeded_digests(10)[9], PAYLOAD_HASH)
        for value in (RUN_ID, PAYLOAD_HASH, PHONE_UUID):
            self.assertNotEqual(redact_log_text(value), value)

    def test_no_seeded_run_id_is_rewritten(self):
        run_ids = seeded_uuids(20_000)
        self.assertGreater(sum(redact_log_text(run_id) != run_id for run_id in run_ids), 0)
        mangled = [
            run_id for run_id in run_ids
            if {boundary({"type": event_type, "job_id": run_id})["job_id"]
                for boundary, event_type, _ in BOUNDARIES.values()} != {run_id}
        ]
        self.assertEqual(mangled, [])

    def test_every_other_field_is_sanitized_on_its_own_as_before(self):
        documents = (
            {"job_id": RUN_ID, "reason": list(range(150)), "step": "04-frames", "status": "Fetching"},
            {"job_id": RUN_ID, "step": {"a": {"b": {"c": {"d": {"e": {"f": PHONES[0]}}}}}}, "status": "ok"},
            {"step": [{"k": index} for index in range(60)], "job_id": RUN_ID, "request_id": [PHONE_UUID] * 60},
            {"job_id": RUN_ID, "status": {f"k{index}": PHONES[1] for index in range(120)}, "payload_hash": PAYLOAD_HASH},
        )
        for name, (boundary, event_type, allowlist) in BOUNDARIES.items():
            for document in documents:
                with self.subTest(boundary=name, keys=list(document)):
                    document = {"type": event_type, **document}
                    expected = {**each_field_on_its_own(document, allowlist), "job_id": RUN_ID}
                    self.assertEqual(boundary(document), expected)

    def test_phone_numbers_stay_redacted_in_free_text_and_non_canonical_values(self):
        for phone in PHONES:
            lookalikes = (
                phone,
                f"run-{phone}",
                f"{RUN_ID} {phone}",
                f"{RUN_ID[:24]}{phone.replace(' ', '')}",
                f"{PAYLOAD_HASH}{phone}",
            )
            for value in lookalikes:
                with self.subTest(phone=phone, value=value):
                    event = kafka_event({"type": "step.progress", "job_id": value, "reason": f"운영자 {phone} 연락"})
                    raw = raw_doc({"job_id": value, "payload_hash": value, "step": f"운영자 {phone} 연락"})
                    for redacted in (event["job_id"], log_doc({"job_id": value})["job_id"], raw["job_id"], raw["payload_hash"]):
                        self.assertIn(REDACTED, redacted)
                    self.assertEqual(event["reason"], f"운영자 {REDACTED} 연락")
                    self.assertEqual(raw["step"], f"운영자 {REDACTED} 연락")
                    self.assertNotIn(phone, json.dumps([event, raw], ensure_ascii=False))

    def test_caller_chosen_request_ids_keep_free_text_redaction(self):
        for request_id in (PHONE_UUID, RUN_ID, PAYLOAD_HASH):
            for name, (boundary, event_type, _) in BOUNDARIES.items():
                with self.subTest(boundary=name, request_id=request_id):
                    body = boundary({"type": event_type, "request_id": request_id})
                    self.assertEqual(body["request_id"], redact_log_text(request_id))
                    self.assertNotEqual(body["request_id"], request_id)

    def test_the_payload_hash_keeps_free_text_redaction_in_the_raw_index(self):
        self.assertEqual(raw_doc({"payload_hash": PAYLOAD_HASH})["payload_hash"], redact_log_text(PAYLOAD_HASH))
        self.assertEqual(raw_doc({"payload_hash": RUN_ID})["payload_hash"], redact_log_text(RUN_ID))

    def test_a_run_id_nested_under_any_field_keeps_free_text_redaction(self):
        nested = (
            ("reason", {"job_id": RUN_ID}),
            ("step", {"job_id": RUN_ID}),
            ("step", {"a": {"b": {"job_id": RUN_ID}}}),
            ("status", [{"job_id": RUN_ID}]),
            ("request_id", {"job_id": RUN_ID}),
            ("job_id", {"job_id": RUN_ID}),
            ("job_id", [RUN_ID]),
            ("job_id", (RUN_ID,)),
        )
        for name, (boundary, event_type, allowlist) in BOUNDARIES.items():
            for key, value in nested:
                if key not in allowlist:
                    continue
                with self.subTest(boundary=name, key=key, value=value):
                    body = boundary({"type": event_type, key: value})
                    self.assertEqual(body[key], json.loads(json.dumps(sanitize_log_value(value))))
                    self.assertNotIn(RUN_ID, json.dumps(body))

    def test_only_an_exact_string_directly_under_job_id_is_exempt(self):
        cases = [
            ("job_id", "010-1234-5678-010-1234-5678-010-1234"),
            ("job_id", RUN_ID[:14] + "0" + RUN_ID[15:]),
            ("job_id", RUN_ID[:14] + "9" + RUN_ID[15:]),
            ("job_id", RUN_ID[:19] + "c" + RUN_ID[20:]),
            ("job_id", RUN_ID[:19] + "0" + RUN_ID[20:]),
            ("job_id", RUN_ID.upper()),
            ("job_id", PHONE_UUID.upper()),
            ("job_id", f" {RUN_ID}"),
            ("job_id", f"{RUN_ID}\n"),
            ("job_id", f"{{{RUN_ID}}}"),
            ("job_id", f"urn:uuid:{RUN_ID}"),
            ("job_id", RUN_ID.replace("-", "")),
            ("job_id", PAYLOAD_HASH),
            ("job_id", StrSubclass(RUN_ID)),
            ("step", RUN_ID),
            ("status", RUN_ID),
            ("reason", RUN_ID),
            ("target", RUN_ID),
            ("profile", RUN_ID),
        ]
        for name, (boundary, event_type, allowlist) in BOUNDARIES.items():
            for key, value in cases:
                if key not in allowlist:
                    continue
                with self.subTest(boundary=name, key=key, value=value):
                    expected = sanitize_log_value(value)
                    self.assertNotEqual(expected, value)
                    self.assertEqual(boundary({"type": event_type, key: value})[key], expected)


if __name__ == "__main__":
    unittest.main()
