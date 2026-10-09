import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from backend.knowledge_graph import longform_analysis as module


class FakeBudget:
    def __init__(self):
        self.acquired = 0
        self.released = []

    def acquire(self, pid, *, timeout):
        self.acquired += 1
        return "fixture-lease"

    def release(self, lease):
        self.released.append(lease)


class LongformAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = self.root / "state"
        self.config = module.AnalysisConfig("gemini-3.8-flash", 1000, 100, "a" * 64, self.root / "checkout", 30)
        self.budget = FakeBudget()
        self.limits = {"maxVideos": 2, "maxCalls": 2, "maxInputTokens": 2000}
        self.info = {"inventorySha256": "b" * 64}
        self.row = {"videoId": "ABCDEFGHIJK", "durationSeconds": 60, "membership": self.membership(),
                    "titleSha256": module.digest(""), "descriptionSha256": module.digest("")}

    @staticmethod
    def membership(tab="videos"):
        return {"sourceUrl": "https://www.youtube.com/@tzuyang/" + tab,
                "observedAt": "2026-10-04T12:00:00Z", "evidenceSha256": "d" * 64}

    def source_row(self, video="ABCDEFGHIJK", duration=60):
        return {"videoId": video, "durationSeconds": duration,
                "membership": {"videos": self.membership(), "streams": None, "shorts": None}}

    def stream_row(self, video="ZYXWVUTSRQP", duration=7200, status="was_live"):
        return {"videoId": video, "durationSeconds": duration, "liveStatus": status,
                "membership": {"videos": None, "streams": self.membership("streams"), "shorts": None}}

    def inventory(self, rows):
        path = self.root / "inventory.json"
        path.write_text(json.dumps({"schemaVersion": 1, "videos": rows}))
        return path

    def analysis(self, video="ABCDEFGHIJK", duration=60):
        fact = {"text": "공개 식당에서 음식을 소개한다", "kind": "visual", "evidence": [
            {"startSeconds": 2, "endSeconds": 5, "modality": "visual"}], "confidence": .8, "uncertainty": []}
        return {"schemaVersion": 1, "videoId": video,
                "coverage": {"startSeconds": 0, "endSeconds": duration, "complete": True, "limitations": []},
                "summary": [fact], "restaurants": [], "claims": [], "uncertainty": []}

    def report(self, value=None, *, model=None, tokens="42"):
        value = value or self.analysis()
        token_line = "" if tokens is None else f"- **Gemini tokens:** {tokens}\n"
        return ("\n# watch: video report\n\n"
                f"- **Source:** https://www.youtube.com/watch?v={value['videoId']} (URL sent to Google)\n"
                f"- **Engine:** {model or self.config.model} (static clip 00:00–{module._clock(value['coverage']['endSeconds'])})\n"
                f"- **Focus range:** 00:00 → 01:00\n{token_line}\n## Answer (from Gemini)\n\n"
                "_These are Gemini's observations of the video, not frames you viewed yourself. "
                "Relay them as such; rerun with `--engine local` to inspect frames directly._\n\n"
                + json.dumps(value, ensure_ascii=False) + "\n").encode()

    @contextlib.contextmanager
    def execution(self, runner):
        def invoke(**kwargs):
            observation = {"operation": "count", "httpOutcome": "http_success", "responseId": None,
                           "requestSha256": "e" * 64, "usage": module.adapter.usage(None), "countedInputTokens": 10}
            kwargs["observe"](observation)
            observation = {**observation, "operation": "generate", "httpOutcome": "transport_uncertain"}
            kwargs["observe"](observation)
            argv = [module.sys.executable, "-I", "synthetic-adapter", "--question", kwargs["prompt"]]
            for _ in range(2):
                lease = kwargs["budget"].acquire(0, timeout=60)
                kwargs["budget"].release(lease)
            try:
                completed = runner(argv, env={"GEMINI_API_KEY": kwargs["key"], "WATCH_GEMINI_MODEL": kwargs["model"]})
            except subprocess.TimeoutExpired:
                raise module.adapter.AdapterError("WATCH_TRANSPORT_UNCERTAIN") from None
            if completed.returncode:
                raise module.adapter.AdapterError("WATCH_TRANSPORT_UNCERTAIN")
            observation.update(httpOutcome="http_success", responseId="v1_fixture_original", usage=module.adapter.usage(
                module.report_usage(completed.stdout)["rawUsageFields"]))
            kwargs["observe"](observation)
            text = completed.stdout.decode()
            if f"- **Engine:** {kwargs['model']} (" not in text:
                raise module.adapter.AdapterError("WATCH_RESPONSE_MODEL_MISMATCH")
            if "## Answer (from Gemini)" not in text:
                raise module.adapter.AdapterError("WATCH_RESPONSE_INVALID")
            answer = text.split("## Answer (from Gemini)", 1)[1].split("\n\n", 2)[-1].strip()
            return {"text": answer, "observation": observation, "responseSha256": module.hashlib.sha256(completed.stdout).hexdigest()}
        with patch.dict(module.os.environ, {"GEMINI_CREDITS_API_KEY": "fixture-funded-key", "GEMINI_API_KEY": "fixture-other-key"}), \
                patch.object(module, "project_budget", return_value=self.budget), \
                patch.object(module, "verify_checkout", return_value=self.config.checkout / "skills/watch/scripts/watch.py"), \
                patch.object(module.adapter, "invoke", side_effect=invoke) as mocked:
            yield mocked

    @contextlib.contextmanager
    def offline_execution(self):
        with patch.dict(module.os.environ, {}, clear=True), \
                patch.object(module, "project_budget", side_effect=AssertionError("provider SQLite initialized")) as budget, \
                patch.object(module, "verify_checkout", side_effect=AssertionError("watch checkout required")) as checkout, \
                patch.object(module.subprocess, "run", side_effect=AssertionError("provider process invoked")) as process:
            yield
        budget.assert_not_called()
        checkout.assert_not_called()
        process.assert_not_called()

    def test_membership_not_duration_determines_shorts(self):
        short = self.source_row("ZYXWVUTSRQP", 1000)
        short["membership"]["shorts"] = self.membership("shorts")
        rows, info = module.load_inventory(self.inventory([self.source_row(duration=45), short]))
        self.assertEqual([row["videoId"] for row in rows], ["ABCDEFGHIJK"])
        self.assertEqual(info["excludedShorts"], 1)
        for membership in [None, {}, {"videos": self.membership("shorts"), "shorts": None}]:
            row = self.source_row()
            row["membership"] = membership
            with self.assertRaises(module.AnalysisError):
                module.load_inventory(self.inventory([row]))

    def test_duplicate_and_conflicting_inventory_cannot_create_calls(self):
        original = self.source_row()
        rows, info = module.load_inventory(self.inventory([original, original]))
        self.assertEqual((len(rows), info["duplicateRows"]), (1, 1))
        with self.assertRaisesRegex(module.AnalysisError, "IDENTITY_CONFLICT"):
            module.load_inventory(self.inventory([original, self.source_row(duration=61)]))
        also_short = copy.deepcopy(original)
        also_short["membership"]["shorts"] = self.membership("shorts")
        rows, _ = module.load_inventory(self.inventory([original, also_short]))
        self.assertEqual(rows, [])

    def test_completed_streams_are_admitted_separately_regardless_of_duration(self):
        stream = self.stream_row(duration=45)
        rows, info = module.load_inventory(self.inventory([self.source_row(), stream]))
        self.assertEqual([row["kind"] for row in rows], ["video", "completed_stream"])
        self.assertEqual(rows[1]["membership"]["liveStatus"], "was_live")
        self.assertEqual((info["videoTabCount"], info["completedStreamCount"]), (1, 1))
        self.assertEqual(module.make_plan(rows, info, self.state, self.config)["totalDurationSeconds"], 105)
        stream["membership"]["streams"]["liveStatus"] = stream.pop("liveStatus")
        rows, _ = module.load_inventory(self.inventory([stream]))
        self.assertEqual(rows[0]["kind"], "completed_stream")

    def test_active_upcoming_and_processing_streams_are_not_executable(self):
        for status in ("is_live", "is_upcoming", "post_live"):
            with self.subTest(status=status):
                stream = self.stream_row(status=status)
                stream["durationSeconds"] = None  # Unfinished streams need no invented duration.
                rows, info = module.load_inventory(self.inventory([stream]))
                self.assertEqual(rows, [])
                self.assertEqual(info["excludedLiveNotReady"], 1)
                self.assertEqual(info["excludedLiveStatusCounts"][status], 1)
                with self.execution(lambda *a, **k: self.fail("unfinished stream dispatched")) as called:
                    result = module.execute(rows, info, self.state, self.config, self.limits)
                self.assertEqual((called.call_count, result["attempted"]), (0, 0))

    def test_stream_status_and_exact_streams_tab_evidence_are_required(self):
        for status, code in [(None, "STREAM_LIVE_STATUS_REQUIRED"), ("not_live", "STREAM_LIVE_STATUS_INVALID"),
                             ("unknown", "STREAM_LIVE_STATUS_INVALID"), (True, "STREAM_LIVE_STATUS_INVALID")]:
            with self.subTest(status=status), self.assertRaisesRegex(module.AnalysisError, code):
                module.load_inventory(self.inventory([self.stream_row(status=status)]))
        stream = self.stream_row()
        stream["membership"]["streams"] = self.membership("videos")
        with self.assertRaisesRegex(module.AnalysisError, "MEMBERSHIP_EVIDENCE_REQUIRED"):
            module.load_inventory(self.inventory([stream]))
        stream = self.stream_row()
        stream["membership"]["streams"]["liveStatus"] = "is_live"
        with self.assertRaisesRegex(module.AnalysisError, "STREAM_LIVE_STATUS_CONFLICT"):
            module.load_inventory(self.inventory([stream]))

    def test_shorts_exclusion_and_unfinished_stream_status_override_video_membership(self):
        video = self.source_row("ZYXWVUTSRQP")
        stream = self.stream_row(duration=60)
        stream["membership"]["shorts"] = self.membership("shorts")
        rows, info = module.load_inventory(self.inventory([video, stream]))
        self.assertEqual(rows, [])
        self.assertEqual(info["excludedShorts"], 1)
        stream = self.stream_row(duration=60, status="is_live")
        rows, info = module.load_inventory(self.inventory([video, stream]))
        self.assertEqual(rows, [])
        self.assertEqual(info["excludedLiveNotReady"], 1)
        complete = self.stream_row(duration=60)
        rows, info = module.load_inventory(self.inventory([video, complete]))
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["kind"], info["duplicateRows"]), ("completed_stream", 1))

    def test_plan_is_offline_and_never_creates_state(self):
        with patch.object(module.subprocess, "run", side_effect=AssertionError("process invoked")), \
                patch.object(module, "project_budget", side_effect=AssertionError("budget mutated")):
            plan = module.make_plan([self.row], self.info, self.state, self.config, self.limits)
        self.assertIsNone(plan["estimatedInputTokens"])
        self.assertEqual(plan["boundedExecution"]["inputTokenReservationUpper"], 1000)
        self.assertFalse(self.state.exists())

    def test_explicit_official_exact_model_evidence_is_required(self):
        path = self.root / "model.json"
        evidence = {"sourceUrl": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash",
                    "checkedAt": "2026-10-04T12:00:00Z", "model": {
                        "name": "models/gemini-3.8-flash", "inputTokenLimit": 1000, "outputTokenLimit": 100}}
        path.write_text(json.dumps(evidence))
        self.assertEqual(module.load_model_evidence(path, "gemini-3.8-flash", self.root, 30).model, "gemini-3.8-flash")
        with self.assertRaises(module.AnalysisError):
            module.load_model_evidence(path, "gemini-3.7-flash", self.root, 30)
        evidence["sourceUrl"] = "https://untrusted.test/model"
        path.write_text(json.dumps(evidence))
        with self.assertRaisesRegex(module.AnalysisError, "OFFICIAL_SOURCE"):
            module.load_model_evidence(path, "gemini-3.8-flash", self.root, 30)

    def test_adapter_keeps_explicit_model_and_funded_environment(self):
        def runner(argv, **kwargs):
            self.assertIn("untrusted", argv[argv.index("--question") + 1])
            self.assertNotIn("shell", kwargs)
            self.assertEqual(kwargs["env"]["WATCH_GEMINI_MODEL"], "gemini-3.8-flash")
            self.assertEqual(kwargs["env"]["GEMINI_API_KEY"], "fixture-funded-key")
            return subprocess.CompletedProcess(argv, 0, self.report(), b"")
        with self.execution(runner) as called:
            result = module.execute([self.row], self.info, self.state, self.config, self.limits)
            again = module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual(called.call_count, 1)
        self.assertEqual(called.call_args.kwargs["model"], self.config.model)
        self.assertEqual(called.call_args.kwargs["checkout"], self.config.checkout)
        self.assertEqual(called.call_args.kwargs["key"], "fixture-funded-key")
        self.assertEqual((called.call_args.kwargs["start"], called.call_args.kwargs["end"]), (0, 60))
        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(again["reused"], 1)
        self.assertEqual(self.budget.released, ["fixture-lease", "fixture-lease"])
        _, receipt, _ = module.paths(self.state, self.row, self.config)
        payload = module.checked_document(receipt)
        self.assertEqual(payload["usage"]["totalTokens"], 42)
        self.assertIsNone(payload["usage"]["inputTokens"])
        self.assertFalse(payload["costVerified"])
        self.assertNotIn("fixture-funded-key", receipt.read_text())

    def test_timeout_and_changed_config_never_automatically_retry(self):
        def runner(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, 35, output=b"partial private diagnostics")
        with self.execution(runner) as called:
            module.execute([self.row], self.info, self.state, self.config, self.limits)
            module.execute([self.row], self.info, self.state, self.config, self.limits)
            changed = module.AnalysisConfig("gemini-3.7-flash", 1000, 100, "c" * 64, self.config.checkout, 30)
            module.execute([self.row], self.info, self.state, changed, self.limits)
        self.assertEqual(called.call_count, 1)
        _, receipt, _ = module.paths(self.state, module.segment_rows(self.row, self.config)[0], self.config)
        self.assertEqual(module.checked_document(receipt)["code"], "WATCH_TRANSPORT_UNCERTAIN")
        self.assertNotIn("private", receipt.read_text())
        self.assertEqual(module.readback([self.row], self.state, self.config)["unresolved"], 1)

    def test_valid_cache_executes_without_key_checkout_or_provider_budget(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        before = {path: path.read_bytes() for path in self.state.rglob("*.json")}
        self.assertFalse(self.config.checkout.exists())
        with self.offline_execution():
            for batch_id in (None, "cache-only-new-batch"):
                result = module.execute([self.row], self.info, self.state, self.config, self.limits, batch_id=batch_id)
                self.assertEqual(result["code"], "BOUNDED_EXECUTION_COMPLETED")
                self.assertEqual((result["reused"], result["attempted"], result["succeeded"]), (1, 0, 0))
        self.assertEqual({path: path.read_bytes() for path in self.state.rglob("*.json")}, before)
        self.assertEqual(self.budget.acquired, 2)

    def test_new_video_still_requires_funded_key_before_reservation_or_watch(self):
        with self.offline_execution(), self.assertRaisesRegex(module.AnalysisError, "FUNDED_GEMINI_ENV_REQUIRED"):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual(list(self.state.rglob("*.json")), [])

    def test_no_admitted_calls_does_not_initialize_provider_resources(self):
        with self.offline_execution():
            empty = module.execute([], self.info, self.state, self.config, self.limits)
            self.assertEqual((empty["attempted"], empty["blocked"]), (0, 0))
            capped = module.execute([self.row], self.info, self.state, self.config,
                                    {**self.limits, "maxInputTokens": 999})
            self.assertEqual((capped["attempted"], capped["deferredByBudget"]), (0, 1))
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 1, b"", b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        with self.offline_execution():
            blocked = module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual((blocked["attempted"], blocked["blocked"], blocked["code"]), (0, 1, "READBACK_REQUIRED"))

    def test_exit_zero_partial_or_wrong_model_is_not_completion(self):
        for kind in ("partial", "wrong_model", "missing_json"):
            with self.subTest(kind=kind):
                self.state = self.root / kind
                value = self.analysis()
                if kind == "partial":
                    value["coverage"]["complete"] = False
                report = self.report(value, model="gemini-3.7-flash" if kind == "wrong_model" else None)
                if kind == "missing_json":
                    report = b"# watch: video report\npartial evidence"
                with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, report, b"")) as called:
                    result = module.execute([self.row], self.info, self.state, self.config, self.limits)
                    module.execute([self.row], self.info, self.state, self.config, self.limits)
                self.assertEqual(result["succeeded"], 0)
                self.assertEqual(called.call_count, 1)
                if kind == "partial":
                    _, receipt, _ = module.paths(self.state, module.segment_rows(self.row, self.config)[0], self.config)
                    self.assertEqual(module.checked_document(receipt)["usage"]["rawUsageFields"], {"total_tokens": 42})

    def test_invalid_timestamps_and_unverified_facts_are_distinct(self):
        value = self.analysis()
        value["claims"] = [{"text": "확인할 수 없는 주장", "kind": "inference", "confidence": .99, "evidence": [], "uncertainty": ["근거 없음"]}]
        result = module.validate_analysis(value, self.row)
        self.assertEqual(result["claims"][0]["confidence"], 0)
        self.assertFalse(result["claims"][0]["verified"])
        self.assertEqual(result["claims"][0]["evidenceStatus"], "unverified")
        value["summary"][0]["evidence"][0]["endSeconds"] = 61
        with self.assertRaisesRegex(module.AnalysisError, "EVIDENCE_INVALID"):
            module.validate_analysis(value, self.row)

    def test_shared_video_lock_prevents_second_dispatch(self):
        with module.file_lock(self.state / "locks/video-ABCDEFGHIJK.lock"):
            with self.execution(lambda *a, **k: self.fail("provider called")) as called:
                result = module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual(called.call_count, 0)
        self.assertEqual(result["blocked"], 1)

    def test_batch_reservations_survive_restart_and_enforce_all_caps(self):
        rows = [self.row, {**self.row, "videoId": "ZYXWVUTSRQP"}]
        limits = {"maxVideos": 2, "maxCalls": 2, "maxInputTokens": 1000}
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")) as called:
            first = module.execute(rows, self.info, self.state, self.config, limits)
            second = module.execute(rows, self.info, self.state, self.config, limits)
        self.assertEqual(called.call_count, 1)
        self.assertEqual(first["reservations"], second["reservations"])
        self.assertEqual(second["reservations"]["reservedInputTokens"], 1000)
        for cap in ("maxVideos", "maxCalls", "maxInputTokens"):
            bad = {**self.limits, cap: None}
            with self.assertRaisesRegex(module.AnalysisError, "EXPLICIT_EXECUTION_LIMITS_REQUIRED"):
                module.execute(rows, self.info, self.state, self.config, bad)

    def test_corrupt_receipt_or_artifact_blocks_paid_reprocessing(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")) as called:
            module.execute([self.row], self.info, self.state, self.config, self.limits)
            _, receipt, evidence = module.paths(self.state, self.row, self.config)
            evidence.write_text("{incomplete")
            result = module.execute([self.row], self.info, self.state, self.config, self.limits)
            receipt.write_text("{incomplete")
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual(called.call_count, 1)
        self.assertEqual(result["blocked"], 1)

    def test_explicit_readback_recovers_only_complete_local_evidence(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        _, receipt_path, evidence_path = module.paths(self.state, self.row, self.config)
        receipt = module.checked_document(receipt_path)
        receipt.update(state="running", evidenceSha256=None)
        module.atomic_document(receipt_path, receipt)
        with patch.object(module.subprocess, "run", side_effect=AssertionError("provider called")):
            self.assertEqual(module.readback([self.row], self.state, self.config)["recovered"], 1)
        receipt.update(state="running", evidenceSha256=None)
        module.atomic_document(receipt_path, receipt)
        evidence = module.checked_document(evidence_path)
        evidence["analysis"]["coverage"]["complete"] = False
        module.atomic_document(evidence_path, evidence)
        self.assertEqual(module.readback([self.row], self.state, self.config)["unresolved"], 1)

    def test_child_failure_never_persists_provider_diagnostics(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 1, b"Gemini auth: private@example.test", b"secret raw OCR")):
            result = module.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual(result["succeeded"], 0)
        for path in self.state.rglob("*.json"):
            self.assertNotIn("private@example.test", path.read_text())
            self.assertNotIn("secret raw OCR", path.read_text())

    def test_project_quota_values_and_scope_are_not_overridden(self):
        with patch.dict(module.os.environ, {"GEMINI_BUDGET_PROJECT": "existing-project", "GEMINI_REQUESTS_PER_MINUTE": "7", "GEMINI_MAX_INFLIGHT": "2", "GEMINI_BUDGET_PATH": str(self.root / "shared.sqlite")}), \
                patch.object(module, "ProjectBudget") as constructor:
            module.project_budget()
        constructor.assert_called_once_with(self.root / "shared.sqlite", "existing-project", rpm=7, concurrency=2)

    def test_atomic_write_failure_keeps_prior_receipt_and_no_partial_commit(self):
        path = self.root / "receipt.json"
        module.atomic_document(path, {"state": "running"})
        before = path.read_bytes()
        with patch.object(module.os, "replace", side_effect=OSError("local write unavailable")):
            with self.assertRaises(OSError):
                module.atomic_document(path, {"state": "succeeded"})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".pending-*")), [])

    def test_cli_requires_all_caps_and_prints_plan_before_execute(self):
        path = self.inventory([self.source_row()])
        model = self.root / "model.json"
        model.write_text(json.dumps({"sourceUrl": "https://ai.google.dev/api/models", "checkedAt": "2026-10-04T12:00:00Z",
                                     "name": "models/gemini-3.8-flash", "inputTokenLimit": 1000, "outputTokenLimit": 100}))
        argv = ["--inventory", str(path), "--state-dir", str(self.state), "--model", "gemini-3.8-flash", "--model-evidence", str(model)]
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(module, "execute", side_effect=AssertionError("executed")):
            self.assertEqual(module.main(argv), 0)
        self.assertEqual(json.loads(output.getvalue())["phase"], "plan")
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(module.main(argv + ["--execute"]), 2)
        output = io.StringIO()
        def execute(*args, **kwargs):
            self.assertEqual(json.loads(output.getvalue())["phase"], "plan")
            return {"phase": "execution", "code": "READBACK_REQUIRED"}
        with contextlib.redirect_stdout(output), patch.object(module, "execute", side_effect=execute):
            self.assertEqual(module.main(argv + ["--execute", "--max-videos", "1", "--max-calls", "1", "--max-input-tokens", "1000"]), 3)

    def test_partial_membership_and_unknown_usage_are_not_verified(self):
        row = self.source_row()
        row["membership"]["videos"]["complete"] = False
        with self.assertRaisesRegex(module.AnalysisError, "MEMBERSHIP_EVIDENCE_PARTIAL"):
            module.load_inventory(self.inventory([row]))
        _, usage = module.parse_watch_report(self.report(tokens=None), self.row, self.config)
        self.assertEqual(usage["usageCompleteness"], "unavailable")
        self.assertIsNone(usage["inputTokens"])
        self.assertFalse(usage["costVerified"])

    def test_membership_completion_is_optional_but_strictly_boolean_when_present(self):
        for complete in (None, True):
            row = self.source_row()
            if complete is not None:
                row["membership"]["videos"]["complete"] = complete
            rows, _ = module.load_inventory(self.inventory([row]))
            self.assertEqual(len(rows), 1)
            self.assertEqual("complete" in rows[0]["membership"], complete is True)
        for tab in ("videos", "streams", "shorts"):
            for complete in (False, "false", "true", 0, 1, None, [], {}):
                with self.subTest(tab=tab, complete=complete):
                    row = self.stream_row() if tab == "streams" else self.source_row()
                    row["membership"][tab] = {**self.membership(tab), "complete": complete}
                    code = "MEMBERSHIP_EVIDENCE_PARTIAL" if complete is False else "MEMBERSHIP_EVIDENCE_INVALID"
                    with self.offline_execution(), self.assertRaisesRegex(module.AnalysisError, code):
                        module.load_inventory(self.inventory([row]))
        # An exclusion must not hide uncertain evidence in another supplied tab.
        for row in (self.source_row(), self.stream_row(status="is_live")):
            row["membership"]["shorts"] = self.membership("shorts")
            row["membership"]["videos"] = {**self.membership(), "complete": "false"}
            with self.assertRaisesRegex(module.AnalysisError, "MEMBERSHIP_EVIDENCE_INVALID"):
                module.load_inventory(self.inventory([row]))

    def test_full_completion_requires_literal_true_full_range_and_no_limitations(self):
        coverage = self.analysis()["coverage"]
        invalid = [{**coverage, "complete": value} for value in (False, "true", "false", 0, 1, None, [], {})]
        invalid += [{**coverage, "startSeconds": 1}, {**coverage, "endSeconds": 59},
                    {**coverage, "limitations": ["media unavailable"]}]
        for candidate in invalid:
            with self.subTest(coverage=candidate), self.assertRaisesRegex(module.AnalysisError, "ANALYSIS_PARTIAL"):
                module.validate_analysis({**self.analysis(), "coverage": candidate}, self.row)

    def test_uncertain_current_membership_cannot_reuse_or_readback_a_valid_cache(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        before = {path: path.read_bytes() for path in self.state.rglob("*.json")}
        candidates = [{**self.row, "membership": {**self.row["membership"], "complete": value}}
                      for value in (False, "false", "true", 0, 1, None)]
        candidates += [{**self.row, "membership": self.membership("shorts")},
                       {**self.row, "membership": {**self.membership("streams"), "liveStatus": "is_live"}},
                       {**self.row, "liveStatus": "is_upcoming"}]
        with self.offline_execution():
            for row in candidates:
                self.assertEqual(module.make_plan([row], self.info, self.state, self.config)["cache"]["corrupt"], 1)
                result = module.execute([row], self.info, self.state, self.config, self.limits)
                self.assertEqual((result["attempted"], result["reused"], result["blocked"]), (0, 0, 1))
                self.assertEqual(module.readback([row], self.state, self.config)["unresolved"], 1)
        self.assertEqual({path: path.read_bytes() for path in self.state.rglob("*.json")}, before)

    def test_uncertain_saved_membership_blocks_reuse_and_completion_readback(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        _, receipt_path, _ = module.paths(self.state, self.row, self.config)
        receipt = module.checked_document(receipt_path)
        candidates = [{**self.membership(), "complete": value} for value in (False, "false", "true", 0, 1, None)]
        candidates += [None, self.membership("shorts"), {**self.membership("streams"), "liveStatus": "post_live"}]
        with self.offline_execution():
            for membership in candidates:
                for state in ("succeeded", "running"):
                    value = {**receipt, "state": state, "membershipEvidence": membership}
                    module.atomic_document(receipt_path, value)
                    before = receipt_path.read_bytes()
                    result = module.execute([self.row], self.info, self.state, self.config, self.limits)
                    self.assertEqual((result["attempted"], result["reused"], result["blocked"]), (0, 0, 1))
                    self.assertEqual(module.readback([self.row], self.state, self.config)["unresolved"], 1)
                    self.assertEqual(receipt_path.read_bytes(), before)

    def test_fresh_provenance_does_not_repeat_unchanged_video_analysis(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")) as called:
            module.execute([self.row], self.info, self.state, self.config, self.limits)
            fresh = {**self.row, "titleSha256": module.digest("updated title"), "descriptionSha256": module.digest("updated description"),
                     "membership": {**self.row["membership"], "observedAt": "2026-10-05T12:00:00Z", "evidenceSha256": "f" * 64}}
            config = module.AnalysisConfig(self.config.model, 1000, 100, "f" * 64, self.config.checkout, 30)
            result = module.execute([fresh], {"inventorySha256": "e" * 64}, self.state, config, self.limits)
        self.assertEqual(called.call_count, 1)
        self.assertEqual(result["reused"], 1)

    def test_actual_video_model_prompt_and_config_changes_are_not_cache_hits(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        changes = [(self.row | {"videoId": "ZYXWVUTSRQP"}, self.config),
                   (self.row | {"durationSeconds": 61}, self.config),
                   (self.row | {"contentSha256": "e" * 64}, self.config),
                   (self.row, module.AnalysisConfig("gemini-3.7-flash", 1000, 100, "a" * 64, self.config.checkout, 30)),
                   (self.row, module.AnalysisConfig(self.config.model, 1000, 100, "a" * 64, self.config.checkout, 31))]
        with self.offline_execution():
            row, config = changes[0]
            self.assertEqual(module.cached_state(self.state, row, config), "new")
            with self.assertRaisesRegex(module.AnalysisError, "FUNDED_GEMINI_ENV_REQUIRED"):
                module.execute([row], self.info, self.state, config, {**self.limits, "maxCalls": 4})
            for row, config in changes[1:]:
                self.assertEqual(module.cached_state(self.state, row, config), "readback_required")
                result = module.execute([row], self.info, self.state, config, {**self.limits, "maxCalls": 4})
                self.assertEqual((result["attempted"], result["blocked"]), (0, 1))
            with patch.object(module, "PROMPT", module.PROMPT + "\nDifferent analysis request."):
                self.assertEqual(module.cached_state(self.state, self.row, self.config), "readback_required")

    def test_cached_video_newly_marked_short_or_live_is_excluded_before_reuse(self):
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 0, self.report(), b"")):
            module.execute([self.row], self.info, self.state, self.config, self.limits)
        short = self.source_row()
        short["membership"]["shorts"] = self.membership("shorts")
        with self.offline_execution():
            for source in (short, self.stream_row(video=self.row["videoId"], status="is_live")):
                rows, info = module.load_inventory(self.inventory([source]))
                self.assertEqual(rows, [])
                result = module.execute(rows, info, self.state, self.config, self.limits)
                self.assertEqual((result["attempted"], result["reused"]), (0, 0))

    def test_exhausted_budget_does_not_mask_unresolved_previous_call(self):
        limits = {"maxVideos": 1, "maxCalls": 2, "maxInputTokens": 1000}
        with self.execution(lambda argv, **kw: subprocess.CompletedProcess(argv, 1, b"", b"")) as called:
            first = module.execute([self.row], self.info, self.state, self.config, limits)
            second = module.execute([self.row], self.info, self.state, self.config, limits)
        self.assertEqual(called.call_count, 1)
        self.assertEqual(first["code"], "READBACK_REQUIRED")
        self.assertEqual(second["code"], "READBACK_REQUIRED")
        self.assertEqual(second["blocked"], 1)


if __name__ == "__main__":
    unittest.main()
