"""Synthetic graph capacity tests; no OSK engine, vault or provider is used."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.knowledge_graph import graph_shards as shards


def synthetic_graph(node_count=12829, edge_count=25656):
    nodes = [{"id": f"n-{i:06d}", "label": f"합성 노드 {i}", "kind": "video" if i < 1069 else "claim",
              "summary": "합성 용량 검증. 실제 영상 분석이 아닙니다. " * 6, "evidence": []} for i in range(node_count)]
    edges = [{"id": f"e-{i:06d}", "source": nodes[i % node_count]["id"], "target": nodes[(i + node_count // 2) % node_count]["id"], "relation": "references"} for i in range(edge_count)]
    return {"schemaVersion": 1, "scope": "tzudong", "revision": "a" * 64, "generatedAt": "2026-10-05T00:00:00Z", "nodes": nodes, "edges": edges,
            "coverage": {"inventoryCount": 1069, "eligibleCount": 1069, "analyzedCount": 0, "pendingCount": 1069, "failedCount": 0, "excludedShortsCount": 0, "asOf": None}, "diagnostics": {"excludedExternalEdges": 3}}


class GraphShardTests(unittest.TestCase):
    def test_exceeds_all_old_export_limits_without_loss_or_coverage_invention(self):
        graph = synthetic_graph()
        self.assertGreater(len(shards.encode(graph)), shards.projection.MAX_OUTPUT_BYTES)
        bundle = shards.build_graph_shards(graph)
        self.assertGreater(len(bundle.manifest["nodeShards"]), 1)
        self.assertGreater(len(bundle.manifest["edgeShards"]), 1)
        for key, expected, maximum in [("nodeShards", graph["nodes"], 5000), ("edgeShards", graph["edges"], 20000)]:
            actual = []
            for descriptor in bundle.manifest[key]:
                content = bundle.files[descriptor["path"]]
                self.assertLessEqual(len(content), 4 * 1024 * 1024)
                self.assertLessEqual(descriptor["count"], maximum)
                self.assertEqual(shards.digest(content), descriptor["sha256"])
                actual.extend(json.loads(content)["items"])
            self.assertEqual(actual, expected)
        self.assertEqual(bundle.manifest["totalNodes"], len(graph["nodes"]))
        self.assertEqual(bundle.manifest["totalEdges"], len(graph["edges"]))
        self.assertEqual(bundle.manifest["coverage"], graph["coverage"])
        self.assertEqual(bundle.manifest["diagnostics"], graph["diagnostics"])

    def test_deterministic_partition_and_cross_shard_edges(self):
        graph = synthetic_graph(11, 23)
        with patch.object(shards.projection, "MAX_NODES", 3), patch.object(shards.projection, "MAX_EDGES", 4):
            first = shards.build_graph_shards(graph)
            shuffled = {**graph, "nodes": list(reversed(graph["nodes"])), "edges": list(reversed(graph["edges"]))}
            second = shards.build_graph_shards(shuffled)
        self.assertEqual(first, second)
        self.assertEqual(sum(part["count"] for part in first.manifest["edgeShards"]), 23)
        first_node_ids = {item["id"] for item in json.loads(first.files[first.manifest["nodeShards"][0]["path"]])["items"]}
        self.assertTrue(any(edge["source"] in first_node_ids and edge["target"] not in first_node_ids for edge in graph["edges"]))

    def test_hierarchical_manifest_roundtrip_and_tamper_rejection(self):
        graph = synthetic_graph(17, 31)
        with patch.object(shards, "MAX_MANIFEST_CHILDREN", 2), patch.object(shards.projection, "MAX_NODES", 1), patch.object(shards.projection, "MAX_EDGES", 1):
            bundle = shards.build_graph_shards(graph)
            self.assertEqual(bundle.manifest["schemaVersion"], 3)
            self.assertGreater(bundle.manifest["nodeShards"][0]["level"], 1)
            for kind in ("nodes", "edges"):
                actual = [item for entry in shards.leaf_descriptors(bundle, kind) for item in json.loads(bundle.files[entry["path"]])["items"]]
                self.assertEqual(actual, graph[kind])
            with tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "graph.json"
                shards.write_graph_shards(bundle, destination)
                previous = destination.read_bytes()
                corrupt = copy.deepcopy(bundle)
                corrupt.manifest["nodeShards"][0]["count"] += 1
                with self.assertRaises(shards.GraphShardError):
                    shards.write_graph_shards(corrupt, destination)
                self.assertEqual(destination.read_bytes(), previous)
                corrupt = copy.deepcopy(bundle)
                corrupt.files[next(path for path in corrupt.files if "-index-" in path)] += b" "
                with self.assertRaises(shards.GraphShardError):
                    shards.write_graph_shards(corrupt, destination)
                self.assertEqual(destination.read_bytes(), previous)
                corrupt = copy.deepcopy(bundle)
                corrupt.files["shards/foreign.json"] = b"{}"
                with self.assertRaises(shards.GraphShardError):
                    shards.write_graph_shards(corrupt, destination)

    def test_large_descriptor_totals_use_tree_without_a_million_cap(self):
        # A mathematically exact high-count descriptor hierarchy exercises totals
        # without pretending a synthetic descriptor is a real source export.
        files = {}
        entries = [{"path": "shards/edges-" + f"{i:064x}" + ".json", "sha256": f"{i:064x}",
                    "bytes": 100, "count": 20000, "firstId": f"e-{i:06d}-0", "lastId": f"e-{i:06d}-9"} for i in range(1000)]
        tree = shards.index_descriptors(entries, "edges", "a" * 64, files)
        self.assertEqual(sum(item["count"] for item in tree), 20_000_000)
        self.assertTrue(all(len(data) <= shards.projection.MAX_OUTPUT_BYTES for data in files.values()))
        self.assertLessEqual(len(tree), shards.MAX_MANIFEST_CHILDREN)

    def test_single_oversized_item_fails_without_truncation(self):
        with patch.object(shards.projection, "MAX_OUTPUT_BYTES", 400):
            with self.assertRaisesRegex(shards.GraphShardError, "GRAPH_SHARD_ITEM_TOO_LARGE"):
                shards.build_graph_shards(synthetic_graph(2, 1))

    def test_rejects_foreign_scope_duplicate_identity_dangling_edge_and_fake_coverage(self):
        original = synthetic_graph(3, 2)
        variants = []
        foreign = copy.deepcopy(original); foreign["scope"] = "other"; variants.append(foreign)
        duplicate = copy.deepcopy(original); duplicate["nodes"].append(duplicate["nodes"][0]); variants.append(duplicate)
        dangling = copy.deepcopy(original); dangling["edges"][0]["target"] = "foreign-node"; variants.append(dangling)
        coverage = copy.deepcopy(original); coverage["coverage"]["analyzedCount"] = 1069; variants.append(coverage)
        for graph in variants:
            with self.assertRaises(shards.GraphShardError):
                shards.build_graph_shards(graph)

    def test_manifest_is_last_and_previous_generation_is_preserved_on_failure(self):
        bundle = shards.build_graph_shards(synthetic_graph(3, 2))
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "graph.json"
            destination.write_text('"previous single export"')
            original_replace = shards.os.replace
            def fail_manifest(source, target):
                if Path(target) == destination:
                    raise OSError("synthetic interruption")
                return original_replace(source, target)
            with patch.object(shards.os, "replace", side_effect=fail_manifest):
                with self.assertRaises(OSError):
                    shards.write_graph_shards(bundle, destination)
            self.assertEqual(destination.read_text(), '"previous single export"')
            shards.write_graph_shards(bundle, destination)
            self.assertEqual(json.loads(destination.read_bytes()), bundle.manifest)
            old_files = set((Path(directory) / "shards").iterdir())
            graph = synthetic_graph(4, 3); graph["revision"] = "b" * 64
            shards.write_graph_shards(shards.build_graph_shards(graph), destination)
            self.assertTrue(old_files.issubset(set((Path(directory) / "shards").iterdir())))

    def test_writer_refuses_modified_shards_before_replacing_legacy_output(self):
        bundle = shards.build_graph_shards(synthetic_graph(3, 2))
        bundle.files[next(iter(bundle.files))] += b" "
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "graph.json"; destination.write_text("legacy")
            with self.assertRaises(shards.GraphShardError):
                shards.write_graph_shards(bundle, destination)
            self.assertEqual(destination.read_text(), "legacy")
            self.assertFalse((Path(directory) / "shards").exists())

    def test_manifest_count_tampering_fails_before_filesystem_changes(self):
        bundle = shards.build_graph_shards(synthetic_graph(3, 2))
        bundle.manifest["totalEdges"] = 1
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "graph.json"
            with self.assertRaises(shards.GraphShardError):
                shards.write_graph_shards(bundle, destination)
            self.assertFalse(destination.exists())
            self.assertFalse((Path(directory) / "shards").exists())


if __name__ == "__main__":
    unittest.main()
