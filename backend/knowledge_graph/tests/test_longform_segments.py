import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.knowledge_graph import longform_analysis as m
from backend.knowledge_graph.tests.test_claude_video_adapter import Budget


class SegmentExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "state"
        self.config = m.AnalysisConfig("gemini-3.8-flash", 1000, 100, "a" * 64, Path(self.temp.name) / "checkout", 30, 30)
        self.row = {"videoId": "ABCDEFGHIJK", "durationSeconds": 60,
                    "membership": {"sourceUrl": "https://www.youtube.com/@tzuyang/videos", "observedAt": "2026-10-05T00:00:00Z", "evidenceSha256": "d" * 64}}
        self.info = {"inventorySha256": "b" * 64}
        self.limits = {"maxVideos": 1, "maxCalls": 4, "maxInputTokens": 2000}
        self.budget = Budget()
        self.calls = []
        self.scenario = "valid"

    def answer(self, start, end):
        fact = {"text": "공개 식당의 메뉴를 설명한다", "kind": "spoken",
                "evidence": [{"startSeconds": start + 1, "endSeconds": start + 2, "modality": "audio"}],
                "confidence": .8, "uncertainty": []}
        return {"schemaVersion": 1, "videoId": self.row["videoId"],
                "coverage": {"startSeconds": start, "endSeconds": end, "complete": True, "limitations": []},
                "summary": [fact, copy.deepcopy(fact)], "restaurants": [], "claims": [], "uncertainty": []}

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        observed = {"operation": "readback" if kwargs.get("response_id") else "generate", "httpOutcome": "http_success",
                    "responseId": kwargs.get("response_id", f"v1_fixture_{kwargs['start']}"), "requestSha256": "e" * 64,
                    "usage": m.adapter.usage({"total_input_tokens": 100, "total_output_tokens": 10, "total_thought_tokens": 2, "total_tokens": 112}),
                    "countedInputTokens": 100}
        if not kwargs.get("response_id"):
            kwargs["observe"]({**observed, "operation": "count", "responseId": None, "usage": m.adapter.usage(None)})
        if self.scenario == "timeout":
            kwargs["observe"]({**observed, "httpOutcome": "transport_uncertain", "responseId": None})
            raise m.adapter.AdapterError("WATCH_TRANSPORT_UNCERTAIN")
        kwargs["observe"](observed)
        value = self.answer(kwargs["start"], kwargs["end"])
        if self.scenario == "invalid":
            value["summary"][0]["evidence"][0]["startSeconds"] = "00:01"
        return {"text": json.dumps(value), "observation": observed, "responseSha256": m.digest(value)}

    def execute(self, *, config=None, limits=None, batch_id=None, rows=None):
        with patch.dict(m.os.environ, {"GEMINI_API_KEY": "synthetic-key"}), \
                patch.object(m, "verify_checkout"), patch.object(m, "project_budget", return_value=self.budget), \
                patch.object(m.adapter, "invoke", side_effect=self.invoke):
            return m.execute(rows or [self.row], self.info, self.state, config or self.config, limits or self.limits, batch_id=batch_id)

    def predecessor_engine(self):
        return SimpleNamespace(_processing=lambda clip: ({"type": "static"}, None), build_prompt=lambda prompt: prompt)

    def materialize_wire_schema_predecessor(self):
        engine = self.predecessor_engine()
        config_identity = m.wire_schema_predecessor_config(self.config)
        segment_pairs = []
        active_segment_directory = None
        for span in m.segment_rows(self.row, self.config):
            directory, receipt_path, evidence_path = m.paths(self.state, span, self.config)
            active_segment_directory = directory
            receipt, evidence = m.checked_document(receipt_path), m.checked_document(evidence_path)
            observation_path = receipt_path.with_name(receipt_path.name.replace(".receipt.json", ".observation.json"))
            observation = m.checked_document(observation_path)
            contract = m.wire_schema_predecessor_segment_contract(span, self.config, engine)
            observation["requestSha256"] = contract["requestSha256"]
            evidence["identity"], evidence["observation"] = contract["receiptIdentity"], observation
            receipt["identity"] = contract["receiptIdentity"]
            receipt["observationSha256"], receipt["evidenceSha256"] = m.digest(observation), m.digest(evidence)
            _, old_receipt, old_evidence = m._exact_paths(self.state, span, self.config, config_identity)
            old_observation = old_receipt.with_name(old_receipt.name.replace(".receipt.json", ".observation.json"))
            m.atomic_document(old_observation, observation)
            m.atomic_document(old_evidence, evidence)
            m.atomic_document(old_receipt, receipt)
            segment_pairs.append((old_receipt, old_evidence))
        _, active_receipt, active_evidence = m.paths(self.state, self.row, self.config)
        receipt, evidence = m.checked_document(active_receipt), m.checked_document(active_evidence)
        evidence["identity"] = m.identity(self.row, self.config, config_identity=config_identity)
        evidence["segments"] = [{"identity": m.checked_document(evidence_path)["identity"],
                                 "evidenceSha256": m.digest(m.checked_document(evidence_path)),
                                 "receiptSha256": m.digest(m.checked_document(receipt_path))}
                                for receipt_path, evidence_path in segment_pairs]
        receipt["identity"], receipt["evidenceSha256"] = evidence["identity"], m.digest(evidence)
        _, old_receipt, old_evidence = m._exact_paths(self.state, self.row, self.config, config_identity)
        m.atomic_document(old_evidence, evidence)
        m.atomic_document(old_receipt, receipt)
        active_receipt.unlink()
        active_evidence.unlink()
        shutil.rmtree(active_segment_directory)
        return engine, old_receipt, old_evidence, segment_pairs

    def video_snapshot(self):
        root = self.state / "videos" / self.row["videoId"]
        return {path.relative_to(root): path.read_bytes() for path in root.rglob("*.json")}

    def test_failure_receipts_add_only_optional_bounded_status_and_fixed_category(self):
        cases=[(400,"invalid_request"),(401,"authentication"),(403,"authentication"),(429,"rate_limit"),(500,"server_error"),(503,"server_error"),
               (None,"unknown"),(True,"unknown"),("400","unknown"),(99,"unknown"),(600,"unknown")]
        root=self.state
        for index,(value,category) in enumerate(cases):
            with self.subTest(status=value):
                self.state=root/f"status-{index}"
                status=m.adapter.bounded_http_status(value)
                def failed(**kwargs):
                    self.calls.append(kwargs)
                    observed={"operation":"count","httpOutcome":"http_success","responseId":None,"requestSha256":"e"*64,
                              "usage":m.adapter.usage(None),"countedInputTokens":100}
                    kwargs["observe"](observed)
                    outcome="http_rejected" if status is not None and 400<=status<500 else "http_server_error" if status is not None and status>=500 else "transport_uncertain"
                    kwargs["observe"]({**observed,"operation":"generate","httpOutcome":outcome})
                    error=m.adapter.AdapterError("WATCH_HTTP_REJECTED" if outcome=="http_rejected" else "WATCH_TRANSPORT_UNCERTAIN")
                    error.http_status=value
                    error.http_category="private raw diagnostic"
                    raise error
                with patch.dict(m.os.environ,{"GEMINI_API_KEY":"synthetic-key"}),patch.object(m,"verify_checkout"),patch.object(m,"project_budget",return_value=self.budget),patch.object(m.adapter,"invoke",side_effect=failed):
                    before=len(self.calls);m.execute([self.row],self.info,self.state,self.config,self.limits,batch_id="case")
                    m.execute([self.row],self.info,self.state,self.config,self.limits,batch_id="another-case")
                    self.assertEqual(len(self.calls)-before,1)
                _,path,_=m.paths(self.state,m.segment_rows(self.row,self.config)[0],self.config)
                receipt=m.checked_document(path)
                self.assertEqual(receipt['httpCategory'],category)
                if status is None:self.assertNotIn('httpStatus',receipt)
                else:self.assertEqual(receipt['httpStatus'],status)
                self.assertNotIn('private',path.read_text())
                self.assertEqual(m.readback([self.row],self.state,self.config)['unresolved'],1)
        self.state=root

    def test_completed_predecessor_source_drift_never_becomes_a_new_paid_job(self):
        self.execute()
        _,receipt_path,evidence_path=m.paths(self.state,self.row,self.config)
        old=m.checked_document(receipt_path)
        previous={**self.config.identity,'adapterSha256':m.HTTP_STATUS_PREDECESSOR_SOURCES[0],
                  'policySha256':m.HTTP_STATUS_PREDECESSOR_SOURCES[1]}
        old['identity']={**old['identity'],'configSha256':m.digest(previous)}
        prior=receipt_path.parent/(m.digest(old['identity'])+'.receipt.json')
        m.atomic_document(prior,old)
        receipt_path.unlink();evidence_path.unlink()
        original=prior.read_bytes();calls=len(self.calls)
        self.assertEqual(m.cached_state(self.state,self.row,self.config),'readback_required')
        result=self.execute(batch_id='new-source')
        self.assertEqual(result['blocked'],1)
        self.assertEqual(len(self.calls),calls)
        self.assertEqual(prior.read_bytes(),original)
        self.assertEqual(m.readback([self.row],self.state,self.config)['unresolved'],1)
        self.assertEqual(prior.read_bytes(),original)
        self.assertEqual(self.config.identity['adapterSha256'],m.hashlib.sha256(m.Path(m.adapter.__file__).read_bytes()).hexdigest())
        self.assertEqual(self.config.identity['policySha256'],m.hashlib.sha256(m.Path(m.__file__).read_bytes()).hexdigest())

    def test_wire_schema_predecessor_two_segment_success_is_reused_without_writes_or_calls(self):
        self.execute()
        engine, _, _, segment_pairs = self.materialize_wire_schema_predecessor()
        self.assertEqual(len(segment_pairs), 2)
        before, calls = self.video_snapshot(), len(self.calls)
        restarted = m.replace(self.config)
        with patch.object(m, "verify_checkout"), patch.object(m.adapter, "load_engine", return_value=engine), \
                patch.object(m.adapter, "invoke", side_effect=AssertionError("predecessor must not call provider")):
            self.assertEqual(m.cached_state(self.state, self.row, restarted), "reusable")
            plan = m.make_plan([self.row], self.info, self.state, restarted)
            self.assertEqual((plan["cache"]["reusable"], plan["remainingSegments"]), (1, 0))
            first = m.execute([self.row], self.info, self.state, restarted, self.limits, batch_id="predecessor-restart-1")
            second = m.execute([self.row], self.info, self.state, restarted, self.limits, batch_id="predecessor-restart-2")
            duplicate = m.execute([self.row, self.row], self.info, self.state, restarted, self.limits,
                                  batch_id="predecessor-duplicate-queue")
        self.assertEqual((first["attempted"], first["reused"], second["attempted"], second["reused"],
                          duplicate["attempted"], duplicate["reused"]), (0, 1, 0, 1, 0, 2))
        self.assertEqual(len(self.calls), calls)
        self.assertEqual(self.video_snapshot(), before)

    def test_wire_schema_predecessor_missing_duplicate_corrupt_or_lineage_is_readback_required(self):
        self.execute()
        engine, root_receipt, root_evidence, segment_pairs = self.materialize_wire_schema_predecessor()
        original = {path: path.read_bytes() for path in (root_receipt, root_evidence, *[path for pair in segment_pairs for path in pair])}
        first_receipt, first_evidence = segment_pairs[0]
        observation = first_receipt.with_name(first_receipt.name.replace(".receipt.json", ".observation.json"))
        original[observation] = observation.read_bytes()
        with patch.object(m, "verify_checkout"), patch.object(m.adapter, "load_engine", return_value=engine), \
                patch.object(m.adapter, "invoke", side_effect=AssertionError("invalid predecessor must not call provider")):
            first_evidence.unlink()
            self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
            first_evidence.write_bytes(original[first_evidence])

            duplicate = first_receipt.with_name("0" * 64 + ".receipt.json")
            duplicate.write_bytes(first_receipt.read_bytes())
            self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
            duplicate.unlink()

            evidence = m.checked_document(first_evidence)
            evidence["analysis"]["summary"][0]["evidence"][0]["startSeconds"] = "00:01"
            m.atomic_document(first_evidence, evidence)
            receipt = m.checked_document(first_receipt)
            receipt["evidenceSha256"] = m.digest(evidence)
            m.atomic_document(first_receipt, receipt)
            root = m.checked_document(root_evidence)
            root["segments"][0].update(evidenceSha256=m.digest(evidence), receiptSha256=m.digest(receipt))
            m.atomic_document(root_evidence, root)
            root_record = m.checked_document(root_receipt)
            root_record["evidenceSha256"] = m.digest(root)
            m.atomic_document(root_receipt, root_record)
            self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")

            for path, data in original.items():
                path.write_bytes(data)
            root_record = m.checked_document(root_receipt)
            root_record["repairLineageSha256"] = "f" * 64
            m.atomic_document(root_receipt, root_record)
            self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")

    def test_wire_schema_predecessor_drift_and_rejection_never_become_new(self):
        self.execute()
        engine, root_receipt, _, segment_pairs = self.materialize_wire_schema_predecessor()
        before, calls = self.video_snapshot(), len(self.calls)
        changed = [({**self.row, "durationSeconds": 61}, self.config),
                   (self.row, m.replace(self.config, model="gemini-3.7-flash")),
                   (self.row, m.replace(self.config, timeout=31))]
        with patch.object(m, "verify_checkout"), patch.object(m.adapter, "load_engine", return_value=engine), \
                patch.object(m.adapter, "invoke", side_effect=AssertionError("drift must not call provider")):
            for row, config in changed:
                self.assertEqual(m.cached_state(self.state, row, config), "readback_required")
            with patch.object(m, "PROMPT", m.PROMPT + "\nchanged"):
                self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
            with patch.dict(m.WIRE_SCHEMA_PREDECESSOR_SOURCES, {"adapterSha256": "0" * 64}):
                self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
            with patch.object(m.adapter, "schema", return_value={"type": "object"}):
                self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
            rejected = m.checked_document(segment_pairs[0][0])
            rejected.update(state="rejected", code="ANALYSIS_EVIDENCE_INVALID")
            m.atomic_document(segment_pairs[0][0], rejected)
            rejected_before = self.video_snapshot()
            result = m.execute([self.row], self.info, self.state, self.config, self.limits, batch_id="rejected-predecessor")
        self.assertEqual((result["attempted"], result["blocked"]), (0, 1))
        self.assertEqual(len(self.calls), calls)
        self.assertEqual(self.video_snapshot(), rejected_before)
        self.assertNotEqual(rejected_before, before)

    def test_longest_inventory_video_has_bounded_gapless_full_coverage(self):
        row = {**self.row, "durationSeconds": 17653}
        config = m.replace(self.config, input_limit=1048576, segment_seconds=900)
        spans = m.segment_rows(row, config)
        self.assertEqual(len(spans), 20)
        self.assertEqual((spans[0]["segmentStartSeconds"], spans[-1]["segmentEndSeconds"]), (0, 17653))
        self.assertTrue(all(b["segmentStartSeconds"] == a["segmentEndSeconds"] for a, b in zip(spans, spans[1:])))
        self.assertTrue(all(0 < s["segmentEndSeconds"] - s["segmentStartSeconds"] <= 900 for s in spans))
        plan = m.make_plan([row], self.info, self.state, config)
        self.assertEqual(plan["remainingWork"]["callsUpper"], 40)
        self.assertEqual(plan["remainingWork"]["inputTokenReservationUpper"], 20 * 1048576)
        self.assertFalse(self.state.exists())

    def test_all_segment_receipts_bind_full_result_usage_and_absolute_timestamps(self):
        result = self.execute(rows=[self.row, self.row])
        self.assertEqual((result["attempted"], result["succeeded"], result["reused"]), (2, 1, 1))
        self.assertEqual(result["reservations"], {"reservedCalls": 4, "reservedInputTokens": 2000, "reservedOutputTokens": 200})
        _, receipt_path, evidence_path = m.paths(self.state, self.row, self.config)
        receipt, evidence = m.checked_document(receipt_path), m.checked_document(evidence_path)
        self.assertEqual(receipt["callsAttempted"], 4)
        self.assertEqual(len(evidence["segments"]), 2)
        self.assertEqual(evidence["usage"]["totalTokens"], 224)
        self.assertEqual(evidence["usage"]["thinkingTokens"], 4)
        self.assertEqual([fact["evidence"][0]["startSeconds"] for fact in evidence["analysis"]["summary"]], [1, 31])
        self.assertEqual(m.cached_state(self.state, self.row, self.config), "reusable")
        for sidecar in self.state.rglob("*.observation.json"):
            payload = m.checked_document(sidecar)
            self.assertEqual(set(payload), {"operation", "httpOutcome", "responseId", "requestSha256", "usage", "countedInputTokens"})
            self.assertNotIn("공개", sidecar.read_text())
            self.assertNotIn("synthetic-key", sidecar.read_text())

    def test_caps_defer_remaining_segments_and_resume_without_repeating_completed_calls(self):
        limits = {**self.limits, "maxCalls": 2, "maxInputTokens": 1000}
        first = self.execute(limits=limits, batch_id="first")
        self.assertEqual((first["succeeded"], first["deferredByBudget"], len(self.calls)), (0, 1, 1))
        self.assertFalse(m.paths(self.state, self.row, self.config)[2].exists())
        self.execute(limits=limits, batch_id="first")
        self.assertEqual(len(self.calls), 1)
        second = self.execute(limits=limits, batch_id="second")
        self.assertEqual((second["succeeded"], len(self.calls)), (1, 2))
        self.assertEqual([call["start"] for call in self.calls], [0, 30])

    def test_structurally_rejected_result_keeps_id_usage_and_never_resends(self):
        self.scenario = "invalid"
        result = self.execute()
        span = m.segment_rows(self.row, self.config)[0]
        _, path, _ = m.paths(self.state, span, self.config)
        receipt = m.checked_document(path)
        sidecar = m.checked_document(path.with_name(path.name.replace(".receipt.json", ".observation.json")))
        self.assertEqual((receipt["state"], receipt["code"]), ("rejected", "ANALYSIS_EVIDENCE_INVALID"))
        self.assertEqual((sidecar["responseId"], sidecar["usage"]["totalTokens"]), ("v1_fixture_0", 112))
        self.assertEqual(result["code"], "READBACK_REQUIRED")
        for config in (self.config, m.replace(self.config, segment_seconds=20)):
            self.execute(config=config, batch_id="new-config" if config != self.config else "new-batch")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(m.readback([self.row], self.state, self.config)["unresolved"], 1)

    def test_transport_uncertainty_without_id_is_blocked_even_on_provider_readback(self):
        self.scenario = "timeout"
        self.execute()
        _, path, _ = m.paths(self.state, m.segment_rows(self.row, self.config)[0], self.config)
        self.assertEqual(m.checked_document(path)["state"], "uncertain")
        with patch.object(m.adapter, "invoke", side_effect=AssertionError("must not resend")):
            result = m.readback([self.row], self.state, self.config, provider=True, max_calls=1)
        self.assertEqual((result["unresolved"], result["readbackCalls"]), (1, 0))
        self.execute(batch_id="new-batch")
        self.assertEqual(len(self.calls), 1)

    def test_explicit_readback_uses_original_id_then_only_new_segments_may_execute(self):
        self.scenario = "invalid"
        self.execute()
        self.scenario = "valid"
        with patch.dict(m.os.environ, {"GEMINI_API_KEY": "synthetic-key"}), patch.object(m, "verify_checkout"), \
                patch.object(m, "project_budget", return_value=self.budget), patch.object(m.adapter, "invoke", side_effect=self.invoke):
            result = m.readback([self.row], self.state, self.config, provider=True, max_calls=1)
        self.assertEqual((result["unresolved"], result["readbackCalls"]), (1, 1))  # The second segment has not run.
        self.assertEqual(self.calls[-1]["response_id"], "v1_fixture_0")
        self.assertEqual(self.calls[-1]["request_digest"], "e" * 64)
        finished = self.execute(batch_id="after-readback")
        self.assertEqual(finished["succeeded"], 1)
        self.assertEqual([call["start"] for call in self.calls], [0, 0, 30])

    def test_missing_or_corrupt_segment_receipt_cannot_support_full_coverage(self):
        self.execute()
        span = m.segment_rows(self.row, self.config)[1]
        _, receipt, _ = m.paths(self.state, span, self.config)
        receipt.write_text("{broken")
        self.assertEqual(self.execute(batch_id="cannot-repeat")["blocked"], 1)
        self.assertEqual(m.readback([self.row], self.state, self.config)["unresolved"], 1)
        self.assertEqual(len(self.calls), 2)

    def test_rehashed_aggregate_cannot_drop_a_completed_segment_observation(self):
        self.execute()
        _, receipt_path, evidence_path = m.paths(self.state, self.row, self.config)
        evidence, receipt = m.checked_document(evidence_path), m.checked_document(receipt_path)
        evidence["analysis"]["summary"].pop()
        m.atomic_document(evidence_path, evidence)
        receipt["evidenceSha256"] = m.digest(evidence)
        m.atomic_document(receipt_path, receipt)
        with self.assertRaisesRegex(m.AnalysisError, "SEGMENT_MERGE_INVALID"):
            m.cached_state(self.state, self.row, self.config)
        self.assertEqual(self.execute(batch_id="no-replay")["blocked"], 1)
        self.assertEqual(len(self.calls), 2)

    def test_sidecar_mutation_and_call_accounting_mutation_are_rejected(self):
        self.execute()
        span = m.segment_rows(self.row, self.config)[0]
        _, path, _ = m.paths(self.state, span, self.config)
        observed_path = path.with_name(path.name.replace(".receipt.json", ".observation.json"))
        original = observed_path.read_bytes()
        observed = m.checked_document(observed_path)
        observed["requestSha256"] = "0" * 64
        m.atomic_document(observed_path, observed)
        with self.assertRaisesRegex(m.AnalysisError, "SEGMENT_RECEIPT_INVALID"):
            m.cached_state(self.state, self.row, self.config)
        observed_path.write_bytes(original)
        receipt = m.checked_document(path)
        receipt["callsAttempted"] = 1
        m.atomic_document(path, receipt)
        with self.assertRaisesRegex(m.AnalysisError, "SEGMENT_RECEIPT_INVALID"):
            m.cached_state(self.state, self.row, self.config)

    def test_response_observation_survives_interruption_before_analysis_write(self):
        def interrupted(**kwargs):
            self.invoke(**kwargs)
            raise KeyboardInterrupt()
        with patch.dict(m.os.environ, {"GEMINI_API_KEY": "synthetic-key"}), patch.object(m, "verify_checkout"), \
                patch.object(m, "project_budget", return_value=self.budget), patch.object(m.adapter, "invoke", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                m.execute([self.row], self.info, self.state, self.config, self.limits)
        _, receipt_path, _ = m.paths(self.state, m.segment_rows(self.row, self.config)[0], self.config)
        receipt = m.checked_document(receipt_path)
        self.assertEqual((receipt["state"], receipt["callsAttempted"], receipt["usage"]["totalTokens"]), ("running", 2, 112))
        observation = m.checked_document(receipt_path.with_name(receipt_path.name.replace(".receipt.json", ".observation.json")))
        self.assertEqual(observation["responseId"], "v1_fixture_0")
        self.assertEqual(self.execute(batch_id="do-not-retry")["blocked"], 1)

    def test_source_relative_validation_rejects_clip_relative_timestamp(self):
        span = m.segment_rows(self.row, self.config)[1]
        value = self.answer(30, 60)
        value["summary"][0]["evidence"][0]["startSeconds"] = 1
        with self.assertRaisesRegex(m.AnalysisError, "ANALYSIS_EVIDENCE_INVALID"):
            m.validate_analysis(value, span)
        value = self.answer(30, 60)
        value["schemaVersion"] = True
        with self.assertRaisesRegex(m.AnalysisError, "ANALYSIS_SCHEMA_INVALID"):
            m.validate_analysis(value, span)

    def test_fractional_final_boundary_is_not_rounded_or_dropped(self):
        row = {**self.row, "durationSeconds": 61.5}
        spans = m.segment_rows(row, self.config)
        self.assertEqual([(s["segmentStartSeconds"], s["segmentEndSeconds"]) for s in spans], [(0, 30), (30, 60), (60, 61.5)])

    def test_static_succeeded_result_remains_reusable_and_byte_identical(self):
        legacy = m.replace(self.config, protocol=1)
        value = self.answer(0, 60)
        usage = {"totalTokens": 42, "inputTokens": None, "outputTokens": None, "rawUsageFields": {"total_tokens": 42},
                 "usageCompleteness": "partial", "costVerified": False, "cost": None}
        evidence = {"identity": m.identity(self.row, legacy), "analysis": m.validate_analysis(value, self.row), "usage": usage,
                    "reportSha256": "f" * 64, "provider": "gemini_via_claude_video", "processing": "static_full_video"}
        _, receipt_path, evidence_path = m.paths(self.state, self.row, legacy)
        m.atomic_document(evidence_path, evidence)
        m.atomic_document(receipt_path, {"identity": evidence["identity"], "state": "succeeded", "membershipEvidence": self.row["membership"],
                                        "evidenceSha256": m.digest(evidence)})
        before = {p: p.read_bytes() for p in self.state.rglob("*.json")}
        with patch.dict(m.os.environ, {}, clear=True), patch.object(m.adapter, "invoke", side_effect=AssertionError("paid duplicate")), \
                patch.object(m, "project_budget", side_effect=AssertionError("provider budget")), patch.object(m, "verify_checkout", side_effect=AssertionError("checkout")):
            result = m.execute([self.row], self.info, self.state, self.config, self.limits)
        self.assertEqual((result["reused"], result["attempted"]), (1, 0))
        self.assertEqual({p: p.read_bytes() for p in self.state.rglob("*.json")}, before)

    def test_config_hash_binds_schema_segment_and_adapter_changes(self):
        original = m.digest(self.config.identity)
        self.assertNotEqual(m.digest(m.replace(self.config, segment_seconds=20).identity), original)
        self.assertNotEqual(m.digest(m.replace(self.config, output_limit=99).identity), original)
        with patch.object(m.adapter, "schema", return_value={"type": "object"}):
            self.assertNotEqual(m.digest(self.config.identity), original)
        with patch.object(m.adapter, "wire_schema", return_value={"type": "object"}):
            self.assertNotEqual(m.digest(self.config.identity), original)


if __name__ == "__main__":
    unittest.main()
