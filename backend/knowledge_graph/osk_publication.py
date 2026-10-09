"""Offline publication of validated longform receipts through pinned OSK MCP APIs.

Planning is the default. No provider, download, installation or scheduler calls
exist here. Model observations remain unverified and video status stays pending.
Use the existing OSK Python environment; see OSK_PUBLICATION.md.
"""
from __future__ import annotations

import argparse
from contextlib import nullcontext
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import sys

from backend.knowledge_graph import longform_analysis as analysis
from backend.knowledge_graph import osk_projection as projection
from backend.knowledge_graph import publication_pages as pages
from backend.knowledge_graph import publication_checkpoint as checkpoint

SPACE = "00_Scope/tzudong"
SESSION = "tzudong"
WRITER = "tzudong-longform-publication/v1"
SOURCE_HEADING = "## Tzudong publication receipt"
# Exact official v4.1.8: all 54 runtime Python files, including MCP, writer,
# post-write eviction/recheck paths. Excludes tests, virtualenvs and bytecode.
# Verified against the publisher tag and exercised in isolated real-API vaults;
# this is not admission of a version range or the newer v5 engine.
ENGINE_SHA256 = "790bb32659f203c85613146fb06b8bb10c2ef404d8ec88547aded63e125f8358"


class PublicationError(Exception):
    pass


def fail(code):
    raise PublicationError(code)


def text(value):
    # Provider text cannot manufacture Markdown registry sections or OSK links.
    return " ".join(value.split()).translate(str.maketrans("[]`<>#", "［］＇＜＞＃"))


def engine_digest(engine):
    files = []
    for root, directories, names in os.walk(engine):
        directories[:] = [d for d in directories if d not in {"tests", "__pycache__", ".venv", "venv", ".git", ".pytest_cache"}]
        files.extend(Path(root) / name for name in names if name.endswith(".py"))
    result = hashlib.sha256()
    for path in sorted(files, key=lambda p: p.relative_to(engine).as_posix()):
        if path.is_symlink():
            fail("OSK_ENGINE_UNSUPPORTED")
        result.update(path.relative_to(engine).as_posix().encode() + b"\0" + path.read_bytes() + b"\0")
    return result.hexdigest()


class Engine:
    """Call the same public functions exposed by the pinned MCP server locally."""

    def __init__(self, vault, engine):
        self.vault, self.engine = vault.resolve(strict=True), engine.resolve(strict=True)
        if engine_digest(self.engine) != ENGINE_SHA256:
            fail("OSK_ENGINE_UNSUPPORTED")
        os.environ["OSK_UPDATE_CHECK"] = "0"  # official offline switch, process only
        projection._load_engine(self.vault, self.engine)
        self.api = importlib.import_module("mcp_server")
        if Path(self.api.__file__).resolve() != self.engine / "mcp_server.py":
            fail("OSK_PROCESS_ROOT_CONFLICT")
        self.core = importlib.import_module("osk.core")
        self.lock = self.core.local_lock_path("tzudong-publication.lock")

    def overview(self):
        result = self.api.overview()  # no session hook/log write during planning
        if (result.get("engine_stale") is not False or SPACE not in result.get("clusters", [])
                or result.get("broken")):
            fail("OSK_SCOPE_UNAVAILABLE")
        # Resolve without binding. create_node receives both explicit space and
        # stable session, so the official engine also checks scope under its lock.
        if self.api.write.resolve_session(SESSION) not in (None, "tzudong"):
            fail("OSK_SCOPE_CONFLICT")

    def read(self, name):
        value = self.api.read_node(name)
        if value.get("error") == "노드 없음: " + name:
            return None
        if (value.get("name") != name or not isinstance(value.get("path"), str) or Path(value["path"]).name != name + ".md"
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(value.get("hash")))
                or not isinstance(value.get("body"), str) or not isinstance(value.get("meta"), dict)):
            fail("OSK_NODE_READBACK_INVALID")
        path = self.vault / value["path"]
        if (path.is_symlink() or not path.resolve().is_relative_to(self.vault / SPACE)
                or any(parent.is_symlink() for parent in path.parents if parent.is_relative_to(self.vault))):
            fail("OSK_SCOPE_CONFLICT")
        return value

    def create(self, target):
        return self.api.create_node(title=target["name"], body=target["body"], summary=target["summary"],
                                    drafter="gpt-6", space=target.get("space", SPACE), session=SESSION,
                                    edges={"derived-from": target["parent"]} if target["parent"] else None)

    def relocate(self, target, previous):
        # Public move_nodes enforces pins, scope topology and byte preservation.
        # Its API has no path/hash CAS; require an unchanged read immediately
        # before moving under the publisher lock and verify exact bytes after.
        current = self.read(target["name"])
        if current is None or current["hash"] != previous["hash"] or current["path"] != previous["path"]:
            fail("OSK_NODE_CHANGED_SINCE_PUBLICATION")
        if Path(previous["path"]).parent.name == target["name"]:
            self.api.move_cluster(name=target["name"], dest_parent=Path(target["space"]).parent.as_posix())
        else:
            self.api.move_nodes(names=[target["name"]], dest_space=target["space"])
        moved = self.read(target["name"])
        if moved is None or moved["hash"] != previous["hash"] or moved["path"] != target["space"] + "/" + target["name"] + ".md":
            fail("OSK_MOVE_READBACK_REQUIRED")
        return moved

    def update(self, target, previous):
        return self.api.update_node(name=target["name"], body=target["body"], expect_hash=previous["hash"],
                                    summary=target["summary"],
                                    add_edges={"derived-from": target["parent"]} if target["parent"] else None)


def completed_bundle(state, row, config):
    """Verify envelopes, saved content, exact model proof and success admission."""
    if analysis.cached_state(state, row, config) != "reusable":
        fail("ANALYSIS_READBACK_REQUIRED")
    _, receipt_path, evidence_path = analysis.paths(state, row, config)
    receipt = analysis.checked_document(receipt_path)
    evidence = analysis.checked_document(evidence_path)
    if (receipt.get("state") != "succeeded" or receipt.get("model") != config.model
            or receipt.get("modelEvidenceSha256") != config.model_evidence_hash
            or receipt.get("identity") != evidence.get("identity")
            or receipt.get("evidenceSha256") != analysis.digest(evidence)
            or receipt.get("usage") != evidence["usage"]):
        fail("ANALYSIS_RECEIPT_MISMATCH")
    if evidence.get("processing") == "static_full_video":
        # Existing successful envelopes remain byte-for-byte reusable. Their
        # reservation describes one original watch invocation, not segments.
        if (type(receipt.get("callsAttempted")) is not int or receipt["callsAttempted"] != 1
                or receipt.get("reservedInputTokens") != config.input_limit
                or receipt.get("callAccounting") != "watch_invocation_interactions_post_upper_bound"):
            fail("ANALYSIS_RECEIPT_MISMATCH")
    elif evidence.get("processing") == "static_segments":
        # cached_state verifies every saved segment observation/receipt, hash,
        # source span and exact aggregate content before this admission point.
        count = len(analysis.segment_rows(row, config))
        if (type(receipt.get("segmentCount")) is not int or receipt["segmentCount"] != count
                or len(evidence["segments"]) != count
                or type(receipt.get("callsAttempted")) is not int or receipt["callsAttempted"] != 2 * count
                or receipt.get("reservedInputTokens") != count * config.input_limit
                or receipt.get("reservedOutputTokens") != count * config.output_limit
                or receipt.get("callAccounting") != "count_and_interactions_per_static_segment"):
            fail("ANALYSIS_RECEIPT_MISMATCH")
    else:
        fail("ANALYSIS_RECEIPT_MISMATCH")
    source = {"writer": WRITER, "identity": evidence["identity"], "receiptSha256": analysis.digest(receipt),
              "evidenceSha256": analysis.digest(evidence), "model": config.model,
              "modelEvidenceSha256": config.model_evidence_hash, "watchCommit": analysis.PINNED_COMMIT}
    return {"row": row, "analysis": evidence["analysis"], "source": source}


def evidence_for(video, evidence, *, bounded=True):
    result = {}
    for item in evidence:
        start = item["startSeconds"]
        value = {"videoId": video, "startSeconds": start, "endSeconds": item["endSeconds"],
                 "url": f"https://www.youtube.com/watch?v={video}" + (f"&t={start:g}s" if start else ""),
                 "status": "unverified"}
        result[projection._json(value)] = value
    result = list(result.values())
    if bounded and len(result) > projection.MAX_EVIDENCE:
        fail("OSK_EVIDENCE_CAPACITY_EXCEEDED")
    return sorted([entry for offset in range(0, len(result), projection.MAX_EVIDENCE)
                   for entry in projection._evidence(result[offset:offset + projection.MAX_EVIDENCE])], key=projection._json)


def specs(bundle, *, paged=False):
    video, value = bundle["row"]["videoId"], bundle["analysis"]
    video_name = "TZ-Video-" + video
    result = []

    def node(name, kind, label, content, evidence, required, restaurant=None, *, context=None, split=True):
        label = text(label)[:512]
        retained = evidence_for(video, evidence, bounded=not paged)
        chunks = list(pages.utf8_chunks(content)) if paged and split else [content]
        metadata = {"schemaVersion": 1, "kind": kind, "displayLabel": label,
                    "evidence": retained[:projection.MAX_EVIDENCE]}
        content = chunks[0]
        if kind == "video":
            metadata.update(videoId=video, analysisStatus="pending")
        body = f"# {label}\n\n{content}\n\n"
        if restaurant:
            body += f"식당: [[{restaurant}]]\n\n"
        body += (f"## 출처\n\n- 공개 영상: https://www.youtube.com/watch?v={video}\n"
                 f"- claude-video: {analysis.PINNED_COMMIT}\n- 모델: {bundle['source']['model']}\n"
                 "- 모델 관찰이며 독립 검증되지 않았습니다. 신뢰도는 교정된 정확도가 아닙니다.\n"
                 f"- 영상 근거: [[{'tzudong' if kind == 'video' else video_name}]]\n\n"
                 + projection.METADATA_HEADING + "\n\n```json\n"
                 + analysis.canonical(metadata).decode() + "\n```\n")
        result.append({"name": name, "body": body, "summary": label[:80] or "모델 관찰 · 독립 검증 대기",
                       "metadata": metadata, "parent": None if kind == "video" else video_name,
                       "requiredText": [text(item) for item in required] if len(chunks) == 1 else [text(content)],
                       "context": context or restaurant or (None if kind == "video" else video_name)})
        if paged and split:
            for index, chunk in enumerate(chunks[1:], 2):
                node(pages.page_name(name, "content", index), "claim", f"{label[:450]} · 본문 페이지 {index}", chunk, [], [], context=name, split=False)
            for offset in range(projection.MAX_EVIDENCE, len(retained), projection.MAX_EVIDENCE):
                index = offset // projection.MAX_EVIDENCE + 1
                page_evidence = retained[offset:offset + projection.MAX_EVIDENCE]
                raw_evidence = [{"startSeconds": item["startSeconds"], "endSeconds": item["endSeconds"]} for item in page_evidence]
                node(pages.page_name(name, "evidence", index), "claim", f"{label[:450]} · 근거 페이지 {index}",
                     f"[[{name}]]의 근거 {offset + 1}–{offset + len(page_evidence)}입니다. 추가 주장이나 독립 검증이 아닙니다.",
                     raw_evidence, [], context=name, split=False)

    def fact(name, kind, item, restaurant=None):
        content = (f"관찰 종류: {item['kind']}\n\n{text(item['text'])}\n\n"
                   f"모델 신뢰도: {item['confidence']:g}\n불확실성: "
                   + ("; ".join(text(x) for x in item["uncertainty"]) or "추가 설명 없음"))
        node(name, kind, item["text"], content, item["evidence"], [item["text"]], restaurant)

    node(video_name, "video", "영상 · " + video, "\n\n".join(text(f["text"]) for f in value["summary"]),
         [e for f in value["summary"] for e in f["evidence"]], [f["text"] for f in value["summary"]])
    for r, restaurant in enumerate(value["restaurants"], 1):
        name = f"TZ-Restaurant-{video}-{r}"
        node(name, "restaurant", restaurant["name"],
             f"영상에서 {text(restaurant['name'])}을 방문했다고 모델이 관찰했습니다.",
             restaurant["evidence"], [restaurant["name"]])
        for m, item in enumerate(restaurant["menus"], 1):
            fact(f"TZ-Menu-{video}-{r}-{m}", "menu", item, name)
        # The pilot's global Claim-1/2 titles stay intact. Restaurant-specific
        # claims have a separate namespace so none are silently discarded.
        for c, item in enumerate(restaurant["claims"], 1):
            fact(f"TZ-Claim-{video}-R{r}-{c}", "claim", item, name)
    for c, item in enumerate(value["claims"], 1):
        fact(f"TZ-Claim-{video}-{c}", "claim", item)
    if paged:
        pages.source_specs(bundle, node)
        return pages.organize_specs(result, SPACE)
    # These are domain relationships, not size-based routing hubs. Preserve
    # child -> video provenance and the restaurant links already in each child.
    children = {}
    for item in result:
        if item["context"]:
            children.setdefault(item["context"], []).append(item["name"])
    for item in result:
        item["children"] = children.get(item["name"], [])
    return result


def signature(target):
    value = {key: target[key] for key in ("name", "body", "summary", "parent")}
    if "space" in target:
        value["space"] = target["space"]
    value["body"] = value["body"].strip()  # OSK adds a frontmatter/body separator.
    return analysis.digest(value)


def matches(current, target):
    if current is None or current["body"].strip() != target["body"].strip() or current["meta"].get("summary") != target["summary"]:
        return False
    return (not target.get("space") or current["path"] == target["space"] + "/" + target["name"] + ".md") and (not target["parent"] or current["meta"].get("derived-from") == f"[[{target['parent']}]]")


def target_for(spec, source, current, owned=False, *, include_links=True):
    body = spec["body"]
    summary = spec["summary"]
    if current:
        metadata = projection._metadata(current["body"])
        if metadata is None or any(e["status"] != "unverified" for e in projection._evidence(metadata.get("evidence", []))):
            fail("OSK_EXISTING_NODE_PROTECTED")
        if metadata.get("kind") == "video" and metadata.get("analysisStatus") != "pending":
            fail("OSK_EXISTING_NODE_PROTECTED")
        comparable = {**metadata, "evidence": projection._evidence(metadata.get("evidence", []))}
        expected = dict(spec["metadata"])
        # Preserve the manually curated pilot video label during adoption.
        if expected["kind"] == "video":
            expected["displayLabel"] = comparable.get("displayLabel")
        compatible = (comparable == expected and analysis.PINNED_COMMIT in current["body"]
                      and all(item in text(current["body"]) for item in spec["requiredText"]))
        if not owned and not compatible:
            fail("OSK_EXISTING_NODE_PROTECTED")
        if compatible:
            if current["body"].count(SOURCE_HEADING) > 1:
                fail("OSK_EXISTING_NODE_PROTECTED")
            body = current["body"].split(SOURCE_HEADING, 1)[0].rstrip() + "\n"
            summary = current["meta"]["summary"]
    if include_links:
        missing = [name for name in spec.get("children", []) if f"[[{name}]]" not in body]
        if missing:
            body += "\n## 연결된 관찰\n\n" + "\n".join(f"- [[{name}]]" for name in missing) + "\n"
    body += "\n" + SOURCE_HEADING + "\n\n```json\n" + analysis.canonical(source).decode() + "\n```\n"
    target = {"name": spec["name"], "body": body, "summary": summary, "parent": spec["parent"]}
    if "space" in spec:
        target["space"] = spec["space"]
        target["rootLink"] = spec.get("rootLink", False)
    if len(body.encode()) > projection.MAX_NODE_BYTES - 2048:
        fail("OSK_NODE_CAPACITY_EXCEEDED")
    return target


def write_and_readback(engine, target, previous):
    # A response, including ok=True, is never the commit proof. Always read back
    # after ACK loss/refusal before a subsequent invocation may retry anything.
    try:
        if previous:
            if target.get("space") and previous["path"] != target["space"] + "/" + target["name"] + ".md":
                previous = engine.relocate(target, previous)
            engine.update(target, previous)
        else:
            engine.create(target)
    except Exception:
        pass
    current = engine.read(target["name"])
    if not matches(current, target):
        fail("OSK_WRITE_READBACK_REQUIRED")
    return current


def capacity(engine, targets, *, sharded=False):
    snapshot = projection.project_vault(engine.vault, engine.engine, sharded=sharded)
    entries, _ = projection._inventory(engine.api.graph)
    scoped = [path for path, kind in entries if kind == ("scope", "tzudong")]
    new_nodes = sum(current is None for _, current in targets)
    changed = [target for target, current in targets if not matches(current, target)]
    hub_body = engine.read("tzudong")["body"]
    hub_links = [target["name"] for target, _ in targets
                 if (target.get("rootLink", False) if sharded else projection._metadata(target["body"])["kind"] == "video")
                 and f"[[{target['name']}]]" not in hub_body]
    # Count every possible new reference, including duplicates/replacements.
    # This deliberately overestimates; the projection may deduplicate or omit
    # them. OSK IDs have at most 20 ASCII chars; 256 bytes bounds each JSON edge
    # including its 64-char digest and relation. No guessed model-output counts.
    edges = sum(target["body"].count("[[") + bool(target["parent"]) for target in changed) + len(hub_links)
    node_bytes = 0
    for target in changed:
        meta = projection._metadata(target["body"])
        node_bytes += len(projection._json({"id": "x" * 20, "label": meta["displayLabel"],
                                           "kind": meta["kind"], "summary": target["summary"],
                                           "evidence": projection._evidence(meta["evidence"])})) + 2
    link_bytes = sum(len(name) + 8 for name in hub_links)
    additions = {"nodes": new_nodes, "edges": edges,
                 "projectionBytes": node_bytes + edges * 256 + (512 if changed or hub_links else 0),
                 "scopeBytes": sum(len(target["body"].encode()) + 2048 for target in changed) + link_bytes,
                 "hubBytes": link_bytes}
    baseline = {"nodes": len(scoped), "edges": len(snapshot["edges"]),
                "projectionBytes": len(projection._json(snapshot)) + 1,
                "scopeBytes": sum(path.stat().st_size for path in scoped),
                "hubBytes": (engine.vault / SPACE / "tzudong.md").stat().st_size}
    return capacity_totals(baseline, additions, sharded=sharded)


def capacity_totals(baseline, additions, *, sharded=False):
    upper = {key: baseline[key] + additions[key] for key in baseline}
    limits = {"nodes": projection.MAX_NODES, "edges": projection.MAX_EDGES,
              "projectionBytes": projection.MAX_OUTPUT_BYTES, "scopeBytes": projection.MAX_SCOPE_BYTES,
              "hubBytes": projection.MAX_NODE_BYTES - 2048}
    if sharded:
        # These remain per-file/page limits; no global JSON or source prefix is
        # admitted. The explicit manifest/count contract still fails closed.
        limits.update(nodes=projection.MAX_GRAPH_COUNT, edges=projection.MAX_GRAPH_COUNT,
                      projectionBytes=None, scopeBytes=None)
    return {"baseline": baseline, "additionsUpper": additions, "totalUpper": upper,
            "format": "sharded" if sharded else "single", "limits": limits,
            "pageLimits": {"nodes": projection.MAX_NODES, "edges": projection.MAX_EDGES,
                           "projectionBytes": projection.MAX_OUTPUT_BYTES, "sourceBytes": projection.MAX_SCOPE_BYTES},
            "admitted": all(limits[key] is None or upper[key] <= limits[key] for key in upper)}


def publish(bundle, engine, state, *, execute=False, max_nodes=5000, sharded=False):
    state = state.resolve()
    if state == engine.vault or engine.vault in state.parents:
        fail("PUBLICATION_STATE_INSIDE_VAULT")
    desired = specs(bundle, paged=sharded)
    if type(max_nodes) is not int or not 1 <= max_nodes <= 5000 or (not sharded and len(desired) > max_nodes):
        fail("PUBLICATION_NODE_LIMIT")
    video = bundle["row"]["videoId"]
    path = state / (video + ".json")
    binding = {"vaultSha256": analysis.digest(str(engine.vault)), "scope": SPACE, "videoId": video}
    with analysis.file_lock(engine.lock) if execute else nullcontext():
        engine.overview()
        hub = engine.read("tzudong")
        if hub is None or (projection._metadata(hub["body"]) or {}).get("kind") != "hub":
            fail("OSK_SCOPE_UNAVAILABLE")
        previous = checkpoint.load(path) if path.exists() else None
        if previous and previous.get("binding") != binding:
            fail("PUBLICATION_STATE_SCOPE_MISMATCH")
        same_source = previous and previous.get("source") == bundle["source"]
        if previous and not same_source:
            if previous.get("state") != "complete":
                fail("PREVIOUS_PUBLICATION_UNRESOLVED")
            if set(previous["nodes"]) - {item["name"] for item in desired}:
                fail("PUBLICATION_SHAPE_CHANGE_REQUIRES_REVIEW")
        ledger = previous if same_source else {"binding": binding, "source": bundle["source"], "state": "running", "nodes": {}}
        targets = []
        # Preflight every existing title before the first mutation; a collision
        # in another scope or a human edit must not lead to partial overwrites.
        for spec in desired:
            name = spec["name"]
            current = engine.read(name)
            prior = previous["nodes"].get(name) if previous else None
            if prior and prior.get("state") == "complete" and (current is None or current["hash"] != prior.get("hash")):
                fail("OSK_NODE_CHANGED_SINCE_PUBLICATION")
            target = target_for(spec, bundle["source"], current, owned=bool(prior))
            operation = ledger["nodes"].get(name)
            if operation and operation.get("targetSha256") != signature(target):
                # A completed v1 publication can gain the explicit contextual
                # links. Never reinterpret an unresolved write as this migration.
                legacy = target_for(spec, bundle["source"], current, owned=bool(prior), include_links=False)
                legacy_current = {"name": name, "body": current["body"], "summary": current["meta"]["summary"], "parent": spec["parent"]} if current else None
                if operation.get("state") != "complete" or (operation.get("targetSha256") != signature(legacy)
                        and (not sharded or legacy_current is None or operation.get("targetSha256") != signature(legacy_current))):
                    fail("PUBLICATION_TARGET_CHANGED")
            if operation and operation.get("state") == "running" and not matches(current, target):
                observed = current["hash"] if current else None
                if observed != operation.get("beforeHash"):
                    fail("OSK_WRITE_READBACK_REQUIRED")
            targets.append((target, current))
        bounds = capacity(engine, targets, sharded=sharded)
        result = {"videoId": video, "phase": "publication" if execute else "plan", "nodes": len(targets),
                  "created": 0, "updated": 0, "moved": 0, "mutations": 0, "reused": 0, "hubUpdated": False,
                  "providerCalls": 0, "independentlyVerified": False, "publicationComplete": False, "capacity": bounds}
        if not execute:
            result["newNodes"] = sum(current is None for _, current in targets)
            return result
        if not bounds["admitted"]:
            fail("OSK_PROJECTION_CAPACITY_EXCEEDED")
        if previous and not same_source:
            history = state / "history" / (video + "-" + analysis.digest(previous["source"]) + ".json")
            checkpoint.save(history, previous)
        moved_clusters = []
        for index, (target, before) in enumerate(targets):
            if sharded and before:
                # Earlier public cluster moves preserve descendant bytes while
                # changing their paths. Admit only those exact planned prefixes.
                expected_path = before["path"]
                for old_prefix, new_prefix in moved_clusters:
                    if expected_path.startswith(old_prefix + "/"):
                        expected_path = new_prefix + expected_path[len(old_prefix):]
                refreshed = engine.read(target["name"])
                if refreshed is None or refreshed["hash"] != before["hash"] or refreshed["path"] != expected_path:
                    fail("OSK_NODE_CHANGED_SINCE_PUBLICATION")
                before = refreshed
                targets[index] = (target, before)
            if sharded and result["mutations"] >= max_nodes and not matches(before, target):
                ledger["state"] = "running"
                checkpoint.save(path, ledger)
                result.update(code="PUBLICATION_PAGE_COMPLETED", remainingNodes=sum(not matches(old, new) for new, old in targets[index:]))
                return result
            name = target["name"]
            if matches(before, target):
                current = before
                result["reused"] += 1
            else:
                ledger["state"] = "running"
                ledger["nodes"][name] = {"state": "running", "targetSha256": signature(target),
                                          "beforeHash": before["hash"] if before else None}
                checkpoint.save(path, ledger)
                if sharded and before and before["path"] != target["space"] + "/" + name + ".md":
                    previous_space = Path(before["path"]).parent
                    structural = previous_space.name == name
                    before = engine.relocate(target, before)
                    if structural:
                        moved_clusters.append((previous_space.as_posix(), target["space"]))
                    result["moved"] += 1
                    result["mutations"] += 1
                    targets[index] = (target, before)
                    if result["mutations"] >= max_nodes and not matches(before, target):
                        result.update(code="PUBLICATION_PAGE_COMPLETED", remainingNodes=sum(not matches(old, new) for new, old in targets[index:]))
                        return result
                if matches(before, target):
                    current = before
                else:
                    current = write_and_readback(engine, target, before)
                    result["updated" if before else "created"] += 1
                    result["mutations"] += 1
            ledger["nodes"][name] = {"state": "complete", "targetSha256": signature(target), "hash": current["hash"]}
            checkpoint.save(path, ledger)
        # Link only nodes proven present. CAS preserves unrelated hub edits;
        # links already present in the manual pilot need no second write.
        hub = engine.read("tzudong")
        missing = [target["name"] for target, _ in targets
                   if (target.get("rootLink", False) if sharded else projection._metadata(target["body"])["kind"] == "video")
                   and f"[[{target['name']}]]" not in hub["body"]]
        if missing:
            if sharded and result["mutations"] >= max_nodes:
                ledger["state"] = "running"
                checkpoint.save(path, ledger)
                result.update(code="PUBLICATION_PAGE_COMPLETED", remainingNodes=0, rootLinkPending=True)
                return result
            hub_target = {"name": "tzudong", "body": hub["body"].rstrip() + "\n\n" +
                          "\n".join(f"- [[{name}]]" for name in missing) + "\n",
                          "summary": hub["meta"]["summary"], "parent": None}
            if len(hub_target["body"].encode()) > projection.MAX_NODE_BYTES - 2048:
                fail("OSK_HUB_CAPACITY_EXCEEDED")
            write_and_readback(engine, hub_target, hub)
            result["hubUpdated"] = True
            result["mutations"] += 1
        for target, _ in targets:
            if not matches(engine.read(target["name"]), target):
                fail("OSK_WRITE_READBACK_REQUIRED")
        ledger["state"] = "complete"
        checkpoint.save(path, ledger)
        result.update(code="PUBLICATION_COMPLETED", publicationComplete=True, remainingNodes=0)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--analysis-state", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-evidence", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--max-videos", type=int, required=True)
    parser.add_argument("--max-nodes", type=int, default=5000,
                        help="Maximum mutations per video invocation; sharded mode resumes remaining nodes on the next invocation")
    parser.add_argument("--format", choices=("single", "sharded"), default="single")
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.max_videos <= 100000:
            fail("PUBLICATION_VIDEO_LIMIT")
        rows, _ = analysis.load_inventory(args.inventory)
        config = analysis.load_model_evidence(args.model_evidence, args.model, analysis.DEFAULT_CHECKOUT, args.timeout)
        bundles, skipped = [], 0
        for row in rows:
            if analysis.cached_state(args.analysis_state, row, config) != "reusable":
                skipped += 1
                continue
            if len(bundles) < args.max_videos:
                bundles.append(completed_bundle(args.analysis_state, row, config))
        engine = Engine(args.vault, args.engine)
        plans = [publish(bundle, engine, args.state_dir, max_nodes=args.max_nodes, sharded=args.format == "sharded") for bundle in bundles]
        bounds = None
        if plans:
            bounds = capacity_totals(plans[0]["capacity"]["baseline"], {
                key: sum(plan["capacity"]["additionsUpper"][key] for plan in plans)
                for key in plans[0]["capacity"]["baseline"]}, sharded=args.format == "sharded")
        print(json.dumps({"phase": "plan", "videos": len(bundles), "skippedNotComplete": skipped,
                          "nodes": sum(plan["nodes"] for plan in plans), "providerCalls": 0,
                          "capacity": bounds, "unprocessedAnalysisNodeUpper": None}), flush=True)
        if args.execute:
            if bounds and not bounds["admitted"]:
                fail("OSK_PROJECTION_CAPACITY_EXCEEDED")
            for bundle in bundles:
                print(json.dumps(publish(bundle, engine, args.state_dir, execute=True, max_nodes=args.max_nodes, sharded=args.format == "sharded")), flush=True)
        return 0
    except (PublicationError, analysis.AnalysisError, projection.ProjectionError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2
    except Exception:
        print('{"error":"PUBLICATION_LOCAL_OPERATION_UNCONFIRMED"}', file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
