"""Lossless source/evidence pages and semantic OSK placement for publication.

No engine, filesystem or provider access. Byte/count limits bound each page,
never the amount of producer evidence retained. Dedicated structural hubs group each video/restaurant/observation together
with its source and evidence pages. Existing observation bodies stay intact.
"""
from __future__ import annotations

import base64
import hashlib

from backend.knowledge_graph import osk_projection as projection

CONTENT_BYTES = 16 * 1024
CHILDREN_PER_HUB = 128


def utf8_chunks(value, maximum=CONTENT_BYTES):
    """Split only between Unicode scalars and reconstruct by exact concatenation."""
    current, size = [], 0
    for char in value:
        length = len(char.encode("utf-8"))
        if current and size + length > maximum:
            yield "".join(current)
            current, size = [], 0
        current.append(char)
        size += length
    if current or not value:
        yield "".join(current)


def page_name(owner, role, index):
    return f"TZ-Page-{hashlib.sha256(owner.encode()).hexdigest()[:24]}-{role}-{index}"


def source_specs(bundle, make_node):
    """Retain the exact validated producer JSON, including modality/uncertainty.

    Base64 prevents source strings from becoming executable Markdown registry or
    wikilink syntax. Each page declares byte offset, whole-source hash and size.
    """
    raw = projection._json(bundle["analysis"])
    sha = hashlib.sha256(raw).hexdigest()
    video = "TZ-Video-" + bundle["row"]["videoId"]
    root = "TZ-Source-" + bundle["row"]["videoId"]
    make_node(root, "hub", "생산자 원문 · " + bundle["row"]["videoId"],
              f"생산자 JSON 원문 {len(raw)} bytes를 순서대로 보존합니다. SHA256: {sha}. 독립 검증을 뜻하지 않습니다.",
              [], [], context=video, split=False)
    for index, offset in enumerate(range(0, len(raw), CONTENT_BYTES), 1):
        value = {"encoding": "base64", "sourceSha256": sha, "offsetBytes": offset,
                 "totalBytes": len(raw), "data": base64.b64encode(raw[offset:offset + CONTENT_BYTES]).decode()}
        make_node(page_name(root, "source", index), "claim", f"보존 원문 페이지 {index} · 독립 주장 아님",
                  "## Tzudong source page\n\n```json\n" + projection._json(value).decode() + "\n```",
                  [], [], context=root, split=False)


def organize_specs(items, space):
    """Bound each semantic hub's fanout, then assign supported OSK paths.

    Ordered child indexes are navigational source/observation pages, not extra
    evidence or assertions. Every leaf and child hub is directly linked from its
    containing hub, as required by the pinned organization API.
    """
    by_name = {item["name"]: item for item in items}
    if len(by_name) != len(items):
        raise ValueError("PUBLICATION_LAYOUT_INVALID")
    children = {}
    for item in items:
        if item["context"]:
            children.setdefault(item["context"], []).append(item["name"])
    # Ordinary observations retain their original bodies and all old links.
    # Dedicated collection hubs have only direct child links, so provenance
    # backlinks on video/restaurant nodes are not mistaken for hub bypasses.
    for item in list(items):
        name = item["name"]
        if item["metadata"]["kind"] == "hub":
            # Source collection descriptions have no parent wikilink. Its typed
            # derived-from edge still preserves provenance.
            source_marker = item["body"].index(projection.METADATA_HEADING)
            item["body"] = item["body"][:source_marker].replace(f"[[{item['parent']}]]", item['parent'] or "") + item["body"][source_marker:]
            continue
        local = children.pop(name, [])
        if not local and item["metadata"]["kind"] not in {"video", "restaurant"}:
            continue
        wrapper = page_name(name, "collection", 1)
        label = item["metadata"]["displayLabel"][:450] + " · 관찰과 출처"
        metadata = {"schemaVersion": 1, "kind": "hub", "displayLabel": label, "evidence": []}
        body = f"# {label}\n\n이 영상·식당·관찰의 내용과 근거를 함께 보존하는 의미별 모음입니다. 독립 검증이 아닙니다.\n\n" + projection.METADATA_HEADING + "\n\n```json\n" + projection._json(metadata).decode() + "\n```\n"
        original_context = item["context"]
        by_name[wrapper] = {"name": wrapper, "body": body, "summary": label[:80], "metadata": metadata,
                            "parent": None, "requiredText": [], "context": original_context}
        if original_context:
            siblings = children[original_context]
            siblings[siblings.index(name)] = wrapper
        item["context"] = wrapper
        item["domainChildren"] = []
        for child in local:
            by_name[child]["context"] = wrapper
        children[wrapper] = [name] + local
    for owner in list(children):
        names, level = children[owner], 0
        while len(names) > CHILDREN_PER_HUB:
            level += 1
            parents = []
            for offset in range(0, len(names), CHILDREN_PER_HUB):
                group = names[offset:offset + CHILDREN_PER_HUB]
                name = page_name(owner, f"index{level}", offset // CHILDREN_PER_HUB + 1)
                label = f"연결된 관찰·원문 목록 {offset + 1}–{offset + len(group)}"
                metadata = {"schemaVersion": 1, "kind": "hub", "displayLabel": label, "evidence": []}
                body = f"# {label}\n\n{owner}의 순서 있는 하위 관찰·원문을 탐색하는 목록입니다. 독립 주장이나 추가 분석이 아닙니다.\n\n" + projection.METADATA_HEADING + "\n\n```json\n" + projection._json(metadata).decode() + "\n```\n"
                spec = {"name": name, "body": body, "summary": label, "metadata": metadata,
                        "parent": None, "requiredText": [], "context": owner, "children": group}
                by_name[name] = spec
                for child in group:
                    by_name[child]["context"] = name
                parents.append(name)
            names = parents
        children[owner] = names
    for item in by_name.values():
        item["children"] = item.get("children", children.get(item["name"], item.get("domainChildren", [])))
    ordered = []
    def visit(name, parent_space):
        item = by_name[name]
        is_hub = item["metadata"]["kind"] == "hub"
        item["space"] = parent_space + "/" + name if is_hub else parent_space
        item["rootLink"] = not item["context"]
        ordered.append(item)
        if is_hub:
            for child in item["children"]:
                visit(child, item["space"])
    roots = [item["name"] for item in by_name.values() if not item["context"]]
    for name in roots:
        visit(name, space)
    if len(ordered) != len(by_name):
        raise ValueError("PUBLICATION_LAYOUT_INVALID")
    return ordered
