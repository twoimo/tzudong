"""Real pinned MCP/OSK mutations in isolated subprocess vaults only.

Run with OSK_TEST_ENGINE and the existing OSK Python environment. Missing engine
is a skip, not a pass. Failure injection wraps the real APIs; it does not replace
the OSK parser, writer, CAS, routing or projection implementation.
"""
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from backend.knowledge_graph import longform_analysis as a
from backend.knowledge_graph import osk_publication as p
from backend.knowledge_graph import osk_projection as projection


class PublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = os.getenv("OSK_TEST_ENGINE")
        if not cls.engine:
            raise unittest.SkipTest("OSK_TEST_ENGINE required; use the existing OSK Python environment")

    def run_case(self, case):
        with tempfile.TemporaryDirectory(prefix="tzudong-publication-") as temp:
            env = dict(os.environ, OSK_UPDATE_CHECK="0", PYTHONDONTWRITEBYTECODE="1", TMPDIR=temp)
            result = subprocess.run([sys.executable, "-B", "-m", __name__, "--fixture", case, temp, self.engine],
                                    env=env, capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 0, result.stderr[-3000:])
            self.assertEqual(json.loads(result.stdout), {"case": case, "ok": True})

    def test_real_engine_idempotency_links_and_unverified_projection(self):
        self.run_case("idempotency")

    def test_create_and_update_ack_loss_is_resolved_by_real_readback(self):
        self.run_case("ack_loss")

    def test_partial_creation_and_lost_readback_resume_without_duplicates(self):
        self.run_case("partial")
        self.run_case("lost_readback")

    def test_official_cas_refuses_concurrent_human_edit(self):
        self.run_case("cas")

    def test_cross_scope_collision_and_state_scope_are_rejected(self):
        self.run_case("scope")

    def test_lock_is_shared_across_checkpoint_directories(self):
        self.run_case("lock")

    def test_projection_node_edge_and_byte_limits_block_before_writes(self):
        self.run_case("capacity")

    def test_sharded_publication_resumes_bounded_pages_and_preserves_context(self):
        self.run_case("sharded_pages")

    def test_growing_layout_moves_existing_clusters_through_public_api(self):
        self.run_case("growing_layout")

    def test_sharded_source_evidence_and_hierarchy_roundtrip_with_public_engine(self):
        self.run_case("paged_source")

    def test_sharded_layout_migrates_legacy_nodes_without_deleting_links(self):
        self.run_case("sharded_migration")

    def test_sharded_layout_refuses_pinned_moves_and_preserves_manual_changes(self):
        self.run_case("sharded_pin")

    def test_completed_legacy_nodes_can_gain_context_links_without_rewriting_observations(self):
        self.run_case("legacy_links")

    def test_receipt_content_and_exact_model_evidence_are_required(self):
        self.run_case("receipts")

    def test_new_receipt_updates_owned_nodes_and_preserves_manual_edits(self):
        self.run_case("updates")


class PublicationEngineAdmissionTests(unittest.TestCase):
    def test_changed_post_write_dependency_or_added_runtime_is_rejected_before_import(self):
        source = os.getenv("OSK_TEST_ENGINE")
        if not source:
            self.skipTest("OSK_TEST_ENGINE required")
        source = Path(source)
        self.assertEqual(p.engine_digest(source), p.ENGINE_SHA256)
        with tempfile.TemporaryDirectory(prefix="tzudong-engine-admission-") as temp:
            root = Path(temp)
            engine, vault = root / "engine", root / "vault"
            vault.mkdir()
            for path in source.rglob("*.py"):
                if any(part in {"tests", "__pycache__", ".venv", "venv", ".git", ".pytest_cache"}
                       for part in path.relative_to(source).parts):
                    continue
                target = engine / path.relative_to(source)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(path.read_bytes())
            rechecks = engine / "osk/rechecks.py"
            original = rechecks.read_bytes()
            for change in ("post_write_dependency", "added_runtime"):
                with self.subTest(change=change):
                    if change == "post_write_dependency":
                        rechecks.write_bytes(original + b"\n# changed dependency\n")
                    else:
                        rechecks.write_bytes(original)
                        (engine / "unexpected.py").write_text("# unreviewed runtime\n")
                    # Projection's four read pins still match. Publication must
                    # reject the broader write graph before importing any API.
                    for relative, digest in projection.ENGINE_API_SHA256.items():
                        self.assertEqual(hashlib.sha256((engine / relative).read_bytes()).hexdigest(), digest)
                    with patch.object(projection, "_load_engine") as loader:
                        with self.assertRaisesRegex(p.PublicationError, "^OSK_ENGINE_UNSUPPORTED$"):
                            p.Engine(vault, engine)
                        loader.assert_not_called()
                    self.assertEqual(list(vault.iterdir()), [])


def hub_fixture(vault, title="tzudong", scope="tzudong", identity="261004-0001-00000001", kind="hub"):
    path = vault / "00_Scope" / scope / (title + ".md")
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = {"schemaVersion": 1, "kind": kind, "evidence": []}
    path.write_text('---\nid: "' + identity + '"\ncreated: "2026-10-04 00:01 (KST)"\n'
                    'updated: "2026-10-04 00:01 (KST)"\nauthor: "agent"\ndrafter: "gpt-6"\n'
                    'summary: "Isolated public fixture"\n---\n\n# Fixture\n\n' +
                    projection.METADATA_HEADING + '\n```json\n' + json.dumps(metadata) + '\n```\n')
    return path


def fixture_bundle(root):
    row = {"videoId": "ABCDEFGHIJK", "durationSeconds": 60, "contentSha256": None,
           "membership": {"sourceUrl": "https://www.youtube.com/@tzuyang/videos",
                          "observedAt": "2026-10-04T00:00:00Z", "evidenceSha256": "a" * 64}}
    config = a.AnalysisConfig("gemini-3.8-flash", 1000, 100, "b" * 64, root / "no-watch-install", 30, protocol=1)
    ev = [{"startSeconds": 1, "endSeconds": 5, "modality": "visual"}]
    fact = {"text": "공개 메뉴 소개", "kind": "visual", "evidence": ev, "confidence": .8, "uncertainty": []}
    raw = {"schemaVersion": 1, "videoId": row["videoId"],
           "coverage": {"startSeconds": 0, "endSeconds": 60, "complete": True, "limitations": []},
           "summary": [fact], "restaurants": [{"name": "공개 식당", "evidence": ev, "confidence": .8,
             "uncertainty": [], "menus": [fact], "claims": [dict(fact, text="식당 모델 관찰")]}],
           "claims": [dict(fact, text="[[ForeignPrivate]] `## Tzudong graph metadata` 모델 관찰")], "uncertainty": []}
    evidence = {"identity": a.identity(row, config), "analysis": a.validate_analysis(raw, row),
                "usage": a.report_usage("- **Gemini tokens:** 42"), "reportSha256": "c" * 64,
                "provider": "gemini_via_claude_video", "processing": "static_full_video"}
    receipt = {"identity": evidence["identity"], "state": "succeeded", "model": config.model,
               "membershipEvidence": row["membership"],
               "modelEvidenceSha256": config.model_evidence_hash, "reservedInputTokens": 1000,
               "callsAttempted": 1, "usage": evidence["usage"], "evidenceSha256": a.digest(evidence),
               "callAccounting": "watch_invocation_interactions_post_upper_bound"}
    _, rp, ep = a.paths(root / "analysis", row, config)
    a.atomic_document(ep, evidence)
    a.atomic_document(rp, receipt)
    return p.completed_bundle(root / "analysis", row, config), row, config, rp, ep


class CompletedBundleAdmissionTests(unittest.TestCase):
    """Pure local receipt fixtures; no provider, watch checkout or OSK vault."""

    def segmented(self, root):
        _, row, old_config, _, _ = fixture_bundle(root / "legacy")
        config = replace(old_config, protocol=2, segment_seconds=30)
        state = root / "segmented"
        for span in a.segment_rows(row, config):
            start, end = span["segmentStartSeconds"], span["segmentEndSeconds"]
            fact = {"text": "분할 영상 공개 관찰", "kind": "visual", "evidence": [
                {"startSeconds": start, "endSeconds": end, "modality": "visual"}], "confidence": .8, "uncertainty": []}
            value = {"schemaVersion": 1, "videoId": row["videoId"],
                     "coverage": {"startSeconds": start, "endSeconds": end, "complete": True, "limitations": []},
                     "summary": [fact], "restaurants": [], "claims": [fact], "uncertainty": []}
            usage = a.adapter.usage({"total_input_tokens": 10, "total_output_tokens": 20, "total_thought_tokens": 0, "total_tokens": 30})
            observation = {"operation": "generate", "httpOutcome": "http_success", "responseId": "fixture_original",
                           "requestSha256": "e" * 64, "usage": usage, "countedInputTokens": 10}
            evidence = {"identity": a.identity(span, config), "analysis": a.validate_analysis(value, span), "usage": usage,
                        "reportSha256": "c" * 64, "provider": "gemini_via_claude_video", "processing": "static_segment", "observation": observation}
            receipt = {"identity": evidence["identity"], "state": "succeeded", "model": config.model,
                       "membershipEvidence": row["membership"], "modelEvidenceSha256": config.model_evidence_hash,
                       "reservedInputTokens": config.input_limit, "reservedOutputTokens": config.output_limit,
                       "reservedCalls": 2, "callsAttempted": 2, "usage": usage, "evidenceSha256": a.digest(evidence),
                       "observationSha256": a.digest(observation)}
            _, rp, ep = a.paths(state, span, config)
            a.atomic_document(ep, evidence)
            a.atomic_document(rp, receipt)
            a.atomic_document(rp.with_name(rp.name.replace(".receipt.json", ".observation.json")), observation)
        _, rp, ep = a.paths(state, row, config)
        a.atomic_document(rp, {"identity": a.identity(row, config), "state": "segmented", "model": config.model,
                              "modelEvidenceSha256": config.model_evidence_hash, "membershipEvidence": row["membership"]})
        a.complete_video(state, row, config)
        return state, row, config, rp, ep

    def test_legacy_success_reuses_original_bytes_under_new_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            expected, row, config, rp, ep = fixture_bundle(root)
            before = (rp.read_bytes(), ep.read_bytes())
            self.assertEqual(p.completed_bundle(root / "analysis", row, replace(config, protocol=2)), expected)
            self.assertEqual((rp.read_bytes(), ep.read_bytes()), before)

    def test_exact_segment_completion_is_admitted_without_rewriting_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            state, row, config, rp, ep = self.segmented(Path(directory))
            before = {path: path.read_bytes() for path in state.rglob("*.json")}
            result = p.completed_bundle(state, row, config)
            self.assertEqual(len(result["analysis"]["claims"]), 2)
            self.assertEqual(result["source"]["receiptSha256"], a.digest(a.checked_document(rp)))
            self.assertEqual(result["source"]["evidenceSha256"], a.digest(a.checked_document(ep)))
            self.assertEqual({path: path.read_bytes() for path in state.rglob("*.json")}, before)

    def test_segment_accounting_and_each_saved_proof_are_mandatory(self):
        with tempfile.TemporaryDirectory() as directory:
            state, row, config, rp, ep = self.segmented(Path(directory))
            receipt = a.checked_document(rp)
            for key, value in [("segmentCount", 1), ("callsAttempted", 1), ("reservedInputTokens", config.input_limit),
                               ("reservedOutputTokens", config.output_limit), ("callAccounting", "watch_invocation_interactions_post_upper_bound"),
                               ("modelEvidenceSha256", "d" * 64), ("model", "gemini-3.7-flash")]:
                with self.subTest(field=key):
                    a.atomic_document(rp, {**receipt, key: value})
                    with self.assertRaises((p.PublicationError, a.AnalysisError)):
                        p.completed_bundle(state, row, config)
            a.atomic_document(rp, receipt)
            _, part_rp, _ = a.paths(state, a.segment_rows(row, config)[1], config)
            part = a.checked_document(part_rp)
            a.atomic_document(part_rp, {**part, "state": "uncertain"})
            with self.assertRaises((p.PublicationError, a.AnalysisError)):
                p.completed_bundle(state, row, config)
            a.atomic_document(part_rp, part)
            evidence = a.checked_document(ep)
            evidence["segments"][1]["receiptSha256"] = "f" * 64
            a.atomic_document(ep, evidence)
            a.atomic_document(rp, {**receipt, "evidenceSha256": a.digest(evidence)})
            with self.assertRaises((p.PublicationError, a.AnalysisError)):
                p.completed_bundle(state, row, config)


def fixture_case(case, root, engine_path):
    vault = root / "vault"
    vault.mkdir()
    # Keep the engine's local mutex and notices inside the disposable fixture.
    (vault / ".git").mkdir()
    hub_fixture(vault)
    engine = p.Engine(vault, engine_path)
    assert engine.core.ROOT == vault.resolve()
    state = root / "publication"
    bundle, row, config, rp, ep = fixture_bundle(root)
    check = unittest.TestCase()

    def publish(**kw):
        return p.publish(bundle, engine, state, execute=True, **kw)

    def snapshot():
        return {str(f.relative_to(vault)): hashlib.sha256(f.read_bytes()).hexdigest()
                for f in vault.rglob("*.md")}

    def organization_plan():
        result = subprocess.run([sys.executable, "-B", "-m", "osk.cli", "organization", "plan", "--scope", "tzudong", "--preview"],
                                env=dict(os.environ, PYTHONPATH=str(engine_path), OSK_VAULT_ROOT=str(vault), OSK_UPDATE_CHECK="0"),
                                capture_output=True, text=True, timeout=20)
        check.assertEqual(result.returncode, 0, result.stderr[-1000:])
        return json.loads(result.stdout)

    if case == "idempotency":
        before = snapshot()
        plan = p.publish(bundle, engine, state)
        check.assertEqual(snapshot(), before)
        check.assertFalse(state.exists())
        first = publish()
        check.assertEqual(first["created"], 5)
        stable = snapshot()
        with patch.object(engine, "create", side_effect=AssertionError("duplicate create")), \
                patch.object(engine, "update", side_effect=AssertionError("duplicate update")):
            check.assertEqual(publish()["reused"], 5)
        check.assertEqual(snapshot(), stable)
        projected = projection.project_vault(vault, engine_path)
        check.assertEqual(len(projected["nodes"]), 6)
        check.assertEqual(projected["coverage"]["analyzedCount"], 0)
        check.assertTrue(all(e["status"] == "unverified" for n in projected["nodes"] for e in n["evidence"]))
        check.assertEqual(projected["diagnostics"]["excludedUnresolvedEdges"], 0)
        bound = plan["capacity"]["totalUpper"]
        for key, actual in {"nodes": len(projected["nodes"]), "edges": len(projected["edges"]),
                            "projectionBytes": len(projection._json(projected)) + 1}.items():
            check.assertLessEqual(actual, bound[key])
    elif case == "ack_loss":
        create, update = engine.create, engine.update
        def lost_create(*args):
            create(*args)
            raise TimeoutError("ACK lost after commit")
        def lost_update(*args):
            update(*args)
            raise TimeoutError("ACK lost after commit")
        with patch.object(engine, "create", side_effect=lost_create), patch.object(engine, "update", side_effect=lost_update):
            check.assertEqual(publish()["created"], 5)
        check.assertEqual(publish()["reused"], 5)
    elif case in ("partial", "lost_readback"):
        create, read = engine.create, engine.read
        if case == "partial":
            calls = [0]
            def stopped(target):
                calls[0] += 1
                if calls[0] > 1:
                    raise TimeoutError("worker stopped before next write")
                return create(target)
            with patch.object(engine, "create", side_effect=stopped), check.assertRaisesRegex(p.PublicationError, "READBACK_REQUIRED"):
                publish()
        else:
            committed = [False]
            def committed_create(target):
                value = create(target)
                committed[0] = True
                return value
            def unavailable(name):
                if committed[0]:
                    p.fail("OSK_NODE_READBACK_INVALID")
                return read(name)
            with patch.object(engine, "create", side_effect=committed_create), patch.object(engine, "read", side_effect=unavailable), check.assertRaises(p.PublicationError):
                publish()
        result = publish()
        check.assertEqual((result["created"], result["reused"]), (4, 1))
        check.assertEqual(len(list((vault / p.SPACE).glob("TZ-*.md"))), 5)
    elif case == "cas":
        spec = p.specs(bundle)[0]
        engine.create(spec)
        original = engine.update
        def raced(target, previous):
            path = vault / previous["path"]
            path.write_text(path.read_text() + "\nHuman edit must survive.\n")
            return original(target, previous)
        with patch.object(engine, "update", side_effect=raced), check.assertRaisesRegex(p.PublicationError, "READBACK_REQUIRED"):
            publish()
        check.assertIn("Human edit must survive.", engine.read(spec["name"])["body"])
        with check.assertRaises(p.PublicationError):
            publish()
    elif case == "scope":
        title = p.specs(bundle)[0]["name"]
        hub_fixture(vault, title, "foreign", "261004-0001-00000002", "claim")
        before = snapshot()
        with check.assertRaises(p.PublicationError):
            publish()
        check.assertEqual(before, snapshot())
        (vault / "00_Scope/foreign" / (title + ".md")).unlink()
        publish()
        ledger = a.checked_document(state / (row["videoId"] + ".json"))
        ledger["binding"]["scope"] = "00_Scope/foreign"
        a.atomic_document(state / (row["videoId"] + ".json"), ledger)
        with check.assertRaisesRegex(p.PublicationError, "STATE_SCOPE_MISMATCH"):
            publish()
    elif case == "lock":
        before = snapshot()
        with a.file_lock(engine.lock), check.assertRaisesRegex(a.AnalysisError, "WORK_ALREADY_LOCKED"):
            p.publish(bundle, engine, root / "different-checkpoint", execute=True)
        check.assertEqual(before, snapshot())
    elif case == "capacity":
        before = snapshot()
        for limit, maximum in [("MAX_NODES", 5), ("MAX_EDGES", 1), ("MAX_OUTPUT_BYTES", 1000)]:
            with patch.object(projection, limit, maximum):
                check.assertFalse(p.publish(bundle, engine, state)["capacity"]["admitted"])
                with check.assertRaisesRegex(p.PublicationError, "PROJECTION_CAPACITY"):
                    publish()
        check.assertEqual(before, snapshot())
        check.assertFalse(state.exists())
    elif case == "sharded_pages":
        before = snapshot()
        with patch.object(projection, "MAX_NODES", 3), patch.object(projection, "MAX_EDGES", 4), patch.object(projection, "MAX_SCOPE_BYTES", 4096), patch.object(p.checkpoint, "MAX_BYTES", 2048), patch.object(p.checkpoint, "MAX_ITEMS", 2), patch.object(p.checkpoint, "FANOUT", 2):
            plan = p.publish(bundle, engine, state, sharded=True, max_nodes=2)
            check.assertTrue(plan["capacity"]["admitted"])
            check.assertEqual(snapshot(), before)
            first = publish(sharded=True, max_nodes=2)
            check.assertEqual(first["code"], "PUBLICATION_PAGE_COMPLETED")
            check.assertFalse(first["publicationComplete"])
            check.assertEqual(first["remainingNodes"], plan["nodes"] - 2)
            check.assertEqual(a.checked_document(state / (row["videoId"] + ".json"))["state"], "running")
            last = first
            for _ in range(plan["nodes"]):
                if last["publicationComplete"]:
                    break
                last = publish(sharded=True, max_nodes=2)
            check.assertEqual(last["code"], "PUBLICATION_COMPLETED")
            check.assertTrue(last["publicationComplete"])
            check.assertEqual(last["remainingNodes"], 0)
            projected = projection.project_vault(vault, engine_path, sharded=True)
            check.assertEqual(len(projected["nodes"]), plan["nodes"] + 1)
            check.assertEqual(projected["diagnostics"]["excludedUnresolvedEdges"], 0)
            check.assertEqual(publish(sharded=True, max_nodes=2)["reused"], plan["nodes"])
        check.assertEqual(organization_plan()["issues"], [])
        names = p.specs(bundle, paged=True)
        hub = engine.read("tzudong")["body"]
        check.assertIn("[[" + names[0]["name"] + "]]", hub)
        check.assertTrue(all("[[" + item["name"] + "]]" not in hub for item in names[1:]))
        for item in names:
            body = engine.read(item["name"])["body"]
            check.assertTrue(all("[[" + name + "]]" in body for name in item["children"]))
    elif case == "growing_layout":
        from backend.knowledge_graph import publication_pages as pages
        with patch.object(pages, "CHILDREN_PER_HUB", 4):
            publish(sharded=True)
            old = {spec["name"]: engine.read(spec["name"])["meta"]["id"] for spec in p.specs(bundle, paged=True)}
            value = a.raw_analysis(copy.deepcopy(bundle["analysis"]))
            value["restaurants"].append(dict(copy.deepcopy(value["restaurants"][0]), name="두 번째 공개 식당"))
            bundle["analysis"] = a.validate_analysis(value, row)
            bundle["source"]["receiptSha256"] = "d" * 64
            result = publish(sharded=True)
            check.assertTrue(result["publicationComplete"])
            check.assertGreater(result["moved"], 0)
            for name, identity in old.items():
                check.assertEqual(engine.read(name)["meta"]["id"], identity)
            check.assertTrue(all(not cluster["missing_links"] for cluster in organization_plan()["clusters"]))
            check.assertEqual(projection.project_vault(vault, engine_path, sharded=True)["diagnostics"]["excludedUnresolvedEdges"], 0)
    elif case == "paged_source":
        from backend.knowledge_graph import publication_pages as pages
        from backend.knowledge_graph.tests.test_publication_pages import reconstructed_source
        value = a.raw_analysis(copy.deepcopy(bundle["analysis"]))
        value["claims"][0]["evidence"] = [{"startSeconds": i / 2, "endSeconds": i / 2 + .1, "modality": "both"} for i in range(100)]
        value["claims"][0]["text"] = "가" * 2000
        value["claims"][0]["uncertainty"] = ["한" * 2000] * 30
        bundle["analysis"] = a.validate_analysis(value, row)
        with patch.object(pages, "CHILDREN_PER_HUB", 4):
            planned = p.specs(bundle, paged=True)
            first = publish(sharded=True)
            check.assertTrue(first["publicationComplete"])
            saved = [{"body": engine.read(item["name"])["body"]} for item in planned]
            check.assertEqual(reconstructed_source(saved), a.canonical(bundle["analysis"]))
            projected = projection.project_vault(vault, engine_path, sharded=True)
            check.assertEqual(len(projected["nodes"]), len(planned) + 1)
            check.assertEqual(projected["diagnostics"]["excludedUnresolvedEdges"], 0)
            check.assertEqual(projected["coverage"]["analyzedCount"], 0)
            check.assertEqual(organization_plan()["issues"], [])
            check.assertEqual(publish(sharded=True)["reused"], len(planned))
    elif case in {"sharded_migration", "sharded_pin"}:
        publish()
        old = {spec["name"]: engine.read(spec["name"]) for spec in p.specs(bundle)}
        hub_before = engine.read("tzudong")["body"]
        if case == "sharded_pin":
            # The real public movement path consults its pinned-node guard.
            # Inject only the pin result; public routing/parser/move logic runs.
            with patch.object(engine.api.write, "_pinned", return_value=True), check.assertRaisesRegex(p.PublicationError, "READBACK_REQUIRED"):
                publish(sharded=True)
            for name, node in old.items():
                check.assertEqual(engine.read(name)["path"], node["path"])
                check.assertEqual(engine.read(name)["hash"], node["hash"])
            check.assertFalse(a.checked_document(state / (row["videoId"] + ".json"))["state"] == "complete")
        else:
            steps = []
            for _ in range(30):
                step = publish(sharded=True, max_nodes=1)
                check.assertLessEqual(step["mutations"], 1)
                steps.append(step)
                if step["publicationComplete"]:
                    break
            check.assertTrue(steps[-1]["publicationComplete"])
            check.assertEqual(sum(step["moved"] for step in steps), len(old))
            for name, node in old.items():
                current = engine.read(name)
                check.assertIn(node["body"].split(p.SOURCE_HEADING)[0].strip(), current["body"])
                check.assertNotEqual(current["path"], node["path"])
                check.assertEqual(current["meta"]["id"], node["meta"]["id"])
            check.assertIn(hub_before.strip(), engine.read("tzudong")["body"])
            check.assertTrue(publish(sharded=True)["publicationComplete"])
            organization = organization_plan()
            check.assertTrue(all(not cluster["missing_links"] for cluster in organization["clusters"]))
    elif case == "legacy_links":
        # Reconstruct a genuinely completed previous-format receipt, then upgrade
        # just topology. Pending signatures and manual modifications stay guarded.
        original = p.target_for
        def old_target(*args, **kw):
            return original(*args, **{**kw, "include_links": False})
        with patch.object(p, "target_for", side_effect=old_target):
            publish()
        before = engine.read(p.specs(bundle)[0]["name"])["body"]
        check.assertGreater(publish()["updated"], 0)
        check.assertIn(before.split(p.SOURCE_HEADING)[0].strip(), engine.read(p.specs(bundle)[0]["name"])["body"])
        check.assertEqual(publish()["reused"], 5)
    elif case == "receipts":
        receipt = a.checked_document(rp)
        for key, value in [("state", "uncertain"), ("modelEvidenceSha256", "d" * 64), ("model", "gemini-3.7-flash")]:
            a.atomic_document(rp, dict(receipt, **{key: value}))
            with check.assertRaises((p.PublicationError, a.AnalysisError)):
                p.completed_bundle(root / "analysis", row, config)
        a.atomic_document(rp, receipt)
        evidence = a.checked_document(ep)
        evidence["analysis"]["coverage"]["complete"] = False
        a.atomic_document(ep, evidence)
        with check.assertRaises(a.AnalysisError):
            p.completed_bundle(root / "analysis", row, config)
        check.assertEqual(len(snapshot()), 1)
    elif case == "updates":
        publish()
        bundle["analysis"]["claims"][0]["text"] = "수정된 동일 영상 관찰"
        bundle["source"]["receiptSha256"] = "d" * 64
        check.assertGreater(publish()["updated"], 0)
        check.assertTrue(list((state / "history").glob("*.json")))
        path = vault / p.SPACE / "TZ-Video-ABCDEFGHIJK.md"
        path.write_text(path.read_text() + "\nManual review stays.\n")
        with check.assertRaisesRegex(p.PublicationError, "NODE_CHANGED"):
            publish()
    else:
        raise AssertionError("unknown fixture")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--fixture":
    fixture_case(sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]))
    print(json.dumps({"case": sys.argv[2], "ok": True}))
elif __name__ == "__main__":
    unittest.main()
