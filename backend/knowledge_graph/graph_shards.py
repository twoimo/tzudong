"""Offline, lossless sharding of an already validated Tzudong projection.

This module never reads an OSK vault or calls its engine/providers. It keeps the
single-export contract unchanged: callers opt in to a manifest (schemaVersion 2).
Node and edge limits apply to each immutable shard, not to truncated prefixes.
The existing producer must still validate scope, source revision and coverage.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from backend.knowledge_graph import osk_projection as projection

FORMAT = "tzudong-graph-shards/v1"
TREE_FORMAT = "tzudong-graph-tree/v1"
MAX_TOTAL_COUNT = (1 << 53) - 1  # Exact shared Python/JavaScript graph totals.
MAX_MANIFEST_CHILDREN = 256
MAX_TREE_DEPTH = 8
IDENTIFIER = re.compile(r"^[a-zA-Z0-9_.:-]{1,160}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
DIAGNOSTICS = {"excludedUnregisteredNodes", "excludedExternalEdges", "excludedUnresolvedEdges",
               "excludedUnregisteredEdges", "excludedUnsupportedEdges"}


class GraphShardError(Exception):
    """Fixed, non-diagnostic boundary codes only."""


def fail(code="GRAPH_SHARD_INVALID"):
    raise GraphShardError(code)


def encode(value):
    return projection._json(value) + b"\n"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def identifier(value):
    return isinstance(value, str) and bool(IDENTIFIER.fullmatch(value))


def count(value):
    return type(value) is int and 0 <= value <= MAX_TOTAL_COUNT


def validate_metadata(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1 or snapshot.get("scope") != "tzudong":
        fail()
    if not isinstance(snapshot.get("revision"), str) or not DIGEST.fullmatch(snapshot["revision"]):
        fail()
    try:
        if projection._iso(snapshot.get("generatedAt")) is None:
            fail()
        coverage = snapshot["coverage"]
        fields = {"inventoryCount", "eligibleCount", "analyzedCount", "pendingCount", "failedCount", "excludedShortsCount", "asOf"}
        if not isinstance(coverage, dict) or set(coverage) != fields:
            fail()
        for key in fields - {"asOf"}:
            if not ((type(coverage[key]) is int and 0 <= coverage[key] <= projection.MAX_COUNT) or (coverage[key] is None and key not in {"analyzedCount", "failedCount"})):
                fail()
        projection._iso(coverage["asOf"])
        eligible, inventory = coverage["eligibleCount"], coverage["inventoryCount"]
        if eligible is not None and (coverage["analyzedCount"] + coverage["failedCount"] > eligible
                                    or coverage["pendingCount"] != eligible - coverage["analyzedCount"] - coverage["failedCount"]):
            fail()
        if inventory is not None and eligible is not None and eligible > inventory:
            fail()
        diagnostics = snapshot.get("diagnostics", {})
        if not isinstance(diagnostics, dict) or set(diagnostics) - DIAGNOSTICS or not all(count(v) for v in diagnostics.values()):
            fail()
    except (KeyError, TypeError, projection.ProjectionError):
        fail()


def validate_nodes(nodes):
    seen = set()
    for node in nodes:
        if not isinstance(node, dict) or set(node) - {"id", "label", "kind", "summary", "evidence", "displayTitle", "displayStage"} or not {"id", "label", "kind", "summary", "evidence"} <= set(node):
            fail()
        if 'displayTitle' in node or 'displayStage' in node:
            title = node.get('displayTitle')
            if node.get('kind') != 'video' or not isinstance(title, str) or not title.strip() or len(title) > 512 or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in title) or node.get('displayStage') != 'caption-first-pass':
                fail()
        if not identifier(node["id"]) or node["id"] in seen or node["kind"] not in projection.KINDS:
            fail()
        if not isinstance(node["label"], str) or not node["label"].strip() or len(node["label"]) > 512:
            fail()
        if not isinstance(node["summary"], str) or len(node["summary"]) > 4000:
            fail()
        try:
            # Validate without rewriting provenance or evidence order.
            validated = projection._evidence(node["evidence"])
            if sorted(node["evidence"], key=projection._json) != validated:
                fail()
        except (projection.ProjectionError, TypeError):
            fail()
        seen.add(node["id"])
    return seen


def validate_edges(edges, node_ids):
    seen = set()
    for edge in edges:
        if not isinstance(edge, dict) or set(edge) != {"id", "source", "target", "relation"}:
            fail()
        if not identifier(edge["id"]) or edge["id"] in seen or edge["source"] not in node_ids or edge["target"] not in node_ids:
            fail()
        if edge["relation"] not in {"references", "derived-from"}:
            fail()
        seen.add(edge["id"])


@dataclass(frozen=True)
class GraphShardBundle:
    manifest: dict
    files: dict[str, bytes]


def build_graph_shards(snapshot: dict) -> GraphShardBundle:
    """Partition the complete supplied graph, retaining all nodes and edges."""
    validate_metadata(snapshot)
    nodes, edges = snapshot.get("nodes"), snapshot.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list) or not count(len(nodes)) or not count(len(edges)):
        fail("GRAPH_TOTAL_CAPACITY_EXCEEDED")
    validate_edges(edges, validate_nodes(nodes))
    files = {}

    def partition(items, kind, maximum):
        descriptors, current = [], []
        envelope = {"schemaVersion": 1, "scope": "tzudong", "revision": snapshot["revision"], "kind": kind, "items": []}
        empty_bytes = len(encode(envelope))
        current_bytes = empty_bytes

        def emit():
            if not current:
                return
            encoded = encode({**envelope, "items": current})
            if len(encoded) > projection.MAX_OUTPUT_BYTES:
                fail("GRAPH_SHARD_CAPACITY_EXCEEDED")
            sha = digest(encoded)
            path = f"shards/{kind}-{sha}.json"
            files[path] = encoded
            descriptors.append({"path": path, "sha256": sha, "bytes": len(encoded), "count": len(current),
                                "firstId": current[0]["id"], "lastId": current[-1]["id"]})

        for item in sorted(items, key=lambda value: value["id"]):
            size = len(projection._json(item))
            if empty_bytes + size > projection.MAX_OUTPUT_BYTES:
                fail("GRAPH_SHARD_ITEM_TOO_LARGE")
            if current and (len(current) == maximum or current_bytes + size + 1 > projection.MAX_OUTPUT_BYTES):
                emit()
                current, current_bytes = [], empty_bytes
            current_bytes += size + bool(current)
            current.append(item)
        emit()
        return descriptors

    manifest = {"schemaVersion": 2, "format": FORMAT, "scope": "tzudong", "revision": snapshot["revision"],
                "generatedAt": snapshot["generatedAt"], "coverage": snapshot["coverage"], "diagnostics": snapshot.get("diagnostics", {}),
                "totalNodes": len(nodes), "totalEdges": len(edges),
                "nodeShards": partition(nodes, "nodes", projection.MAX_NODES),
                "edgeShards": partition(edges, "edges", projection.MAX_EDGES)}
    # Preserve the v2 wire bytes for previously supported exports. Larger
    # descriptor lists become authenticated trees, never larger root documents.
    if max(len(nodes), len(edges)) > 1_000_000 or len(encode(manifest)) > projection.MAX_OUTPUT_BYTES or max(len(manifest["nodeShards"]), len(manifest["edgeShards"])) > MAX_MANIFEST_CHILDREN:
        manifest.update(schemaVersion=3, format=TREE_FORMAT)
        for kind, key in (("nodes", "nodeShards"), ("edges", "edgeShards")):
            manifest[key] = index_descriptors(manifest[key], kind, snapshot["revision"], files)
    if len(encode(manifest)) > projection.MAX_OUTPUT_BYTES:
        fail("GRAPH_MANIFEST_CAPACITY_EXCEEDED")
    return GraphShardBundle(manifest, files)


def index_descriptors(descriptors, kind, revision, files):
    """Every index has bounded fanout; counts/ranges include all descendants."""
    level, entries = 0, [dict(entry, level=0) for entry in descriptors]
    while len(entries) > MAX_MANIFEST_CHILDREN:
        level += 1
        if level > MAX_TREE_DEPTH:
            fail("GRAPH_MANIFEST_CAPACITY_EXCEEDED")
        parents = []
        for offset in range(0, len(entries), MAX_MANIFEST_CHILDREN):
            children = entries[offset:offset + MAX_MANIFEST_CHILDREN]
            data = encode({"schemaVersion": 1, "scope": "tzudong", "revision": revision,
                           "kind": kind + "-index", "level": level, "items": children})
            if len(data) > projection.MAX_OUTPUT_BYTES:
                fail("GRAPH_MANIFEST_CAPACITY_EXCEEDED")
            sha = digest(data)
            path = f"shards/{kind}-index-{sha}.json"
            files[path] = data
            parents.append({"path": path, "sha256": sha, "bytes": len(data),
                            "count": sum(entry["count"] for entry in children),
                            "firstId": children[0]["firstId"], "lastId": children[-1]["lastId"], "level": level})
        entries = parents
    return entries


def leaf_descriptors(bundle, kind):
    seen = set()
    def visit(entries, expected_level=None):
        for entry in entries:
            path = entry["path"]
            if path in seen:
                fail()
            seen.add(path)
            data = bundle.files[path]
            if len(data) != entry["bytes"] or digest(data) != entry["sha256"] or len(data) > projection.MAX_OUTPUT_BYTES:
                fail()
            level = entry.get("level", 0)
            if type(level) is not int or not 0 <= level <= MAX_TREE_DEPTH or (expected_level is not None and level != expected_level):
                fail()
            suffix = "-index" if level else ""
            if path != f"shards/{kind}{suffix}-{entry['sha256']}.json":
                fail()
            if level:
                part = json.loads(data)
                if (set(part) != {"schemaVersion", "scope", "revision", "kind", "level", "items"}
                        or part["schemaVersion"] != 1 or part["scope"] != "tzudong"
                        or part["revision"] != bundle.manifest["revision"] or part["kind"] != kind + "-index"
                        or part["level"] != level or not 1 <= len(part["items"]) <= MAX_MANIFEST_CHILDREN):
                    fail()
                yield from visit(part["items"], level - 1)
            else:
                yield entry
    yield from visit(bundle.manifest["nodeShards" if kind == "nodes" else "edgeShards"])



def write_graph_shards(bundle: GraphShardBundle, destination: Path) -> None:
    """Publish immutable files before replacing the manifest; never delete old shards.

    The caller must enforce its output-outside-vault policy. This independent
    helper only writes the explicitly supplied output directory, not OSK nodes.
    """
    destination = Path(destination)
    if destination.is_symlink() or not destination.parent.is_dir():
        fail("GRAPH_OUTPUT_INVALID")
    if not isinstance(bundle.manifest, dict) or set(bundle.manifest) != {"schemaVersion", "format", "scope", "revision", "generatedAt", "coverage", "diagnostics", "totalNodes", "totalEdges", "nodeShards", "edgeShards"}:
        fail()
    if (bundle.manifest["schemaVersion"], bundle.manifest["format"]) not in {(2, FORMAT), (3, TREE_FORMAT)}:
        fail()
    # The dataclass is frozen, but dictionaries supplied by a caller can still
    # change. Reconstruct and compare before publication, including exact totals,
    # ranges, provenance, node identity, and cross-shard edge endpoints.
    try:
        reconstructed = {key: bundle.manifest[key] for key in ("scope", "revision", "generatedAt", "coverage", "diagnostics")}
        reconstructed["schemaVersion"] = 1
        for kind, key in (("nodes", "nodeShards"), ("edges", "edgeShards")):
            reconstructed[kind] = [item for part in leaf_descriptors(bundle, kind) for item in json.loads(bundle.files[part["path"]])["items"]]
        validated = build_graph_shards(reconstructed)
        if validated.manifest != bundle.manifest or validated.files != bundle.files:
            fail()
    except (KeyError, TypeError, ValueError):
        fail()
    encoded_manifest = encode(bundle.manifest)
    if len(encoded_manifest) > projection.MAX_OUTPUT_BYTES:
        fail("GRAPH_MANIFEST_CAPACITY_EXCEEDED")
    shard_directory = destination.parent / "shards"
    if shard_directory.is_symlink():
        fail("GRAPH_OUTPUT_INVALID")
    shard_directory.mkdir(exist_ok=True)

    def atomic_write(path, data):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".graph-shard-", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    for name, data in bundle.files.items():
        path = destination.parent / name
        if path.is_symlink():
            fail("GRAPH_OUTPUT_INVALID")
        if path.exists():
            if path.read_bytes() != data:
                fail("GRAPH_EXISTING_SHARD_CHANGED")
        else:
            atomic_write(path, data)
    atomic_write(destination, encoded_manifest)
