from __future__ import annotations

import asyncio
import os
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import HTTPException
from pydantic import ValidationError

from src import rag_worker


class RagWorkerObservabilityTest(unittest.TestCase):
    def setUp(self) -> None:
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
            self.assertEqual(raised.exception.detail, "required_model_failed:RagWorkerError")

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
        self.assertEqual(counters["test.unknown-rag-error"]["lastError"], "required_model_failed:RagWorkerError")
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

    def test_known_typeerror_fallbacks_are_counted_and_unknown_typeerrors_fail(self) -> None:
        known = TypeError("got an unexpected keyword argument 'device'")
        self.assertTrue(rag_worker._is_unsupported_keyword_error(known, "device"))
        rag_worker._record_compatibility_fallback("test.device_keyword", known)
        counters = rag_worker._worker_counters_snapshot()["compatibilityFallbacks"]
        self.assertEqual(counters["test.device_keyword"]["count"], 1)
        self.assertFalse(rag_worker._is_unsupported_keyword_error(TypeError("shape exploded"), "device"))

    def test_readiness_reports_local_llava_warmup_disabled_without_loading(self) -> None:
        original_remote = rag_worker.REMOTE_LLAVA_WORKER_URL
        original_local_warmup = rag_worker.ALLOW_LOCAL_LLAVA_WARMUP
        rag_worker.REMOTE_LLAVA_WORKER_URL = ""
        rag_worker.ALLOW_LOCAL_LLAVA_WARMUP = False
        try:
            with (
                mock.patch.object(rag_worker, "_load_bge_model", return_value=object()),
                mock.patch.object(rag_worker, "_load_reranker", return_value=object()),
                mock.patch.object(rag_worker, "_ollama_models", return_value=set()),
                mock.patch.object(rag_worker, "_oauth_file_exists", return_value=False),
                mock.patch.object(rag_worker, "_load_llava_components") as load_llava,
            ):
                result = rag_worker._provider_readiness(True)
            llava = next(provider for provider in result.providers if provider.id == rag_worker.LLAVA_MODEL_ID)
            self.assertFalse(llava.ready)
            self.assertEqual(llava.reason, "required_llava_local_warmup_disabled")
            load_llava.assert_not_called()
        finally:
            rag_worker.REMOTE_LLAVA_WORKER_URL = original_remote
            rag_worker.ALLOW_LOCAL_LLAVA_WARMUP = original_local_warmup

    def test_provider_readiness_checks_each_oauth_file_once_and_preserves_state(self) -> None:
        original_remote = rag_worker.REMOTE_LLAVA_WORKER_URL
        original_local_warmup = rag_worker.ALLOW_LOCAL_LLAVA_WARMUP
        rag_worker.REMOTE_LLAVA_WORKER_URL = ""
        rag_worker.ALLOW_LOCAL_LLAVA_WARMUP = False
        gemini_path = "/tmp/rag-worker-gemini-oauth"
        openai_path = "/tmp/rag-worker-openai-oauth"
        try:
            with (
                mock.patch.dict(os.environ, {
                    "GEMINI_OAUTH_FILE": gemini_path,
                    "OPENAI_CODEX_AUTH_FILE": openai_path,
                }),
                mock.patch.object(rag_worker, "_load_bge_model", return_value=object()),
                mock.patch.object(rag_worker, "_load_reranker", return_value=object()),
                mock.patch.object(rag_worker, "_ollama_models", return_value=set()),
                mock.patch.object(
                    rag_worker,
                    "_oauth_file_exists",
                    side_effect=lambda path: path == openai_path,
                ) as oauth_file_exists,
            ):
                result = rag_worker._provider_readiness(True)

            self.assertEqual(
                oauth_file_exists.call_args_list,
                [mock.call(gemini_path), mock.call(openai_path)],
            )
            gemini = next(provider for provider in result.providers if provider.id == "gemini-cli-oauth")
            openai = next(provider for provider in result.providers if provider.id == "openai-codex-oauth")
            self.assertFalse(gemini.ready)
            self.assertEqual(gemini.reason, "required_gemini_oauth_missing")
            self.assertTrue(openai.ready)
            self.assertIsNone(openai.reason)
        finally:
            rag_worker.REMOTE_LLAVA_WORKER_URL = original_remote
            rag_worker.ALLOW_LOCAL_LLAVA_WARMUP = original_local_warmup

    def test_caption_missing_frame_fails_before_local_llava_load(self) -> None:
        original_remote = rag_worker.REMOTE_LLAVA_WORKER_URL
        rag_worker.REMOTE_LLAVA_WORKER_URL = ""
        try:
            with mock.patch.object(rag_worker, "_load_llava_components") as load_llava:
                with self.assertRaises(rag_worker.RagWorkerError) as raised:
                    rag_worker._caption_frames(
                        rag_worker.CaptionRequest(framePaths=["missing-frame-for-test.png"])
                    )
            self.assertEqual(str(raised.exception), "required_llava_frame_missing")
            load_llava.assert_not_called()
        finally:
            rag_worker.REMOTE_LLAVA_WORKER_URL = original_remote

    def test_caption_closes_opened_and_converted_images_when_processor_fails(self) -> None:
        original_remote = rag_worker.REMOTE_LLAVA_WORKER_URL
        rag_worker.REMOTE_LLAVA_WORKER_URL = ""
        opened_image = mock.MagicMock()
        converted_image = mock.Mock()
        opened_image.__enter__.return_value = opened_image
        opened_image.convert.return_value = converted_image
        processor = mock.Mock(side_effect=RuntimeError("processor failed"))
        model = mock.Mock()
        try:
            with tempfile.NamedTemporaryFile(suffix=".png") as frame_file:
                with (
                    mock.patch.object(rag_worker, "_load_llava_components", return_value=(processor, model)),
                    mock.patch("PIL.Image.open", return_value=opened_image),
                    mock.patch.dict(sys.modules, {"torch": mock.Mock()}),
                ):
                    with self.assertRaisesRegex(RuntimeError, "processor failed"):
                        rag_worker._caption_frames(
                            rag_worker.CaptionRequest(framePaths=[frame_file.name])
                        )

            opened_image.__exit__.assert_called_once()
            converted_image.close.assert_called_once()
            self.assertEqual(processor.call_args.kwargs["videos"], [[converted_image]])
        finally:
            rag_worker.REMOTE_LLAVA_WORKER_URL = original_remote


if __name__ == "__main__":
    unittest.main()
