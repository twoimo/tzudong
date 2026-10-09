#!/usr/bin/env python3
"""Bounded offline experiment for the proposed wire-schema intersection.

This script performs no provider, credential, cache, receipt, or queue access.
It uses the repository's installed Ajv to evaluate the old and proposed JSON
schemas, and the existing Python validator as the second intersection member.
The finite mutation corpus supports the code proof; it is not a universal proof.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys


HERE = Path(__file__).resolve().parent
ROOT = next(parent for parent in HERE.parents if (parent / "backend/knowledge_graph/longform_analysis.py").is_file())
sys.path.insert(0, str(ROOT))

from backend.knowledge_graph import claude_video_adapter as adapter  # noqa: E402
from backend.knowledge_graph import longform_analysis as analysis  # noqa: E402


VIDEO_ID = "-D43ezc57z8"
START = 0
END = 835
ROW = {
    "videoId": VIDEO_ID,
    "durationSeconds": END,
    "segmentIndex": 0,
    "segmentStartSeconds": START,
    "segmentEndSeconds": END,
}


def evidence(start=0, end=1, modality="both"):
    return {"startSeconds": start, "endSeconds": end, "modality": modality}


def fact():
    return {
        "text": "Observed fact",
        "kind": "visual",
        "evidence": [evidence()],
        "confidence": 0.8,
        "uncertainty": [],
    }


def restaurant():
    return {
        "name": "Example",
        "evidence": [evidence()],
        "confidence": 0.8,
        "uncertainty": [],
        "menus": [fact()],
        "claims": [fact()],
    }


BASE = {
    "schemaVersion": 1,
    "videoId": VIDEO_ID,
    "coverage": {"startSeconds": START, "endSeconds": END, "complete": True, "limitations": []},
    "summary": [fact()],
    "restaurants": [restaurant()],
    "claims": [fact()],
    "uncertainty": [],
}


def clone():
    return copy.deepcopy(BASE)


CASES: list[dict] = []


def add(name, value):
    CASES.append({"name": name, "value": value})


add("valid_baseline", clone())
value = clone()
value["summary"][0]["confidence"] = 0
value["summary"][0]["evidence"][0] = evidence(START, END, "audio")
add("valid_numeric_boundaries", value)
value = clone()
value["restaurants"] = []
value["claims"] = []
value["uncertainty"] = []
add("valid_optional_empty_collections", value)

for key in BASE:
    value = clone()
    del value[key]
    add(f"top_missing_{key}", value)
value = clone()
value["extra"] = None
add("top_additional_property", value)
for key, wrong in {
    "schemaVersion": "1",
    "videoId": 1,
    "coverage": [],
    "summary": {},
    "restaurants": {},
    "claims": {},
    "uncertainty": {},
}.items():
    value = clone()
    value[key] = wrong
    add(f"top_wrong_type_{key}", value)
value = clone()
value["schemaVersion"] = 2
add("schema_version_wrong_value", value)
value = clone()
value["schemaVersion"] = 1.0
add("schema_version_float", value)
value = clone()
value["videoId"] = "ABCDEFGHIJK"
add("video_id_mismatch", value)

for key in BASE["coverage"]:
    value = clone()
    del value["coverage"][key]
    add(f"coverage_missing_{key}", value)
value = clone()
value["coverage"]["extra"] = None
add("coverage_additional_property", value)
for name, key, wrong in (
    ("coverage_start_wrong_type", "startSeconds", "0"),
    ("coverage_end_wrong_type", "endSeconds", "835"),
    ("coverage_complete_wrong_type", "complete", 1),
    ("coverage_limitations_wrong_type", "limitations", {}),
    ("coverage_start_mismatch", "startSeconds", 1),
    ("coverage_end_mismatch", "endSeconds", END - 1),
    ("coverage_incomplete", "complete", False),
    ("coverage_nonempty_limitations", "limitations", ["partial"]),
    ("coverage_limitations_overflow", "limitations", ["x"] * 51),
    ("coverage_limitations_bad_item", "limitations", [1]),
    ("coverage_limitations_empty_text", "limitations", [""]),
):
    value = clone()
    value["coverage"][key] = wrong
    add(name, value)

for collection in ("summary", "claims"):
    value = clone()
    value[collection] = [fact()] * 101
    add(f"{collection}_overflow", value)
value = clone()
value["summary"] = []
add("summary_empty", value)
value = clone()
value["summary"][0]["evidence"] = []
add("summary_without_any_evidence", value)
value = clone()
value["restaurants"] = [restaurant()] * 101
add("restaurants_overflow", value)
value = clone()
value["uncertainty"] = ["x"] * 51
add("top_uncertainty_overflow", value)

for location in ("summary", "claims", "menu", "restaurant_claim"):
    def selected_fact(document, name=location):
        if name == "summary":
            return document["summary"][0]
        if name == "claims":
            return document["claims"][0]
        if name == "menu":
            return document["restaurants"][0]["menus"][0]
        return document["restaurants"][0]["claims"][0]

    for key in fact():
        value = clone()
        del selected_fact(value)[key]
        add(f"{location}_fact_missing_{key}", value)
    value = clone()
    selected_fact(value)["extra"] = None
    add(f"{location}_fact_additional_property", value)

for name, key, wrong in (
    ("fact_text_wrong_type", "text", 1),
    ("fact_text_empty", "text", ""),
    ("fact_text_overflow", "text", "x" * 2001),
    ("fact_kind_wrong_type", "kind", 1),
    ("fact_kind_wrong_value", "kind", "guess"),
    ("fact_evidence_wrong_type", "evidence", {}),
    ("fact_evidence_overflow", "evidence", [evidence()] * 101),
    ("fact_confidence_wrong_type", "confidence", "0.8"),
    ("fact_confidence_below_minimum", "confidence", -0.1),
    ("fact_confidence_above_maximum", "confidence", 1.1),
    ("fact_uncertainty_wrong_type", "uncertainty", {}),
    ("fact_uncertainty_overflow", "uncertainty", ["x"] * 51),
    ("fact_uncertainty_bad_item", "uncertainty", [1]),
):
    value = clone()
    value["summary"][0][key] = wrong
    add(name, value)

for key in evidence():
    value = clone()
    del value["summary"][0]["evidence"][0][key]
    add(f"evidence_missing_{key}", value)
value = clone()
value["summary"][0]["evidence"][0]["extra"] = None
add("evidence_additional_property", value)
for name, key, wrong in (
    ("evidence_start_wrong_type", "startSeconds", "0"),
    ("evidence_end_wrong_type", "endSeconds", "1"),
    ("evidence_start_before_segment", "startSeconds", -1),
    ("evidence_end_after_segment", "endSeconds", END + 1),
    ("evidence_modality_wrong_type", "modality", 1),
    ("evidence_modality_wrong_value", "modality", "text"),
):
    value = clone()
    value["summary"][0]["evidence"][0][key] = wrong
    add(name, value)
value = clone()
value["summary"][0]["evidence"][0] = evidence(2, 1)
add("evidence_reversed_interval", value)

for key in restaurant():
    value = clone()
    del value["restaurants"][0][key]
    add(f"restaurant_missing_{key}", value)
value = clone()
value["restaurants"][0]["extra"] = None
add("restaurant_additional_property", value)
for name, key, wrong in (
    ("restaurant_name_wrong_type", "name", 1),
    ("restaurant_name_empty", "name", ""),
    ("restaurant_name_overflow", "name", "x" * 201),
    ("restaurant_evidence_wrong_type", "evidence", {}),
    ("restaurant_evidence_overflow", "evidence", [evidence()] * 101),
    ("restaurant_confidence_wrong_type", "confidence", "0.8"),
    ("restaurant_confidence_below_minimum", "confidence", -0.1),
    ("restaurant_confidence_above_maximum", "confidence", 1.1),
    ("restaurant_uncertainty_wrong_type", "uncertainty", {}),
    ("restaurant_uncertainty_overflow", "uncertainty", ["x"] * 51),
    ("restaurant_menus_wrong_type", "menus", {}),
    ("restaurant_menus_overflow", "menus", [fact()] * 101),
    ("restaurant_claims_wrong_type", "claims", {}),
    ("restaurant_claims_overflow", "claims", [fact()] * 101),
):
    value = clone()
    value["restaurants"][0][key] = wrong
    add(name, value)


def python_accepts(value):
    try:
        analysis.validate_analysis(copy.deepcopy(value), ROW)
    except analysis.AnalysisError:
        return False
    return True


def ajv_results(old_schema, wire_schema):
    runner = r"""
const fs = require('fs');
const Ajv = require('./apps/web/node_modules/ajv');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const ajv = new Ajv({allErrors: true, jsonPointers: true});
const oldCheck = ajv.compile(input.oldSchema);
const wireCheck = ajv.compile(input.wireSchema);
process.stdout.write(JSON.stringify(input.cases.map((entry) => ({
  name: entry.name,
  oldSchema: !!oldCheck(entry.value),
  wireSchema: !!wireCheck(entry.value),
}))));
"""
    completed = subprocess.run(
        ["node", "-e", runner],
        cwd=ROOT,
        input=json.dumps({"oldSchema": old_schema, "wireSchema": wire_schema, "cases": CASES}),
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    )
    return json.loads(completed.stdout)


def file_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    old_schema = adapter.schema(VIDEO_ID, START, END)
    wire_schema = json.loads((HERE / "wire-schema.json").read_text())
    ajv = {entry["name"]: entry for entry in ajv_results(old_schema, wire_schema)}
    rows = []
    for case in CASES:
        validator = python_accepts(case["value"])
        old = ajv[case["name"]]["oldSchema"]
        wire = ajv[case["name"]]["wireSchema"]
        rows.append({"name": case["name"], "validator": validator,
                     "acceptedOld": old and validator, "acceptedNew": wire and validator,
                     "oldSchema": old, "wireSchema": wire})
    divergences = [row["name"] for row in rows if row["acceptedOld"] != row["acceptedNew"]]
    validator_old_gaps = [row["name"] for row in rows if row["validator"] and not row["oldSchema"]]
    validator_wire_gaps = [row["name"] for row in rows if row["validator"] and not row["wireSchema"]]
    result = {
        "schemaVersion": 1,
        "scope": "decoded provider static-segment DTOs only; aggregateSegments is excluded",
        "method": "Ajv schema evaluation intersected with the existing validate_analysis function",
        "caseCount": len(rows),
        "validatorAcceptedCount": sum(row["validator"] for row in rows),
        "oldIntersectionAcceptedCount": sum(row["acceptedOld"] for row in rows),
        "newIntersectionAcceptedCount": sum(row["acceptedNew"] for row in rows),
        "intersectionDivergences": divergences,
        "validatorAcceptedOldSchemaViolations": validator_old_gaps,
        "validatorAcceptedWireSchemaViolations": validator_wire_gaps,
        "boundedExperimentPass": not divergences and not validator_old_gaps and not validator_wire_gaps,
        "oldSchema": {"canonicalBytes": len(adapter.canonical(old_schema)), "sha256": adapter.digest(old_schema)},
        "wireSchema": {"canonicalBytes": len(adapter.canonical(wire_schema)), "sha256": adapter.digest(wire_schema)},
        "source": {
            "claudeVideoAdapterSha256": file_sha256(ROOT / "backend/knowledge_graph/claude_video_adapter.py"),
            "longformAnalysisSha256": file_sha256(ROOT / "backend/knowledge_graph/longform_analysis.py"),
        },
        "limitations": [
            "The mutation corpus is finite and does not prove equivalence by itself.",
            "Provider acceptance of the proposed wire schema was not tested.",
            "Independent output quality was not evaluated.",
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result["boundedExperimentPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
