from __future__ import annotations

import asyncio
import os
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path
import sys
import subprocess
import sqlite3
import json

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import HTTPException
from pydantic import ValidationError

from src import rag_worker


class RagWorkerObservabilityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.budget_directory = tempfile.TemporaryDirectory(prefix="rag-shared-budget-test-")
        self.addCleanup(self.budget_directory.cleanup)
        env = mock.patch.dict(os.environ, {"GEMINI_BUDGET_PATH": str(Path(self.budget_directory.name) / "budget.sqlite"),
            "GEMINI_BUDGET_PROJECT": "test-project", "GEMINI_REQUESTS_PER_MINUTE": "100000", "GEMINI_MAX_INFLIGHT": "1"})
        env.start()
        self.addCleanup(env.stop)
        with rag_worker._COUNTER_LOCK:
            rag_worker._WORKLOAD_QUEUED.clear()
            rag_worker._WORKLOAD_INFLIGHT.clear()
            rag_worker._OPERATION_CALLS.clear()
            rag_worker._OPERATION_FAILURES.clear()
            rag_worker._OPERATION_TIMEOUTS.clear()
            rag_worker._OPERATION_QUEUE_TIMEOUTS.clear()
            rag_worker._OPERATION_LAST_ERROR.clear()
            rag_worker._COMPATIBILITY_FALLBACKS.clear()
            rag_worker._COMPATIBILITY_LAST_ERROR.clear()
        rag_worker._WORKLOAD_SEMAPHORES.clear()

    def test_successful_blocking_call_attaches_timings_and_profiles(self) -> None:
        async def run() -> rag_worker.ProviderReadinessResponse:
            return await rag_worker._run_blocking(
                "test.models.peek",
                "models",
                lambda: rag_worker.ProviderReadinessResponse(ready=True, providers=[]),
            )

        result = asyncio.run(run())

        self.assertTrue(result.ready)
        self.assertIsNotNone(result.timings)
        self.assertEqual(result.timings.operation, "test.models.peek")
        self.assertGreaterEqual(result.timings.totalMs, 0)
        self.assertEqual(result.settings["concurrency"]["models"], rag_worker.WORKLOAD_CONCURRENCY_LIMITS["models"])
        self.assertIn("configuredDevice", result.runtimeProfile)
        self.assertIn("processRssMb", result.memoryProfile)
        self.assertEqual(result.counters["operations"]["test.models.peek"]["calls"], 1)
        self.assertEqual(result.counters["operations"]["test.models.peek"]["failures"], 0)

    def test_queue_timeout_is_fail_closed_and_counted(self) -> None:
        original_timeout = rag_worker.QUEUE_TIMEOUT_SECONDS
        original_limit = rag_worker.WORKLOAD_CONCURRENCY_LIMITS.get("test-queue")
        rag_worker.QUEUE_TIMEOUT_SECONDS = 0.01
        rag_worker.WORKLOAD_CONCURRENCY_LIMITS["test-queue"] = 1
        try:
            async def run() -> None:
                first = asyncio.create_task(
                    rag_worker._run_blocking("test.slow", "test-queue", time.sleep, 0.1)
                )
                await asyncio.sleep(0.01)
                with self.assertRaises(HTTPException) as raised:
                    await rag_worker._run_blocking("test.queued", "test-queue", time.sleep, 0.001)
                self.assertEqual(raised.exception.status_code, 503)
                self.assertIn("required_worker_queue_timeout", str(raised.exception.detail))
                await first

            asyncio.run(run())
            counters = rag_worker._worker_counters_snapshot()["operations"]
            self.assertEqual(counters["test.queued"]["queueTimeouts"], 1)
            self.assertEqual(counters["test.queued"]["failures"], 1)
        finally:
            rag_worker.QUEUE_TIMEOUT_SECONDS = original_timeout
            if original_limit is None:
                rag_worker.WORKLOAD_CONCURRENCY_LIMITS.pop("test-queue", None)
            else:
                rag_worker.WORKLOAD_CONCURRENCY_LIMITS["test-queue"] = original_limit
            rag_worker._WORKLOAD_SEMAPHORES.pop("test-queue", None)

    def test_execution_timeout_keeps_capacity_until_worker_finishes(self) -> None:
        original_timeout = rag_worker.DEFAULT_TIMEOUT_SECONDS
        original_queue_timeout = rag_worker.QUEUE_TIMEOUT_SECONDS
        original_limit = rag_worker.WORKLOAD_CONCURRENCY_LIMITS.get("test-timeout")
        rag_worker.DEFAULT_TIMEOUT_SECONDS = 0.01
        rag_worker.QUEUE_TIMEOUT_SECONDS = 0.01
        rag_worker.WORKLOAD_CONCURRENCY_LIMITS["test-timeout"] = 1
        try:
            async def run() -> None:
                with self.assertRaises(HTTPException) as raised:
                    await rag_worker._run_blocking("test.timeout", "test-timeout", time.sleep, 1.2)
                self.assertEqual(raised.exception.status_code, 504)
                self.assertEqual(rag_worker._WORKLOAD_INFLIGHT["test-timeout"], 1)

                with self.assertRaises(HTTPException) as queued:
                    await rag_worker._run_blocking("test.after-timeout", "test-timeout", time.sleep, 0.001)
                self.assertEqual(queued.exception.status_code, 503)

                await asyncio.sleep(1.3)
                self.assertEqual(rag_worker._WORKLOAD_INFLIGHT["test-timeout"], 0)

            asyncio.run(run())
            counters = rag_worker._worker_counters_snapshot()["operations"]
            self.assertEqual(counters["test.timeout"]["timeouts"], 1)
            self.assertEqual(counters["test.timeout"]["failures"], 1)
            self.assertEqual(counters["test.after-timeout"]["queueTimeouts"], 1)
        finally:
            rag_worker.DEFAULT_TIMEOUT_SECONDS = original_timeout
            rag_worker.QUEUE_TIMEOUT_SECONDS = original_queue_timeout
            if original_limit is None:
                rag_worker.WORKLOAD_CONCURRENCY_LIMITS.pop("test-timeout", None)
            else:
                rag_worker.WORKLOAD_CONCURRENCY_LIMITS["test-timeout"] = original_limit
            rag_worker._WORKLOAD_SEMAPHORES.pop("test-timeout", None)

    def test_provider_error_causes_are_counted(self) -> None:
        async def run_known_rag_error() -> None:
            with self.assertRaises(HTTPException) as raised:
                await rag_worker._run_blocking(
                    "test.known-rag-error",
                    "models",
                    lambda: (_ for _ in ()).throw(rag_worker.RagWorkerError("required_bge_model_load_failed")),
                )
            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(raised.exception.detail, "required_bge_model_load_failed")

        async def run_unknown_rag_error() -> None:
            with self.assertRaises(HTTPException) as raised:
                await rag_worker._run_blocking(
                    "test.unknown-rag-error",
                    "models",
                    lambda: (_ for _ in ()).throw(rag_worker.RagWorkerError("required_test_provider_missing")),
                )
            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(raised.exception.detail, "required_model_failed")

        async def run_generic_error() -> None:
            with self.assertRaises(HTTPException) as raised:
                await rag_worker._run_blocking(
                    "test.generic-error",
                    "models",
                    lambda: (_ for _ in ()).throw(ValueError("boom")),
                )
            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(raised.exception.detail, "required_model_failed:ValueError")

        asyncio.run(run_known_rag_error())
        asyncio.run(run_unknown_rag_error())
        asyncio.run(run_generic_error())
        counters = rag_worker._worker_counters_snapshot()["operations"]
        self.assertEqual(counters["test.known-rag-error"]["lastError"], "required_bge_model_load_failed")
        self.assertEqual(counters["test.unknown-rag-error"]["lastError"], "required_model_failed")
        self.assertEqual(counters["test.generic-error"]["lastError"], "required_model_failed:ValueError")

    def test_request_models_reject_empty_and_invalid_inputs(self) -> None:
        with self.assertRaises(ValidationError):
            rag_worker.EmbedRequest(texts=[])
        with self.assertRaises(ValidationError):
            rag_worker.EmbedRequest(texts=["   "])
        with self.assertRaises(ValidationError):
            rag_worker.RerankCandidate(id="candidate", content="   ")
        with self.assertRaises(ValidationError):
            rag_worker.RerankRequest(query="", candidates=[
                rag_worker.RerankCandidate(id="candidate", content="valid"),
            ])
        with self.assertRaises(ValidationError):
            rag_worker.CaptionRequest(framePaths=[])

    def test_memory_budget_reports_over_budget_warning(self) -> None:
        original_budget = rag_worker.MEMORY_BUDGET_MB
        rag_worker.MEMORY_BUDGET_MB = 1
        try:
            profile = rag_worker._memory_profile()
        finally:
            rag_worker.MEMORY_BUDGET_MB = original_budget
        self.assertEqual(profile["budgetMb"], 1)
        self.assertIn("overBudget", profile)
        self.assertEqual(profile["budgetPolicy"], "warn")

    def test_readiness_is_configuration_only_and_never_calls_provider(self) -> None:
        with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker, "_gemini_call") as call:
            result = rag_worker._provider_readiness(True)
        self.assertTrue(result.ready)
        self.assertEqual([item.id for item in result.providers], [rag_worker.EMBED_MODEL_ID, rag_worker.CAPTION_MODEL_ID])
        call.assert_not_called()

    def test_embedding_checks_count_dimension_and_normalizes(self) -> None:
        with mock.patch.object(rag_worker, "_gemini_call", return_value={"embeddings": [{"values": [2.0] + [0.0]*1023}]}) as call:
            result = rag_worker._encode_texts(rag_worker.EmbedRequest(texts=["test"], task="RETRIEVAL_QUERY"))
        self.assertEqual(result.items[0].dense[0], 1)
        self.assertEqual(result.items[0].sparse, {})
        self.assertEqual(result.fingerprint, rag_worker.EMBED_FINGERPRINT)
        self.assertEqual(call.call_args.args[2]["requests"][0]["taskType"], "RETRIEVAL_QUERY")
        for response in ({"embeddings": []}, {"embeddings": [{"values": [0.0]*1024}]}, {"embeddings": [{"values": [float("nan")]*1024}]}):
            with mock.patch.object(rag_worker, "_gemini_call", return_value=response):
                with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_gemini_response_invalid"):
                    rag_worker._encode_texts(rag_worker.EmbedRequest(texts=["test"]))

    def test_rerank_legacy_content_uses_new_gemini_vectors(self) -> None:
        responses = [{"embeddings": [{"values": [1.0]+[0.0]*1023}]}, {"embeddings": [{"values": [0.0,1.0]+[0.0]*1022}, {"values": [1.0]+[0.0]*1023}]}]
        request = rag_worker.RerankRequest(query="test", candidates=[rag_worker.RerankCandidate(id="old", content="old BGE document", metadata={"preserved":True}), rag_worker.RerankCandidate(id="new", content="new document")])
        with mock.patch.object(rag_worker, "_gemini_call", side_effect=responses) as call:
            result = rag_worker._rerank(request)
        self.assertEqual([item.id for item in result.results], ["new", "old"])
        self.assertTrue(result.results[1].metadata["preserved"])
        self.assertEqual(request.candidates[0].content, "old BGE document")
        self.assertEqual(call.call_count, 2)
        self.assertEqual(result.method, "embedding_cosine")

    def test_reused_query_reduces_search_calls_from_three_to_two_with_identical_rank(self) -> None:
        calls = []
        def http(request, **_kwargs):
            body = json.loads(request.data)
            calls.append(body)
            embeddings = []
            for item in body["requests"]:
                text = item["content"]["parts"][0]["text"]
                values = [1.0]+[0.0]*1023 if text != "unrelated" else [0.0,1.0]+[0.0]*1022
                embeddings.append({"values": values})
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps({"embeddings": embeddings}).encode()
            return response
        candidates = [rag_worker.RerankCandidate(id="old", content="unrelated"), rag_worker.RerankCandidate(id="new", content="relevant")]
        with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen", side_effect=http):
            original = rag_worker._encode_texts(rag_worker.EmbedRequest(texts=["question"], task="RETRIEVAL_QUERY"))
            direct = rag_worker._rerank(rag_worker.RerankRequest(query="question", candidates=candidates))
            self.assertEqual(len(calls), 3)
            calls.clear()
            current = rag_worker._encode_texts(rag_worker.EmbedRequest(texts=["question"], task="RETRIEVAL_QUERY"))
            reused = rag_worker._rerank(rag_worker.RerankRequest(query="question", candidates=candidates,
                queryEmbedding=rag_worker.QueryEmbedding(fingerprint=current.fingerprint, dense=current.items[0].dense)))
            self.assertEqual(len(calls), 2)
        self.assertEqual(direct.model_dump(), reused.model_dump())
        self.assertEqual(original.items[0].dense, current.items[0].dense)
        self.assertEqual([item.id for item in reused.results], ["new", "old"])

    def test_invalid_reused_query_rejects_without_any_provider_call(self) -> None:
        with mock.patch.object(rag_worker.urllib.request, "urlopen") as send:
            for dense in ([1.0], [0.0]*1024, [float("nan")]*1024, [2.0]+[0.0]*1023, [True]+[0.0]*1023):
                with self.assertRaises(ValidationError):
                    rag_worker.RerankRequest(query="test", candidates=[rag_worker.RerankCandidate(id="a", content="test")],
                        queryEmbedding={"fingerprint": rag_worker.EMBED_FINGERPRINT, "dense": dense})
            with self.assertRaises(ValidationError):
                rag_worker.RerankRequest(query="test", candidates=[rag_worker.RerankCandidate(id="a", content="test")],
                    queryEmbedding={"fingerprint": "BAAI/bge-m3", "dense": [1.0]+[0.0]*1023})
            send.assert_not_called()

    def test_response_loss_has_no_retry_or_raw_diagnostic(self) -> None:
        with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen", side_effect=TimeoutError("private payload")) as send:
            with self.assertRaisesRegex(rag_worker.RagWorkerError, "^required_gemini_response_uncertain$"):
                rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
        self.assertEqual(send.call_count, 1)
        self.assertFalse(rag_worker._GEMINI_CALL_LOCK.locked())
        with sqlite3.connect(os.environ["GEMINI_BUDGET_PATH"]) as db:
            self.assertEqual(db.execute("select count(*) from leases").fetchone()[0], 0)
            self.assertEqual({row[0] for row in db.execute("select name from sqlite_master where type='table'")}, {"leases", "pacing", "lease_births"})

    def test_shared_budget_uses_existing_environment_limits(self) -> None:
        with mock.patch.dict(os.environ, {"GEMINI_BUDGET_PROJECT": "existing-project", "GEMINI_REQUESTS_PER_MINUTE": "7", "GEMINI_MAX_INFLIGHT": "2"}):
            budget = rag_worker._DeadlineProjectBudget(time.monotonic() + 1)
        self.assertEqual(budget.scope, "existing-project")
        self.assertEqual(budget.interval, 60 / 7)
        self.assertEqual(budget.concurrency, 2)
        self.assertEqual(str(budget.path), os.environ["GEMINI_BUDGET_PATH"])

    def test_expired_operation_does_not_start_another_paid_call(self) -> None:
        rag_worker._OPERATION_DEADLINE.value = time.monotonic() - 1
        try:
            with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen") as send:
                with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_gemini_response_uncertain"):
                    rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
                send.assert_not_called()
        finally:
            del rag_worker._OPERATION_DEADLINE.value

    def test_shared_live_process_lease_blocks_http_until_release_with_deadline(self) -> None:
        child = subprocess.Popen([sys.executable, "-c", "from backend.utils.provider_budget import ProjectBudget,budget_path; import os,sys; b=ProjectBudget(budget_path(),os.environ['GEMINI_BUDGET_PROJECT'],rpm=100000,concurrency=1); lease=b.acquire(os.getpid()); print('ready',flush=True); sys.stdin.readline(); b.release(lease)"],
            cwd=ROOT.parents[1], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), "ready")
            rag_worker._OPERATION_DEADLINE.value = time.monotonic() + 0.15
            started = time.monotonic()
            with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen") as send:
                with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_provider_budget_timeout"):
                    rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
                send.assert_not_called()
            self.assertLess(time.monotonic() - started, 0.5)
            child.communicate("release\n", timeout=3)
            del rag_worker._OPERATION_DEADLINE.value
            fake = mock.MagicMock()
            fake.__enter__.return_value.read.return_value = b'{"embeddings":[]}'
            with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen", return_value=fake) as send:
                self.assertEqual(rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {}), {"embeddings": []})
                self.assertEqual(send.call_count, 1)
            with sqlite3.connect(os.environ["GEMINI_BUDGET_PATH"]) as db:
                self.assertEqual(db.execute("select count(*) from leases").fetchone()[0], 0)
        finally:
            if hasattr(rag_worker._OPERATION_DEADLINE, "value"):
                del rag_worker._OPERATION_DEADLINE.value
            if child.poll() is None:
                child.communicate("release\n", timeout=3)

    def test_sqlite_busy_wait_also_obeys_operation_deadline(self) -> None:
        rag_worker.ProjectBudget(rag_worker.budget_path(), "test-project", rpm=100000)
        with sqlite3.connect(os.environ["GEMINI_BUDGET_PATH"]) as db:
            db.execute("BEGIN IMMEDIATE")
            rag_worker._OPERATION_DEADLINE.value = time.monotonic() + 0.1
            started = time.monotonic()
            try:
                with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen") as send:
                    with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_provider_budget_unavailable"):
                        rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
                    send.assert_not_called()
                self.assertLess(time.monotonic() - started, 0.5)
            finally:
                del rag_worker._OPERATION_DEADLINE.value
                db.rollback()

    def test_429_persists_shared_cooldown_without_retransmitting(self) -> None:
        failure = rag_worker.urllib.error.HTTPError("https://example.invalid", 429, "private provider detail", {"Retry-After": "3"}, None)
        with mock.patch.dict(os.environ, {"STORYBOARD_GEMINI_API_KEY": "test-key"}), mock.patch.object(rag_worker.urllib.request, "urlopen", side_effect=failure) as send:
            with self.assertRaisesRegex(rag_worker.RagWorkerError, "^required_model_quota_exhausted$"):
                rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
            self.assertEqual(send.call_count, 1)
            rag_worker._OPERATION_DEADLINE.value = time.monotonic() + 0.1
            try:
                with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_provider_budget_timeout"):
                    rag_worker._gemini_call(rag_worker.EMBED_MODEL_ID, "batchEmbedContents", {})
            finally:
                del rag_worker._OPERATION_DEADLINE.value
            self.assertEqual(send.call_count, 1)
        with sqlite3.connect(os.environ["GEMINI_BUDGET_PATH"]) as db:
            self.assertGreater(db.execute("select next from pacing where scope='test-project'").fetchone()[0], time.time())
            self.assertEqual(db.execute("select count(*) from leases").fetchone()[0], 0)
        self.assertFalse(rag_worker._GEMINI_CALL_LOCK.locked())

    def test_invalid_caption_frame_fails_before_provider(self) -> None:
        with mock.patch.object(rag_worker, "_gemini_call") as call:
            with self.assertRaisesRegex(rag_worker.RagWorkerError, "required_gemini_frame_invalid"):
                rag_worker._caption_frames(rag_worker.CaptionRequest(framePaths=["missing-frame-for-test.png"]))
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
