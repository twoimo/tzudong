#!/usr/bin/env python3
"""Verify the offline local-ref proposal without calling a provider."""

from __future__ import annotations

import argparse
import copy
from collections import defaultdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
BASE = HERE.parent
sys.path.insert(0, str(ROOT))

from backend.knowledge_graph import claude_video_adapter as adapter  # noqa: E402
from backend.knowledge_graph import longform_analysis as analysis  # noqa: E402


def verified_checkout(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--watch-checkout",
        type=Path,
        default=os.environ.get("TZUDONG_CLAUDE_VIDEO_CHECKOUT"),
        help="Explicit checkout of the pinned claude-video source",
    )
    args = parser.parse_args(argv)
    if args.watch_checkout is None:
        raise analysis.AnalysisError("WATCH_CHECKOUT_REQUIRED")
    checkout = Path(args.watch_checkout).expanduser().resolve()
    config = analysis.AnalysisConfig(
        model="gemini-3.8-flash",
        input_limit=1,
        output_limit=65536,
        model_evidence_hash="0" * 64,
        checkout=checkout,
    )
    analysis.verify_checkout(config)
    return checkout


try:
    WATCH_CHECKOUT = verified_checkout()
except analysis.AnalysisError as error:
    code = str(error)
    if code not in {"WATCH_CHECKOUT_REQUIRED", "WATCH_CHECKOUT_UNAVAILABLE", "WATCH_CHECKOUT_DRIFT"}:
        code = "WATCH_CHECKOUT_REJECTED"
    print(json.dumps({"status": "rejected", "code": code}, sort_keys=True, separators=(",", ":")))
    raise SystemExit(2) from None


spec = importlib.util.spec_from_file_location(
    "gemini_schema_factor_proposal", BASE / "proposal" / "schema_factor.py"
)
proposal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proposal)


def digest(value):
    return hashlib.sha256(proposal.canonical(value)).hexdigest()


def stats(value, depth=0):
    children = []
    if isinstance(value, dict):
        children = [stats(child, depth + 1) for child in value.values()]
    elif isinstance(value, list):
        children = [stats(child, depth + 1) for child in value]
    return {
        "nodes": 1 + sum(child["nodes"] for child in children),
        "depth": max([depth] + [child["depth"] for child in children]),
    }


def walk(value, path=()):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, path + (key,))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, path + (index,))


def resolve(root, value, stack=()):
    if isinstance(value, dict) and set(value) == {"$ref"}:
        reference = value["$ref"]
        if not isinstance(reference, str) or not reference.startswith("#/"):
            raise AssertionError("external_reference")
        if reference in stack:
            raise AssertionError("cyclic_reference")
        target = proposal.pointer_get(root, reference[1:])
        return resolve(root, target, stack + (reference,))
    if isinstance(value, dict):
        return {key: resolve(root, child, stack) for key, child in value.items()}
    if isinstance(value, list):
        return [resolve(root, child, stack) for child in value]
    return value


original = adapter.schema("-D43ezc57z8", 0, 835)
factored = proposal.factor_schema(original)
fixture = json.loads((BASE / "fixture" / "factored-schema.json").read_text())
assert proposal.canonical(factored) == proposal.canonical(fixture)

reference_paths = []
for path, value in walk(factored):
    if isinstance(value, dict):
        assert "$defs" not in value
        if "properties" in value:
            assert isinstance(value["properties"], dict)
        if "required" in value:
            assert isinstance(value["required"], list)
            assert all(isinstance(item, str) for item in value["required"])
    if isinstance(value, dict) and set(value) == {"$ref"}:
        assert (len(path) >= 2 and path[-2] == "properties") or path[-1] == "items"
        reference_paths.append("/" + "/".join(map(str, path)))

expanded = resolve(factored, factored)
assert proposal.canonical(expanded) == proposal.canonical(original)

duplicate_groups = defaultdict(list)
for path, value in walk(factored):
    eligible = path and (
        path[-1] == "items" or (len(path) >= 2 and path[-2] == "properties")
    )
    if eligible and isinstance(value, dict) and set(value) != {"$ref"}:
        duplicate_groups[proposal.canonical(value)].append(path)
remaining_beneficial = 0
for original_bytes, paths in duplicate_groups.items():
    if len(paths) < 2:
        continue
    for anchor in paths:
        tokens = [str(token).replace("~", "~0").replace("/", "~1") for token in anchor]
        reference_bytes = proposal.canonical({"$ref": "#/" + "/".join(tokens)})
        if len(reference_bytes) < len(original_bytes):
            remaining_beneficial += 1
            break
assert remaining_beneficial == 0

factor_proofs = []
for replacement_pointer, reference in proposal.FACTORS:
    original_node = proposal.pointer_get(original, replacement_pointer)
    reference_node = {"$ref": reference}
    original_bytes = len(proposal.canonical(original_node))
    reference_bytes = len(proposal.canonical(reference_node))
    assert reference_bytes < original_bytes
    factor_proofs.append(
        {
            "path": replacement_pointer,
            "reference": reference,
            "originalBytes": original_bytes,
            "referenceBytes": reference_bytes,
            "savedBytes": original_bytes - reference_bytes,
        }
    )

engine = adapter.load_engine(WATCH_CHECKOUT)
row = {
    "videoId": "-D43ezc57z8",
    "durationSeconds": 835,
    "segmentIndex": 0,
    "segmentStartSeconds": 0,
    "segmentEndSeconds": 835,
}
request_builder = getattr(adapter, "predecessor_request_payload", adapter.request_payload)
original_request = request_builder(
    engine,
    "gemini-3.8-flash",
    row["videoId"],
    row["segmentStartSeconds"],
    row["segmentEndSeconds"],
    analysis.segment_prompt(row),
    65536,
)
candidate_request = copy.deepcopy(original_request)
candidate_request["response_format"]["schema"] = factored
request_with_original_schema = copy.deepcopy(candidate_request)
request_with_original_schema["response_format"]["schema"] = original
assert proposal.canonical(request_with_original_schema) == proposal.canonical(original_request)
assert digest(original_request) == "121a7580dde9db30051ec8c05c63f843a478eb59ec9e6900e39f27bd11c8d331"

proof = {
    "schema": {
        "originalCanonicalBytes": len(proposal.canonical(original)),
        "factoredCanonicalBytes": len(proposal.canonical(factored)),
        "savedBytes": len(proposal.canonical(original)) - len(proposal.canonical(factored)),
        "originalSha256": digest(original),
        "factoredSha256": digest(factored),
        "expandedSha256": digest(expanded),
        "expandedCanonicalEqualsOriginal": True,
        "originalStats": stats(original),
        "factoredStats": stats(factored),
        "expandedStats": stats(expanded),
        "referenceCount": len(reference_paths),
        "localReferencesOnly": True,
        "cycles": 0,
        "defsUsed": False,
        "remainingBeneficialDuplicateGroups": remaining_beneficial,
    },
    "factors": factor_proofs,
    "request": {
        "onlyResponseSchemaChanged": True,
        "originalCanonicalBytes": len(proposal.canonical(original_request)),
        "candidateCanonicalBytes": len(proposal.canonical(candidate_request)),
        "originalSha256": digest(original_request),
        "candidateSha256": digest(candidate_request),
        "model": original_request["model"],
        "maxOutputTokens": original_request["generation_config"]["max_output_tokens"],
        "videoProcessing": original_request["input"][0]["processing"],
    },
}
expected = json.loads((HERE / "proof.json").read_text())
assert proof == expected
print(json.dumps(proof, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
