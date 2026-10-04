"""Exercise the real pinned engine against an in-memory HTTP fixture only."""
import copy
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from backend.knowledge_graph import claude_video_adapter as adapter
from backend.knowledge_graph import longform_analysis as analysis


class Budget:
    def __init__(self):
        self.acquired = self.released = 0

    def acquire(self, pid, *, timeout):
        self.acquired += 1
        return "fixture-lease"

    def release(self, lease):
        self.released += 1


class Response:
    status = 200
    headers = {}

    def __init__(self, value):
        self.data = adapter.canonical(value)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.data


@unittest.skipUnless((analysis.DEFAULT_CHECKOUT / "skills/watch/scripts/gemini.py").is_file(), "pinned claude-video checkout required")
class PinnedAdapterTests(unittest.TestCase):
    def setUp(self):
        self.engine = adapter.load_engine(analysis.DEFAULT_CHECKOUT)
        self.budget = Budget()
        self.requests, self.observations = [], []
        self.reply = {"id": "v1_fixture_original", "model": "gemini-3.8-flash", "status": "completed",
                      "steps": [{"type": "model_output", "content": [{"type": "text", "text": '{"fixture":true}'}]}],
                      "usage": {"total_input_tokens": 50, "total_output_tokens": 10, "total_thought_tokens": 5,
                                "total_cached_tokens": 20, "total_tool_use_tokens": 0, "total_tokens": 65,
                                "diagnostic": "DO_NOT_PERSIST"}}
        self.tokens = 100
        self.kwargs = {"checkout": analysis.DEFAULT_CHECKOUT, "model": "gemini-3.8-flash", "video_id": "ABCDEFGHIJK",
                       "start": 900, "end": 1765.25, "prompt": "Synthetic public video question", "input_limit": 1000,
                       "output_limit": 100, "timeout": 30, "key": "synthetic-never-sent", "budget": self.budget,
                       "observe": lambda value: self.observations.append(copy.deepcopy(value))}

    def transport(self, request, **kwargs):
        self.requests.append((request.method, request.full_url, json.loads(request.data) if request.data else None))
        return Response({"totalTokens": self.tokens} if request.full_url.endswith(":countTokens") else self.reply)

    def run_fixture(self, **overrides):
        with patch.object(adapter, "load_engine", return_value=self.engine), patch.object(self.engine, "urlopen", side_effect=self.transport):
            return adapter.invoke(**{**self.kwargs, **overrides})

    def test_pinned_ask_schema_offsets_usage_and_real_request_body_are_preserved(self):
        original = {p: p.read_bytes() for p in (analysis.DEFAULT_CHECKOUT / "skills/watch/scripts").glob("*.py")}
        with patch.object(self.engine, "ask", wraps=self.engine.ask) as asked:
            result = self.run_fixture()
        self.assertEqual(asked.call_count, 1)
        self.assertEqual([url.rsplit("/", 1)[-1] for _, url, _ in self.requests], ["gemini-3.8-flash:countTokens", "interactions"])
        count, create = [body for _, _, body in self.requests]
        self.assertEqual(create["model"], "gemini-3.8-flash")
        self.assertEqual(create["input"][0]["processing"], {"type": "static", "start_offset": "900s", "end_offset": "1765.25s"})
        self.assertEqual(create["generation_config"], {"max_output_tokens": 100})
        self.assertEqual(create["response_format"], {"type": "text", "mime_type": "application/json", "schema": adapter.schema("ABCDEFGHIJK", 900, 1765.25)})
        parts = count["generateContentRequest"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["videoMetadata"], {"startOffset": "900s", "endOffset": "1765.25s"})
        self.assertEqual(parts[1]["text"], create["input"][1]["text"])
        self.assertEqual(count["generateContentRequest"]["generationConfig"]["responseJsonSchema"], create["response_format"]["schema"])
        self.assertEqual(result["observation"]["requestSha256"], adapter.digest(create))
        self.assertEqual(result["observation"]["usage"]["thinkingTokens"], 5)
        self.assertEqual(result["observation"]["usage"]["usageCompleteness"], "complete")
        self.assertEqual(result["observation"]["responseId"], self.reply["id"])
        self.assertEqual((self.budget.acquired, self.budget.released), (2, 2))
        self.assertEqual({p: p.read_bytes() for p in original}, original)
        self.assertNotIn("DO_NOT_PERSIST", json.dumps(self.observations))

    def test_structural_failure_retains_id_and_usage_before_upstream_formatting(self):
        self.reply["steps"] = []
        with self.assertRaisesRegex(adapter.AdapterError, "WATCH_RESPONSE_INVALID"):
            self.run_fixture()
        last = self.observations[-1]
        self.assertEqual((last["httpOutcome"], last["responseId"], last["usage"]["totalTokens"]),
                         ("http_success", "v1_fixture_original", 65))
        self.assertEqual((self.budget.acquired, self.budget.released), (2, 2))

    def test_missing_id_is_not_a_confirmed_recoverable_completion(self):
        del self.reply["id"]
        with self.assertRaisesRegex(adapter.AdapterError, "WATCH_RESPONSE_ID_REQUIRED"):
            self.run_fixture()
        self.assertIsNone(self.observations[-1]["responseId"])
        self.assertEqual(self.observations[-1]["usage"]["totalTokens"], 65)

    def test_count_over_model_limit_never_submits_generation(self):
        self.tokens = 1001
        with self.assertRaisesRegex(adapter.AdapterError, "WATCH_INPUT_LIMIT_EXCEEDED"):
            self.run_fixture()
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.observations[-1]["countedInputTokens"], 1001)
        self.assertEqual((self.budget.acquired, self.budget.released), (1, 1))

    def test_invalid_count_fails_closed_before_generation(self):
        for value in (True, -1, 1.5, "100", None):
            with self.subTest(value=value):
                self.tokens = value
                self.requests.clear()
                with self.assertRaisesRegex(adapter.AdapterError, "WATCH_COUNT_INVALID"):
                    self.run_fixture()
                self.assertEqual(len(self.requests), 1)

    def test_http_rejection_and_transport_uncertain_are_distinct_and_sanitized(self):
        original = self.transport
        for code in (400, 503, None):
            with self.subTest(code=code):
                self.engine = adapter.load_engine(analysis.DEFAULT_CHECKOUT)
                def rejected(request, **kwargs):
                    if request.full_url.endswith(":countTokens"):
                        return original(request, **kwargs)
                    if code is None:
                        raise TimeoutError("private@example.test raw OCR secret")
                    raise HTTPError(request.full_url, code, "private diagnostics", {}, io.BytesIO(b'{"error":{"message":"private@example.test raw OCR secret"}}'))
                with patch.object(self.engine, "urlopen", side_effect=rejected), patch.object(adapter, "load_engine", return_value=self.engine):
                    with self.assertRaises(adapter.AdapterError):
                        adapter.invoke(**self.kwargs)
                expected = "transport_uncertain" if code is None else "http_rejected" if code == 400 else "http_server_error"
                self.assertEqual(self.observations[-1]["httpOutcome"], expected)
        self.assertNotIn("private", json.dumps(self.observations))
        self.assertNotIn("secret", json.dumps(self.observations))

    def test_original_id_readback_is_only_a_get_and_checks_request_binding(self):
        engine = adapter.load_engine(analysis.DEFAULT_CHECKOUT)
        payload = adapter.request_payload(engine, "gemini-3.8-flash", "ABCDEFGHIJK", 900, 1765.25,
                                          self.kwargs["prompt"], 100)
        result = self.run_fixture(response_id="v1_fixture_original", request_digest=adapter.digest(payload), counted_input_tokens=100)
        self.assertEqual(self.requests, [("GET", adapter.API + "/interactions/v1_fixture_original?include_input=false", None)])
        self.assertEqual(result["text"], '{"fixture":true}')
        self.assertEqual(result["observation"]["countedInputTokens"], 100)
        self.assertEqual((self.budget.acquired, self.budget.released), (1, 1))
        self.requests.clear()
        with self.assertRaisesRegex(adapter.AdapterError, "WATCH_REQUEST_MISMATCH"):
            self.run_fixture(response_id="v1_fixture_original", request_digest="0" * 64)
        self.assertEqual(self.requests, [])

    def test_readback_requires_exact_original_response_id_and_model(self):
        for field, value, code in (("id", "v1_fixture_different", "WATCH_RESPONSE_ID_MISMATCH"),
                                   ("model", "gemini-3.7-flash", "WATCH_RESPONSE_MODEL_MISMATCH"),
                                   ("status", "in_progress", "WATCH_RESPONSE_NOT_COMPLETED")):
            with self.subTest(field=field):
                previous = self.reply[field]
                self.reply[field] = value
                with self.assertRaisesRegex(adapter.AdapterError, code):
                    self.run_fixture(response_id="v1_fixture_original")
                self.assertEqual(self.observations[-1]["responseId"], "v1_fixture_original")
                self.reply[field] = previous

    def test_success_metadata_is_durable_before_lease_release_failure(self):
        def release(lease):
            self.budget.released += 1
            if self.budget.released == 2:
                raise OSError("fixture-release-failure")
        with patch.object(self.budget, "release", side_effect=release), self.assertRaises(OSError):
            self.run_fixture()
        self.assertEqual(self.observations[-1]["responseId"], "v1_fixture_original")
        self.assertEqual(self.observations[-1]["usage"]["totalTokens"], 65)

    def test_response_body_timeout_is_uncertain_after_successful_headers(self):
        class Interrupted(Response):
            def read(self):
                raise TimeoutError("private incomplete body")
        def transport(request, **kwargs):
            return Response({"totalTokens": 100}) if request.full_url.endswith(":countTokens") else Interrupted({})
        with patch.object(self.engine, "urlopen", side_effect=transport), patch.object(adapter, "load_engine", return_value=self.engine):
            with self.assertRaisesRegex(adapter.AdapterError, "WATCH_TRANSPORT_UNCERTAIN"):
                adapter.invoke(**self.kwargs)
        self.assertEqual(self.observations[-1]["httpOutcome"], "transport_uncertain")
        self.assertIsNone(self.observations[-1]["responseId"])


class UsageValidationTests(unittest.TestCase):
    def test_optional_counters_are_not_fabricated_and_bad_values_are_rejected(self):
        partial = adapter.usage({"total_tokens": 73649})
        self.assertEqual(partial["totalTokens"], 73649)
        self.assertIsNone(partial["inputTokens"])
        self.assertIsNone(partial["thinkingTokens"])
        self.assertFalse(partial["costVerified"])
        for value in (True, -1, 1.5, "10", float("nan")):
            with self.subTest(value=value), self.assertRaises(adapter.AdapterError):
                adapter.usage({"total_tokens": value})
        with self.assertRaises(adapter.AdapterError):
            adapter.usage({"total_tokens": 1, "total_input_tokens": 2})
        with self.assertRaises(adapter.AdapterError):
            adapter.usage({"total_tokens": 10, "total_input_tokens": 8, "total_output_tokens": 8})


if __name__ == "__main__":
    unittest.main()
