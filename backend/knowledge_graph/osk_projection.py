"""Read-only projection of the pinned OSK engine's Tzudong scope.

Run with the existing OSK Python environment (no installation is performed):
  python3 -m backend.knowledge_graph.osk_projection --vault VAULT --output FILE
``--engine`` selects the existing engine for an isolated fixture vault. Output
must be outside the vault. No MCP, ledger, scope-memory or network calls occur.

Registered nodes contain exactly one section:
  ## Tzudong graph metadata
  ```json
  {"schemaVersion":1,"kind":"video","videoId":"ABCDEFGHIJK",
   "analysisStatus":"pending","evidence":[]}
  ```
Kinds: hub, video, restaurant, menu, claim. Only video nodes may carry videoId
and analysisStatus (pending/complete/failed). Complete requires verified evidence
for that video; mere node existence never counts as analysis. The root hub may
add coverage:{inventoryCount,eligibleCount,excludedShortsCount,asOf}; unknowns
are null. These declarations are producer evidence, not semantic verification.
OSK frontmatter is unchanged. Full bodies and filesystem paths never leave the
adapter. Links to other scopes, raw records, external URLs and unregistered
nodes are omitted and counted without exposing their identifiers.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import parse_qs, urlsplit

SCOPE = "tzudong"
METADATA_HEADING = "## Tzudong graph metadata"
MAX_NODES = 5000
MAX_EDGES = 20000
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_NODE_BYTES = 128 * 1024
MAX_SCOPE_BYTES = 64 * 1024 * 1024
MAX_EVIDENCE = 16
MAX_COUNT = 1_000_000
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
KINDS = {"hub", "video", "restaurant", "menu", "claim"}
# Observed upstream/current install 3472a9619a25a86290488fd6aa21f5c195bb4393.
# Pin the internal APIs actually consumed, rather than a mutable vault Git HEAD.
ENGINE_API_SHA256 = {
    "osk/graph.py": "1dd399c53290ed9d9c32ceaacf19ca8d78a81f654e4d5ea8af6816e1f3372376",
    "osk/contract.py": "c829b5bc018316cfe8554d8e94d165e47350eb2e4b17e897662de3c2dd0f2feb",
    "osk/core.py": "1340bab3003887237e1130c80c2948383470886902f9decd88030be229c67f9a",
    "osk/layout.py": "4c533d75a5f15b53d47c2137e58f0b523015e5cc21f6bc36e3fc96a5d005eaab",
}


class ProjectionError(Exception):
    """Only fixed codes may cross the command/API boundary."""


def _fail(code: str) -> None:
    raise ProjectionError(code)


def _json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("OSK_METADATA_INVALID")
        result[key] = value
    return result


def _metadata(body: str) -> dict | None:
    # Require the marker outside a code fence; examples in code are not registry.
    lines = body.splitlines()
    markers = []
    fence = None
    for i, line in enumerate(lines):
        match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if match:
            run, tail = match.groups()
            if fence is None:
                fence = (run[0], len(run))
            elif run[0] == fence[0] and len(run) >= fence[1] and not tail.strip():
                fence = None
            continue
        if fence is None and line == METADATA_HEADING:
            markers.append(i)
    if not markers:
        return None
    if len(markers) != 1:
        _fail("OSK_METADATA_INVALID")
    i = markers[0] + 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i] != "```json":
        _fail("OSK_METADATA_INVALID")
    end = next((j for j in range(i + 1, len(lines)) if lines[j] == "```"), None)
    if end is None:
        _fail("OSK_METADATA_INVALID")
    try:
        data = json.loads("\n".join(lines[i + 1:end]), object_pairs_hook=_unique_object,
                          parse_constant=lambda _: _fail("OSK_METADATA_INVALID"))
    except (ValueError, RecursionError):
        _fail("OSK_METADATA_INVALID")
    if not isinstance(data, dict) or type(data.get("schemaVersion")) is not int or data["schemaVersion"] != 1:
        _fail("OSK_METADATA_INVALID")
    allowed = {"schemaVersion", "kind", "evidence", "videoId", "analysisStatus", "coverage", "displayLabel"}
    if set(data) - allowed or data.get("kind") not in KINDS:
        _fail("OSK_METADATA_INVALID")
    label = data.get("displayLabel")
    if label is not None and (not isinstance(label, str) or not label.strip() or len(label) > 512):
        _fail("OSK_METADATA_INVALID")
    return data


def _iso(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 40:
        _fail("OSK_COVERAGE_INVALID")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None or "T" not in value:
            raise ValueError()
    except ValueError:
        _fail("OSK_COVERAGE_INVALID")
    return stamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _count(value: object) -> int | None:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= MAX_COUNT:
        _fail("OSK_COVERAGE_INVALID")
    return value


def _evidence(values: object) -> list[dict]:
    if not isinstance(values, list) or len(values) > MAX_EVIDENCE:
        _fail("OSK_EVIDENCE_INVALID")
    out = []
    for item in values:
        if not isinstance(item, dict) or set(item) != {"videoId", "startSeconds", "endSeconds", "url", "status"}:
            _fail("OSK_EVIDENCE_INVALID")
        vid, start, end = item["videoId"], item["startSeconds"], item["endSeconds"]
        if not isinstance(vid, str) or not VIDEO_ID.fullmatch(vid) or item["status"] not in {"verified", "unverified"}:
            _fail("OSK_EVIDENCE_INVALID")
        for number in (start, end):
            if number is not None and (type(number) not in (int, float) or not math.isfinite(number) or not 0 <= number <= 1_000_000_000):
                _fail("OSK_EVIDENCE_INVALID")
        if start is None or (end is not None and end < start):
            _fail("OSK_EVIDENCE_INVALID")
        url = item["url"]
        if not isinstance(url, str) or len(url) > 256:
            _fail("OSK_EVIDENCE_INVALID")
        try:
            parsed = urlsplit(url)
            query = parse_qs(parsed.query, keep_blank_values=True)
            valid = (parsed.scheme == "https" and not parsed.username and not parsed.password
                     and parsed.port is None and not parsed.fragment)
            if parsed.netloc in {"www.youtube.com", "youtube.com"}:
                valid = valid and parsed.path == "/watch" and query.get("v") == [vid] and not set(query) - {"v", "t"}
            elif parsed.netloc == "youtu.be":
                valid = valid and parsed.path == "/" + vid and not set(query) - {"t"}
            else:
                valid = False
            if "t" in query:
                valid = valid and len(query["t"]) == 1 and bool(re.fullmatch(r"[0-9]+(?:\.[0-9]+)?s?", query["t"][0]))
        except ValueError:
            valid = False
        if not valid:
            _fail("OSK_EVIDENCE_INVALID")
        # Never forward arbitrary query strings. Timestamp comes from typed data.
        canonical = f"https://www.youtube.com/watch?v={vid}"
        if start:
            canonical += f"&t={start:g}s"
        out.append({"videoId": vid, "startSeconds": start, "endSeconds": end,
                    "url": canonical, "status": item["status"]})
    return sorted(out, key=lambda x: _json(x))


def _load_engine(vault: Path, engine: Path):
    for relative, digest in ENGINE_API_SHA256.items():
        if hashlib.sha256((engine / relative).read_bytes()).hexdigest() != digest:
            _fail("OSK_ENGINE_UNSUPPORTED")
    if "osk.core" in sys.modules:
        core = sys.modules["osk.core"]
        if core.ROOT != vault or Path(core.__file__).resolve().parent.parent != engine:
            _fail("OSK_PROCESS_ROOT_CONFLICT")
    else:
        # Set before import: OSK module globals are process-bound. Prevent pycache
        # writes into the user's installed engine as part of this read operation.
        sys.dont_write_bytecode = True
        os.environ["OSK_VAULT_ROOT"] = str(vault)
        sys.path.insert(0, str(engine))
    graph = importlib.import_module("osk.graph")
    contract = importlib.import_module("osk.contract")
    core = importlib.import_module("osk.core")
    if core.ROOT != vault or any(Path(module.__file__).resolve().parent.parent != engine
                                 for module in (graph, contract, core)):
        _fail("OSK_PROCESS_ROOT_CONFLICT")
    return graph, contract


def _inventory(graph) -> tuple[list, tuple]:
    errors = []
    entries = list(graph.iter_nodes(errors))
    if errors:
        _fail("OSK_SOURCE_UNAVAILABLE")
    signature = []
    for path, _kind in entries:
        stat = path.stat()
        signature.append((str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
    return entries, tuple(signature)


def project_vault(vault: Path, engine: Path | None = None, *, generated_at: str | None = None) -> dict:
    """Build a bounded snapshot; never mutate the vault or expose parser errors."""
    vault = vault.resolve(strict=True)
    engine = (engine or vault / "_governance/_engine").resolve(strict=True)
    graph, contract = _load_engine(vault, engine)
    entries, signature = _inventory(graph)
    scoped = [path for path, kind in entries if kind == ("scope", SCOPE)]
    if not scoped:
        _fail("OSK_SCOPE_UNAVAILABLE")
    if len(scoped) > MAX_NODES:
        _fail("OSK_CAPACITY_EXCEEDED")
    source_bytes = {}
    total_bytes = 0
    for path in scoped:
        if path.stat().st_size > MAX_NODE_BYTES:
            _fail("OSK_CAPACITY_EXCEEDED")
        data = path.read_bytes()
        total_bytes += len(data)
        if len(data) > MAX_NODE_BYTES or total_bytes > MAX_SCOPE_BYTES:
            _fail("OSK_CAPACITY_EXCEEDED")
        source_bytes[path] = data
    idx = graph.Index()
    # OSK refuses ambiguous global names/IDs. Do not accidentally pick a foreign
    # duplicate, and never serialize its name or diagnostic path in an error.
    if idx.scan_errors or not idx.complete:
        _fail("OSK_SOURCE_UNAVAILABLE")
    if idx.dup_ids or idx.dup_stems:
        _fail("OSK_IDENTITY_AMBIGUOUS")
    nodes, by_path, declarations = [], {}, {}
    diagnostics = {"excludedUnregisteredNodes": 0, "excludedExternalEdges": 0,
                   "excludedUnresolvedEdges": 0, "excludedUnregisteredEdges": 0,
                   "excludedUnsupportedEdges": 0}
    inventory_count = eligible_count = shorts_count = as_of = None
    root_seen = False
    for path in scoped:
        try:
            node = idx.node(path)
            retained = contract.parse_bytes(path, source_bytes[path])
            if node.meta != retained.meta or node.body != retained.body:
                _fail("OSK_SOURCE_CHANGED")
            if contract.validate(node):
                _fail("OSK_NODE_INVALID")
        except ProjectionError:
            raise
        except Exception:
            _fail("OSK_NODE_INVALID")
        metadata = _metadata(node.body)
        if metadata is None:
            diagnostics["excludedUnregisteredNodes"] += 1
            continue
        kind = metadata["kind"]
        if (kind == "hub") != graph.is_hub(path):
            _fail("OSK_METADATA_INVALID")
        if not 1 <= len(path.stem) <= 120 or not isinstance(node.meta["summary"], str):
            _fail("OSK_NODE_INVALID")
        evidence = _evidence(metadata.get("evidence", []))
        if kind == "video":
            vid = metadata.get("videoId")
            state = metadata.get("analysisStatus")
            if not isinstance(vid, str) or not VIDEO_ID.fullmatch(vid) or state not in {"pending", "complete", "failed"} or vid in declarations:
                _fail("OSK_METADATA_INVALID")
            if state == "complete" and not any(e["videoId"] == vid and e["status"] == "verified" for e in evidence):
                _fail("OSK_ANALYSIS_UNVERIFIED")
            declarations[vid] = state
        elif "videoId" in metadata or "analysisStatus" in metadata:
            _fail("OSK_METADATA_INVALID")
        is_root = path.parent == vault / graph.SCOPE / SCOPE and path.stem == SCOPE
        if is_root:
            root_seen = True
        if "coverage" in metadata:
            coverage = metadata["coverage"]
            if not is_root or not isinstance(coverage, dict) or set(coverage) - {"inventoryCount", "eligibleCount", "excludedShortsCount", "asOf"}:
                _fail("OSK_COVERAGE_INVALID")
            inventory_count = _count(coverage.get("inventoryCount"))
            eligible_count = _count(coverage.get("eligibleCount"))
            shorts_count = _count(coverage.get("excludedShortsCount"))
            as_of = _iso(coverage.get("asOf"))
        projected = {"id": node.id, "label": metadata.get("displayLabel", path.stem), "kind": kind,
                     "summary": node.meta["summary"], "evidence": evidence}
        nodes.append(projected)
        by_path[path.resolve()] = (projected, node)
    if not root_seen:
        _fail("OSK_SCOPE_HUB_UNREGISTERED")
    analyzed = sum(value == "complete" for value in declarations.values())
    failed = sum(value == "failed" for value in declarations.values())
    if eligible_count is not None and eligible_count < len(declarations):
        _fail("OSK_COVERAGE_INVALID")
    if inventory_count is not None and any(v is not None and v > inventory_count for v in (eligible_count, shorts_count)):
        _fail("OSK_COVERAGE_INVALID")
    if all(v is not None for v in (inventory_count, eligible_count, shorts_count)) and eligible_count + shorts_count > inventory_count:
        _fail("OSK_COVERAGE_INVALID")
    edges = {}
    for source, node in by_path.values():
        for relation, reference in node.references():
            if relation not in {"Link", "derived-from"}:
                diagnostics["excludedUnsupportedEdges"] += 1
                continue
            target_ref = reference.split("#", 1)[0]
            resolved = idx.resolve(target_ref)
            if resolved[0] == "ambiguous":
                _fail("OSK_IDENTITY_AMBIGUOUS")
            if resolved[0] == "dangling":
                diagnostics["excludedUnresolvedEdges"] += 1
                continue
            if resolved[0] != "node" or resolved[1] != ("scope", SCOPE):
                diagnostics["excludedExternalEdges"] += 1
                continue
            located = idx.locate(target_ref)
            if not located or graph.space_of(located[0]) != ("scope", SCOPE):
                _fail("OSK_REFERENCE_INVALID")
            target = by_path.get(located[0].resolve())
            if target is None:
                diagnostics["excludedUnregisteredEdges"] += 1
                continue
            edge_kind = "references" if relation == "Link" else "derived-from"
            identity = [source["id"], target[0]["id"], edge_kind]
            eid = hashlib.sha256(_json(identity)).hexdigest()
            edges[eid] = {"id": eid, "source": identity[0], "target": identity[1], "relation": edge_kind}
            if len(edges) > MAX_EDGES:
                _fail("OSK_CAPACITY_EXCEEDED")
    # Check content, addition/removal and identity races before publishing.
    if _inventory(graph)[1] != signature or any(path.read_bytes() != data for path, data in source_bytes.items()):
        _fail("OSK_SOURCE_CHANGED")
    payload = {"schemaVersion": 1, "scope": SCOPE,
               "nodes": sorted(nodes, key=lambda n: n["id"]),
               "edges": sorted(edges.values(), key=lambda e: e["id"]),
               "coverage": {"inventoryCount": inventory_count, "eligibleCount": eligible_count,
                            "analyzedCount": analyzed, "pendingCount": None if eligible_count is None else eligible_count - analyzed - failed,
                            "failedCount": failed, "excludedShortsCount": shorts_count, "asOf": as_of},
               "diagnostics": diagnostics}
    # Include all retained scope source bytes; changes not displayed in the small
    # projection still invalidate the content revision. Foreign content does not.
    source_hashes = sorted((path.relative_to(vault).as_posix(), hashlib.sha256(data).hexdigest())
                           for path, data in source_bytes.items())
    payload["revision"] = hashlib.sha256(_json({"projection": payload, "sources": source_hashes})).hexdigest()
    payload["generatedAt"] = _iso(generated_at or datetime.now(timezone.utc).isoformat())
    if len(_json(payload)) + 1 > MAX_OUTPUT_BYTES:
        _fail("OSK_CAPACITY_EXCEEDED")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--engine", type=Path, help="Existing pinned engine; defaults to the vault's bundled engine")
    args = parser.parse_args(argv)
    temporary = None
    try:
        vault = args.vault.resolve(strict=True)
        output = args.output.resolve()
        if output.is_relative_to(vault):
            _fail("OSK_OUTPUT_INSIDE_VAULT")
        payload = project_vault(vault, args.engine)
        encoded = _json(payload) + b"\n"
        # Existing destination is untouched on validation or capacity failure.
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".osk-projection-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        temporary = None
        print(json.dumps({"ok": True, "revision": payload["revision"], "nodes": len(payload["nodes"]), "edges": len(payload["edges"]), "bytes": len(encoded)}))
        return 0
    except ProjectionError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": "OSK_PROJECTION_UNAVAILABLE"}), file=sys.stderr)
        return 1
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
