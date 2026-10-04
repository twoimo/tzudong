"""Real pinned MCP/OSK mutations in isolated subprocess vaults only.

Run with OSK_TEST_ENGINE and the existing OSK Python environment. Missing engine
is a skip, not a pass. Failure injection wraps the real APIs; it does not replace
the OSK parser, writer, CAS, routing or projection implementation.
"""
import copy
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

    def test_receipt_content_and_exact_model_evidence_are_required(self):
        self.run_case("receipts")

    def test_new_receipt_updates_owned_nodes_and_preserves_manual_edits(self):
        self.run_case("updates")


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
    config = a.AnalysisConfig("gemini-3.8-flash", 1000, 100, "b" * 64, root / "no-watch-install", 30)
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
               "modelEvidenceSha256": config.model_evidence_hash, "reservedInputTokens": 1000,
               "callsAttempted": 1, "usage": evidence["usage"], "evidenceSha256": a.digest(evidence),
               "callAccounting": "watch_invocation_interactions_post_upper_bound"}
    _, rp, ep = a.paths(root / "analysis", row, config)
    a.atomic_document(ep, evidence)
    a.atomic_document(rp, receipt)
    return p.completed_bundle(root / "analysis", row, config), row, config, rp, ep


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
