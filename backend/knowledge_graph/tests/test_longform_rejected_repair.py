"""Offline legacy-rejection repair contracts; all paid transport is replaced."""
import contextlib
import hashlib
import io
import json
import unittest
from unittest.mock import patch

from backend.knowledge_graph import longform_analysis as m
from backend.knowledge_graph.tests import test_longform_segments as fixtures


class RejectedRepairTests(unittest.TestCase):
    answer = fixtures.SegmentExecutionTests.answer
    invoke = fixtures.SegmentExecutionTests.invoke

    def setUp(self):
        fixtures.SegmentExecutionTests.setUp(self)
        self.config = m.replace(self.config, input_limit=1048576, output_limit=65536)
        self.legacy = m.replace(self.config, protocol=1)
        self.other = {**self.row, "videoId": "ZYXWVUTSRQP"}
        self.source_limits = {"maxVideos": 2, "maxCalls": 2, "maxInputTokens": 2097152}
        self.limits = {"maxVideos": 1, "maxCalls": 2, "maxInputTokens": 1048576}
        self.source_batch = "root-two-fixture"
        self.source_batch_path = self.state / "batches" / (self.source_batch + ".json")
        self.source_usage = m.report_usage("- **Gemini tokens:** 73649\n")
        self.original = {"identity": m.identity(self.row, self.legacy), "state": "uncertain",
            "code": "ANALYSIS_EVIDENCE_INVALID", "callsAttempted": 1, "reservedInputTokens": self.config.input_limit,
            "model": self.config.model, "callAccounting": "watch_invocation_interactions_post_upper_bound",
            "modelEvidenceSha256": self.config.model_evidence_hash, "membershipEvidence": self.row["membership"],
            "startedAt": "2026-10-05T00:00:00Z", "elapsedSeconds": 17.158482, "usage": self.source_usage,
            "evidenceSha256": None, "costVerified": False}
        _, self.original_path, _ = m.paths(self.state, self.row, self.legacy)
        m.atomic_document(self.original_path, self.original)
        m.atomic_document(self.source_batch_path, {"identity": {"inventorySha256": self.info["inventorySha256"],
            "configSha256": m.digest(self.legacy.identity), "limits": self.source_limits},
            "reservedCalls": 2, "reservedInputTokens": 2097152, "videos": [self.row["videoId"], self.other["videoId"]]})
        value = self.answer(0, 60)
        value["videoId"] = self.other["videoId"]
        evidence = {"identity": m.identity(self.other, self.legacy), "analysis": m.validate_analysis(value, self.other),
            "usage": self.source_usage, "reportSha256": "f" * 64,
            "provider": "gemini_via_claude_video", "processing": "static_full_video"}
        _, other_receipt, other_evidence = m.paths(self.state, self.other, self.legacy)
        m.atomic_document(other_evidence, evidence)
        m.atomic_document(other_receipt, {**self.original, "identity": evidence["identity"], "state": "succeeded",
                                        "code": "COMPLETED", "evidenceSha256": m.digest(evidence)})
        self.repair = m.RejectedRepair(self.row["videoId"], self.source_batch,
                                      hashlib.sha256(self.original_path.read_bytes()).hexdigest(), m.LEGACY_REJECTION_PRODUCER)
        self.before = self.snapshot()
        self.addCleanup(patch.stopall)
        patch("urllib.request.urlopen", side_effect=AssertionError("external network is forbidden")).start()

    def snapshot(self):
        return {path: path.read_bytes() for path in self.state.rglob("*.json")}

    def assert_originals_unchanged(self):
        for path, data in self.before.items():
            self.assertEqual(path.read_bytes(), data)

    def run_repair(self, *, batch_id="repair-one", repair=True, limits=None, config=None, rows=None):
        with patch.dict(m.os.environ, {"GEMINI_API_KEY": "synthetic-key"}), patch.object(m, "verify_checkout"), \
                patch.object(m, "project_budget", return_value=self.budget), patch.object(m.adapter, "invoke", side_effect=self.invoke):
            return m.execute(rows or [self.row], self.info, self.state, config or self.config, limits or self.limits,
                             batch_id=batch_id, repair=self.repair if repair is True else repair or None)

    def test_offline_plan_requires_explicit_provenance_and_writes_nothing(self):
        self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
        plan = m.make_plan([self.row], self.info, self.state, self.config, self.limits, repair=self.repair)
        record = m.rejected_repair_record(self.state, self.row, self.config, self.repair,
                                         limits=self.limits, batch_id="repair-one")
        self.assertEqual((plan["cache"]["new"], plan["remainingSegments"], plan["boundedExecution"]["callsUpper"]), (1, 2, 2))
        self.assertEqual(record["sourceUsage"]["totalTokens"], 73649)
        self.assertNotEqual(record["sourceIdentity"]["configSha256"], record["destinationIdentity"]["configSha256"])
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse((self.state / "locks").exists())

    def test_legacy_rejection_without_interaction_id_cannot_issue_provider_get(self):
        with patch.object(m.adapter, "invoke", side_effect=AssertionError("no original ID; no GET or POST")):
            result = m.readback([self.row], self.state, self.config, provider=True, max_calls=1)
        self.assertEqual((result["unresolved"], result["readbackCalls"]), (1, 0))
        self.assertEqual(self.snapshot(), self.before)

    def test_unchanged_caps_preserve_originals_and_resume_only_new_segments(self):
        first = self.run_repair()
        self.assertEqual((first["attempted"], first["succeeded"], first["deferredByBudget"]), (1, 0, 1))
        self.assertEqual(first["reservations"], {"reservedCalls": 2, "reservedInputTokens": 1048576, "reservedOutputTokens": 65536})
        manifest_path = m.repair_path(self.state, self.row, self.config)
        manifest_bytes = manifest_path.read_bytes()
        lineage = m.checked_document(manifest_path)
        self.assertEqual(lineage["sourceReceiptSha256"], self.repair.source_receipt_sha256)
        self.assertEqual(lineage["sourceBatchSha256"], hashlib.sha256(self.before[self.source_batch_path]).hexdigest())
        self.assertEqual(self.run_repair()["attempted"], 0)  # New batch is now exhausted too.
        self.assertEqual(self.run_repair(batch_id="ordinary", repair=False)["blocked"], 1)
        finished = self.run_repair(batch_id="repair-two")
        self.assertEqual((finished["succeeded"], len(self.calls)), (1, 2))
        self.assertEqual([call["start"] for call in self.calls], [0, 30])
        self.assertEqual(m.cached_state(self.state, self.row, self.config), "reusable")
        self.assertEqual(self.run_repair(batch_id="reuse", repair=False)["reused"], 1)
        self.assertEqual(m.cached_state(self.state, self.other, self.config), "reusable")
        self.assertEqual(manifest_path.read_bytes(), manifest_bytes)
        _, root_receipt, _ = m.paths(self.state, self.row, self.config)
        self.assertEqual(m.checked_document(root_receipt)["repairLineageSha256"], m.digest(lineage))
        self.assertEqual(m.checked_document(root_receipt)["usage"]["totalTokens"], 224)
        self.assertEqual(lineage["sourceUsage"]["totalTokens"], 73649)  # Never refunded or rolled into invented detail.
        for span, batch in zip(m.segment_rows(self.row, self.config), ("repair-one", "repair-two")):
            receipt, _ = m.segment_evidence(self.state, span, self.config)
            self.assertEqual((receipt["batchId"], receipt["repairLineageSha256"]), (batch, m.digest(lineage)))
        self.assert_originals_unchanged()

    def test_original_exhausted_batch_missing_id_or_expanded_caps_are_refused(self):
        cases = [(self.source_batch, self.limits), (None, self.limits)]
        for name in self.limits:
            cases.append(("repair", {**self.limits, name: self.source_limits[name] + 1}))
        for batch, limits in cases:
            with self.subTest(batch=batch, limits=limits), self.assertRaisesRegex(m.AnalysisError, "REPAIR_NEW_BOUNDED_BATCH_REQUIRED"):
                self.run_repair(batch_id=batch, limits=limits)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.snapshot(), self.before)

    def test_transport_unknown_and_unproven_rejections_never_reach_provider(self):
        mutations = [{"code": code} for code in ("WATCH_TIMEOUT_UNCERTAIN", "WATCH_RESULT_UNCONFIRMED",
                    "WATCH_TRANSPORT_UNCERTAIN", "WATCH_REPORT_INVALID", "WATCH_USAGE_INVALID", "ANALYSIS_PARTIAL")]
        mutations += [{"state": "running"}, {"state": "rejected"}, {"state": "succeeded"}, {"usage": None},
                      {"usage": {**self.source_usage, "inputTokens": 1}}, {"callsAttempted": 0},
                      {"callAccounting": "unknown"}, {"elapsedSeconds": None}, {"model": "gemini-other"},
                      {"identity": {**self.original["identity"], "configSha256": "0" * 64}}]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                m.atomic_document(self.original_path, {**self.original, **mutation})
                repair = m.replace(self.repair, source_receipt_sha256=hashlib.sha256(self.original_path.read_bytes()).hexdigest())
                with self.assertRaisesRegex(m.AnalysisError, "REPAIR_CONFIRMED_REJECTION_REQUIRED"):
                    self.run_repair(repair=repair)
        self.assertEqual(self.calls, [])

    def test_missing_digest_producer_or_batch_evidence_cannot_authorize_repair(self):
        for change in ({"producer_commit": ""}, {"producer_commit": "0" * 40}, {"source_receipt_sha256": ""},
                       {"source_batch_id": None}, {"source_receipt_sha256": []},
                       {"source_receipt_sha256": "0" * 64}, {"source_batch_id": "absent"}, {"video_id": self.other["videoId"]}):
            with self.subTest(change=change), self.assertRaises(m.AnalysisError):
                self.run_repair(repair=m.replace(self.repair, **change))
        self.original_path.unlink()
        with self.assertRaises(m.AnalysisError):
            self.run_repair()
        self.assertEqual(self.calls, [])

    def test_malformed_or_nonexhausted_source_ledger_is_refused(self):
        original = m.checked_document(self.source_batch_path)
        for change in ({"videos": []}, {"reservedCalls": 1}, {"reservedInputTokens": 1}, {"identity": None},
                       {"identity": {**original["identity"], "configSha256": "0" * 64}},
                       {"identity": {**original["identity"], "limits": {**self.source_limits, "maxCalls": 3}}}):
            with self.subTest(change=change):
                m.atomic_document(self.source_batch_path, {**original, **change})
                with self.assertRaises(m.AnalysisError):
                    self.run_repair()
        self.assertEqual(self.calls, [])

    def test_changed_input_model_output_limits_or_legacy_protocol_cannot_bypass_cache(self):
        for config in (m.replace(self.config, model="gemini-other"), m.replace(self.config, input_limit=1000),
                       m.replace(self.config, output_limit=100), self.legacy):
            with self.subTest(config=config), self.assertRaises(m.AnalysisError):
                self.run_repair(config=config)
        with self.assertRaises(m.AnalysisError):
            self.run_repair(rows=[{**self.row, "durationSeconds": 61}])
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_SINGLE_VIDEO_REQUIRED"):
            self.run_repair(rows=[self.row, self.other])
        self.assertEqual(self.calls, [])

    def test_new_transport_uncertainty_never_resends_with_new_batch_or_config(self):
        self.scenario = "timeout"
        self.assertEqual(self.run_repair()["unconfirmed"], 1)
        self.assertEqual(self.run_repair(batch_id="new-batch")["blocked"], 1)
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_ALREADY_REGISTERED"):
            self.run_repair(batch_id="new-config", config=m.replace(self.config, segment_seconds=20))
        result = m.readback([self.row], self.state, self.config, provider=True, max_calls=1)
        self.assertEqual((result["unresolved"], result["readbackCalls"]), (1, 0))
        self.assertEqual(len(self.calls), 1)
        self.assert_originals_unchanged()

    def test_new_structural_rejection_does_not_inherit_legacy_repair_permission(self):
        self.scenario = "invalid"
        self.run_repair()
        self.assertEqual(self.run_repair(batch_id="no-replay")["blocked"], 1)
        self.assertEqual(len(self.calls), 1)
        self.assert_originals_unchanged()

    def test_original_receipt_batch_and_lineage_mutations_fail_closed(self):
        self.run_repair()
        original_batch_bytes = self.source_batch_path.read_bytes()
        batch = m.checked_document(self.source_batch_path)
        batch["identity"]["inventorySha256"] = "0" * 64
        m.atomic_document(self.source_batch_path, batch)
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_LINEAGE_CHANGED"):
            self.run_repair(batch_id="changed-batch")
        self.source_batch_path.write_bytes(original_batch_bytes)
        self.original_path.write_bytes(self.original_path.read_bytes() + b"\n")
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_CONFIRMED_REJECTION_REQUIRED"):
            self.run_repair(batch_id="changed-original")
        self.original_path.write_bytes(self.before[self.original_path])
        manifest = m.repair_path(self.state, self.row, self.config)
        lineage = m.checked_document(manifest)
        lineage["sourceUsage"]["totalTokens"] = 0
        m.atomic_document(manifest, lineage)
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_LINEAGE_CHANGED"):
            self.run_repair(batch_id="changed-lineage")
        self.assertEqual(len(self.calls), 1)

    def test_missing_manifest_or_new_batch_lineage_blocks_reuse(self):
        self.run_repair()
        self.run_repair(batch_id="repair-two")
        manifest = m.repair_path(self.state, self.row, self.config)
        original_manifest = manifest.read_bytes()
        manifest.unlink()
        self.assertEqual(m.cached_state(self.state, self.row, self.config), "readback_required")
        manifest.write_bytes(original_manifest)
        path = self.state / "batches" / "repair-one.json"
        batch = m.checked_document(path)
        batch["identity"]["repairLineageSha256"] = "0" * 64
        m.atomic_document(path, batch)
        with self.assertRaisesRegex(m.AnalysisError, "REPAIR_LINEAGE_CHANGED"):
            m.cached_state(self.state, self.row, self.config)

    def test_new_batch_caps_reservations_and_membership_are_verified_on_cache_read(self):
        self.run_repair()
        self.run_repair(batch_id="repair-two")
        path = self.state / "batches" / "repair-one.json"
        original = m.checked_document(path)
        mutations = [{"reservedCalls": 0}, {"reservedInputTokens": 0}, {"reservedOutputTokens": 0},
                     {"segments": []}, {"segments": [{}]}, {"videos": [self.other["videoId"]]}]
        for name in self.source_limits:
            mutations.append({"identity": {**original["identity"], "limits": {
                **self.limits, name: self.source_limits[name] + 1}}})
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                m.atomic_document(path, {**original, **mutation})
                with self.assertRaises(m.AnalysisError):
                    m.cached_state(self.state, self.row, self.config)
        self.assertEqual(len(self.calls), 2)
        self.assert_originals_unchanged()

    def test_underfunded_segment_does_not_write_lineage_or_touch_provider_resources(self):
        with patch.object(m, "project_budget", side_effect=AssertionError("budget not needed")), \
                patch.object(m, "verify_checkout", side_effect=AssertionError("checkout not needed")):
            result = m.execute([self.row], self.info, self.state, self.config, {**self.limits, "maxCalls": 1},
                               batch_id="one-call-cap", repair=self.repair)
        self.assertEqual((result["attempted"], result["deferredByBudget"]), (0, 1))
        self.assertEqual(self.snapshot(), self.before)

    def test_publication_admission_requires_all_repair_segments_and_binds_lineage(self):
        from backend.knowledge_graph import osk_publication as publication
        self.run_repair()
        with self.assertRaisesRegex(publication.PublicationError, "ANALYSIS_READBACK_REQUIRED"):
            publication.completed_bundle(self.state, self.row, self.config)
        self.run_repair(batch_id="repair-two")
        before = self.snapshot()
        bundle = publication.completed_bundle(self.state, self.row, self.config)
        _, receipt_path, _ = m.paths(self.state, self.row, self.config)
        self.assertEqual(bundle["source"]["receiptSha256"], m.digest(m.checked_document(receipt_path)))
        self.assertEqual(bundle["analysis"]["coverage"]["endSeconds"], 60)
        self.assertEqual(self.snapshot(), before)

    def test_cli_targets_only_requested_video_and_plan_is_offline(self):
        args = ["--inventory", "unused", "--state-dir", str(self.state), "--model", self.config.model,
                "--model-evidence", "unused", "--segment-seconds", "30", "--max-videos", "1", "--max-calls", "2",
                "--max-input-tokens", "1048576", "--batch-id", "repair-plan", "--repair-rejected-video-id", self.row["videoId"],
                "--repair-source-batch-id", self.source_batch, "--repair-receipt-sha256", self.repair.source_receipt_sha256,
                "--repair-producer-commit", m.LEGACY_REJECTION_PRODUCER]
        with patch.object(m, "load_inventory", return_value=([self.row, self.other], self.info)), \
                patch.object(m, "load_model_evidence", return_value=self.config), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main(args), 0)
        result = json.loads(out.getvalue())
        self.assertEqual(result["longformVideoCount"], 1)
        self.assertEqual(result["rejectedRepair"]["sourceUsage"]["totalTokens"], 73649)
        self.assertEqual(self.snapshot(), self.before)


if __name__ == "__main__":
    unittest.main()
