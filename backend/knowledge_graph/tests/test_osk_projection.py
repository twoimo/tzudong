"""Real pinned OSK parser tests; no personal node content is used.

OSK_TEST_ENGINE must point to an existing engine. Run with its Python venv:
  OSK_TEST_ENGINE=/path/_governance/_engine python3 -m unittest \
    backend.knowledge_graph.tests.test_osk_projection
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from backend.knowledge_graph import osk_projection as projection


class ProjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        configured = os.environ.get("OSK_TEST_ENGINE")
        if not configured:
            raise unittest.SkipTest("OSK_TEST_ENGINE is required for real pinned-engine verification")
        cls.engine = Path(configured).resolve()
        cls.repo = Path(__file__).resolve().parents[3]

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tzudong-osk-projection-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.vault = self.base / "vault"
        self.vault.mkdir()
        self.output = self.base / "projection.json"
        self.sequence = 0
        self.hub = self.node("tzudong", "hub", coverage={
            "inventoryCount": None, "eligibleCount": None,
            "excludedShortsCount": None, "asOf": None})

    def node(self, title, kind=None, *, scope="tzudong", body="", metadata=None,
             edges=None, coverage=None, identity=None):
        self.sequence += 1
        identity = identity or f"261004-0001-{self.sequence:08x}"
        path = self.vault / "00_Scope" / scope / (title + ".md")
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = {"id": identity, "created": "2026-10-04 00:01 (KST)",
                "updated": "2026-10-04 00:01 (KST)", "author": "agent",
                "drafter": "agent", "summary": "Synthetic scoped fixture"}
        if edges:
            meta.update(edges)
        frontmatter = "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in meta.items())
        if kind is not None:
            registry = {"schemaVersion": 1, "kind": kind, "evidence": []}
            registry.update(metadata or {})
            if coverage is not None:
                registry["coverage"] = coverage
            body += "\n\n" + projection.METADATA_HEADING + "\n```json\n" + json.dumps(registry) + "\n```\n"
        path.write_text("---\n" + frontmatter + "\n---\n\n" + body, encoding="utf-8")
        return path

    def evidence(self, video="ABCDEFGHIJK", status="verified"):
        return {"videoId": video, "startSeconds": 12, "endSeconds": 24,
                "url": f"https://youtu.be/{video}?t=12", "status": status}

    def run_projection(self, expected=None, output=None):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", OSK_UPDATE_CHECK="0")
        result = subprocess.run([sys.executable, "-B", "-m", "backend.knowledge_graph.osk_projection",
                                 "--vault", str(self.vault), "--engine", str(self.engine),
                                 "--output", str(output or self.output)], cwd=self.repo,
                                env=env, capture_output=True, text=True, timeout=30)
        if expected:
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertEqual(json.loads(result.stderr), {"error": expected})
            return None
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((output or self.output).read_text())

    def snapshot(self):
        return {str(p.relative_to(self.vault)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.vault.rglob("*") if p.is_file()}

    def test_real_index_filters_both_edge_endpoints_and_preserves_typed_links(self):
        foreign = self.node("ForeignPrivateName", "claim", scope="sparkuniverse", body="PRIVATE_BODY_SENTINEL")
        foreign_id = json.loads(foreign.read_text().splitlines()[1].split(": ", 1)[1])
        video = self.node("TZ-Video-ABCDEFGHIJK", "video", metadata={
            "videoId": "ABCDEFGHIJK", "analysisStatus": "pending"},
            body=f"[[ForeignPrivateName]] [[{foreign_id}]] [[https://example.com/private]] [[Missing]]")
        self.node("TZ-Claim", "claim", body="[[TZ-Video-ABCDEFGHIJK#근거]]",
                  edges={"derived-from": ["[[TZ-Video-ABCDEFGHIJK]]"]})
        self.node("Unregistered", body="ordinary note")
        self.hub.write_text(self.hub.read_text() + "\n[[TZ-Claim]] [[Unregistered]]\n")
        before = self.snapshot()
        data = self.run_projection()
        encoded = json.dumps(data, ensure_ascii=False)
        for secret in ("ForeignPrivateName", foreign_id, "PRIVATE_BODY_SENTINEL", "sparkuniverse"):
            self.assertNotIn(secret, encoded)
        node_ids = {n["id"] for n in data["nodes"]}
        self.assertEqual(len(node_ids), 3)
        self.assertEqual(len(data["edges"]), 3)
        self.assertTrue(all(e["source"] in node_ids and e["target"] in node_ids for e in data["edges"]))
        self.assertEqual({e["relation"] for e in data["edges"]}, {"references", "derived-from"})
        self.assertEqual(data["diagnostics"]["excludedExternalEdges"], 3)
        self.assertEqual(data["diagnostics"]["excludedUnresolvedEdges"], 1)
        self.assertEqual(data["diagnostics"]["excludedUnregisteredNodes"], 1)
        self.assertEqual(data["diagnostics"]["excludedUnregisteredEdges"], 1)
        self.assertEqual(data["coverage"]["analyzedCount"], 0)
        self.assertEqual(before, self.snapshot())

    def test_coverage_counts_only_explicit_complete_video_nodes(self):
        self.hub.unlink()
        self.node("tzudong", "hub", coverage={"inventoryCount": 9, "eligibleCount": 7,
                  "excludedShortsCount": 2, "asOf": "2026-10-04T00:00:00Z"})
        self.node("Completed", "video", metadata={"videoId": "ABCDEFGHIJK", "analysisStatus": "complete", "evidence": [self.evidence()]})
        self.node("Pending", "video", metadata={"videoId": "BCDEFGHIJKL", "analysisStatus": "pending"})
        self.node("Failed", "video", metadata={"videoId": "CDEFGHIJKLM", "analysisStatus": "failed"})
        self.node("Claim", "claim", metadata={"evidence": [self.evidence()]})
        data = self.run_projection()
        self.assertEqual(data["coverage"], {"inventoryCount": 9, "eligibleCount": 7,
            "analyzedCount": 1, "pendingCount": 5, "failedCount": 1,
            "excludedShortsCount": 2, "asOf": "2026-10-04T00:00:00Z"})
        self.assertEqual(next(n for n in data["nodes"] if n["label"] == "Completed")["evidence"][0]["url"], "https://www.youtube.com/watch?v=ABCDEFGHIJK&t=12s")

    def test_complete_without_verified_evidence_fails(self):
        self.node("Video", "video", metadata={"videoId": "ABCDEFGHIJK", "analysisStatus": "complete", "evidence": [self.evidence(status="unverified")]})
        self.run_projection("OSK_ANALYSIS_UNVERIFIED")

    def test_metadata_marker_inside_code_is_not_registration(self):
        self.node("Example", body="```text\n" + projection.METADATA_HEADING + '\n```json\n{"schemaVersion":1,"kind":"claim"}\n```\n```')
        data = self.run_projection()
        self.assertEqual(len(data["nodes"]), 1)
        self.assertEqual(data["diagnostics"]["excludedUnregisteredNodes"], 1)

    def test_revision_ignores_clock_and_foreign_content_but_covers_scope_body(self):
        foreign = self.node("Foreign", "claim", scope="sparkuniverse", body="old")
        first = self.run_projection()
        self.assertRegex(first["revision"], r"^[a-f0-9]{64}$")
        self.assertEqual(self.run_projection()["revision"], first["revision"])
        foreign.write_text(foreign.read_text() + "foreign change")
        self.assertEqual(self.run_projection()["revision"], first["revision"])
        self.hub.write_text(self.hub.read_text() + "scope source change")
        self.assertNotEqual(self.run_projection()["revision"], first["revision"])

    def test_foreign_duplicate_identity_fails_without_leaking_names(self):
        own_id = json.loads(self.hub.read_text().splitlines()[1].split(": ", 1)[1])
        self.node("ForeignSecret", "claim", scope="sparkuniverse", identity=own_id)
        self.run_projection("OSK_IDENTITY_AMBIGUOUS")

    def test_same_title_in_foreign_scope_fails_closed(self):
        self.node("tzudong", scope="sparkuniverse")
        self.run_projection("OSK_IDENTITY_AMBIGUOUS")

    def test_broken_scope_node_preserves_previous_output(self):
        self.run_projection()
        previous = self.output.read_bytes()
        (self.hub.parent / "Damaged.md").write_text("---\nnot yaml node")
        self.run_projection("OSK_NODE_INVALID")
        self.assertEqual(self.output.read_bytes(), previous)

    def test_symlink_foreign_node_never_becomes_scoped(self):
        foreign = self.node("SecretLink", "claim", scope="sparkuniverse")
        (self.hub.parent / "Spoof.md").symlink_to(foreign)
        self.run_projection("OSK_IDENTITY_AMBIGUOUS")

    def test_duplicate_registry_keys_fail_closed(self):
        self.hub.write_text(self.hub.read_text().replace('"kind": "hub"', '"kind": "hub", "kind": "video"'))
        self.run_projection("OSK_METADATA_INVALID")

    def test_arbitrary_evidence_urls_and_mismatched_video_ids_fail(self):
        node = self.node("Claim", "claim", metadata={"evidence": [{**self.evidence(), "url": "https://example.com/PRIVATE"}]})
        self.run_projection("OSK_EVIDENCE_INVALID")
        node.unlink()
        self.node("Claim", "claim", metadata={"evidence": [{**self.evidence(), "url": "https://youtu.be/ZZZZZZZZZZZ"}]})
        self.run_projection("OSK_EVIDENCE_INVALID")

    def test_node_size_is_bounded_before_projection_and_output_inside_vault_is_refused(self):
        self.run_projection("OSK_OUTPUT_INSIDE_VAULT", output=self.vault / "result.json")
        self.node("Large", "claim", body="x" * projection.MAX_NODE_BYTES)
        self.run_projection("OSK_CAPACITY_EXCEEDED")

    def test_absent_scope_and_inconsistent_coverage_fail(self):
        self.hub.unlink()
        self.run_projection("OSK_SCOPE_UNAVAILABLE")
        self.node("tzudong", "hub", coverage={"inventoryCount": 2, "eligibleCount": 3})
        self.run_projection("OSK_COVERAGE_INVALID")

    def test_engine_pin_rejects_drift(self):
        fake = self.base / "engine"
        (fake / "osk").mkdir(parents=True)
        (fake / "osk/graph.py").write_text("# changed")
        with self.assertRaisesRegex(projection.ProjectionError, "OSK_ENGINE_UNSUPPORTED"):
            projection._load_engine(self.vault, fake)

    def test_final_json_cap_preserves_previous_output(self):
        self.output.write_text("previous successful artifact")
        result = subprocess.run([sys.executable, "-B", "-c",
            "import sys; from backend.knowledge_graph import osk_projection as p; "
            "p.MAX_OUTPUT_BYTES=128; sys.exit(p.main(sys.argv[1:]))",
            "--vault", str(self.vault), "--engine", str(self.engine), "--output", str(self.output)],
            cwd=self.repo, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr), {"error": "OSK_CAPACITY_EXCEEDED"})
        self.assertEqual(self.output.read_text(), "previous successful artifact")

    def test_source_change_during_read_refuses_mixed_snapshot(self):
        # Actual Index/Node parser, with one controlled write between reads.
        # The writer touches only this disposable fixture, never the real vault.
        script = """import sys
from pathlib import Path
from backend.knowledge_graph import osk_projection as p
old = p._inventory
calls = 0
def changing(graph):
    global calls
    calls += 1
    if calls == 2:
        path = Path(sys.argv[1]) / '00_Scope/tzudong/tzudong.md'
        path.write_text(path.read_text() + '\\nchanged during projection\\n')
    return old(graph)
p._inventory = changing
sys.exit(p.main(['--vault',sys.argv[1],'--engine',sys.argv[2],'--output',sys.argv[3]]))
"""
        result = subprocess.run([sys.executable, "-B", "-c", script,
            str(self.vault), str(self.engine), str(self.output)], cwd=self.repo,
            capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr), {"error": "OSK_SOURCE_CHANGED"})
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
