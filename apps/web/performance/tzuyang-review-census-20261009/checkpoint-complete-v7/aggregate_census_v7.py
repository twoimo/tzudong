"""Verify the frozen whole census and prepare private, format-only candidates.

No network, credentials, database writes, raw text or account IDs in public output.
"""
from pathlib import Path
from collections import Counter, defaultdict
import argparse
import hashlib
import json
import re

from census_admission_v1 import classify, presentation_only

SOURCE_SHA = "b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8"
PROMPT_SHA = "7a279af1b9586e9b2f482f1e2b23cdb93bcc013d0daf2e4dbc9277c64a277ae7"
ISSUES = set("INTERNAL_MARKER RAW_FORMATTING DUPLICATE_WITHIN_REVIEW BROKEN_PROSE EDITORIAL_FIRST_PERSON PROMOTIONAL_VOICE CONTRADICTION RECORD_MISMATCH EMPTY_REVIEW NEEDS_VIDEO_EVIDENCE".split())


def sha(b):
    return hashlib.sha256(b).hexdigest()


def aggregate(root):
    raw = (root / "restaurants-review-snapshot-v1.json").read_bytes()
    if sha(raw) != SOURCE_SHA:
        raise ValueError("CENSUS_SOURCE_BINDING_DENIED")
    sources = json.loads(raw)
    expected = {f"r{i:04d}" for i in range(len(sources))}
    seen, checkpoints, usage = {}, [], Counter()
    for path in sorted((root / "gemini-v3").glob("batch-*.json")):
        if not re.fullmatch(r"batch-\d+\.json", path.name):
            continue
        b = json.loads(path.read_bytes())
        if (b["sourceSnapshotSha256"] != SOURCE_SHA or b["promptSha256"] != PROMPT_SHA
                or b["actualModelVersion"] != "gemini-3.8-flash" or b["thinkingLevel"] != "HIGH"):
            raise ValueError("CENSUS_CHECKPOINT_BINDING_DENIED")
        checkpoints.append({"file": path.name, "sha256": sha(path.read_bytes()),
                            "index": b["index"], "rows": len(b["rows"]),
                            "inputSha256": b["inputSha256"]})
        for key, value in (b.get("usage") or {}).items():
            if key in {"promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"}:
                usage[key] += value
        for r in b["rows"]:
            if (set(r) != {"key", "status", "issues", "revisedReview"}
                    or r["key"] not in expected or r["key"] in seen
                    or r["status"] not in {"ok", "fix", "needs_source"}
                    or not isinstance(r["issues"], list) or set(r["issues"]) - ISSUES
                    or not isinstance(r["revisedReview"], str)
                    or (bool(r["revisedReview"].strip()) != (r["status"] == "fix"))):
                raise ValueError("CENSUS_ROW_BINDING_DENIED")
            seen[r["key"]] = r
    if set(seen) != expected:
        raise ValueError("CENSUS_FULL_COVERAGE_DENIED")
    groups = defaultdict(lambda: {"rows": 0, "nonempty": 0, "statusCounts": Counter(), "issueCounts": Counter()})
    plans, admissions, findings = [], Counter(), []
    for i, source in enumerate(sources):
        key = f"r{i:04d}"
        item = seen[key]
        original = source.get("tzuyang_review") or ""
        if sha(original.encode()) != source["reviewSha256"]:
            raise ValueError("CENSUS_REVIEW_HASH_DENIED")
        labels = ["all", "state:" + source["status"]]
        if source["status"] != "deleted":
            labels.append("active")
        if source["status"] == "approved" and source.get("channel_name") == "tzuyang":
            labels.append("approved_tzuyang")
        for label in labels:
            g = groups[label]
            g["rows"] += 1
            g["nonempty"] += bool(original.strip())
            g["statusCounts"][item["status"]] += 1
            g["issueCounts"].update(set(item["issues"]))
        decision = classify(source, item, reviewed_video_parentheses=key == "r0127")
        admissions[decision["decision"]] += 1
        if decision["decision"] == "local_plan":
            plans.append({"key": key, "id": source["id"], "original": original,
                          "revisedReview": item["revisedReview"], "source": source,
                          "decision": decision})
        if item["status"] != "ok":
            findings.append({"key": key, "recordStatus": source["status"],
                             "adminLocked": source["adminLocked"], "modelStatus": item["status"],
                             "issues": item["issues"], "admission": decision})
    return ({"schemaVersion": 1, "sourceSnapshotSha256": SOURCE_SHA, "promptSha256": PROMPT_SHA,
             "requestedModel": "gemini-3.8-flash", "actualModelVersion": "gemini-3.8-flash",
             "thinkingLevel": "HIGH", "totalRows": len(sources), "completedRows": len(seen),
             "remainingRows": 0, "editorialModelCensusComplete": True, "videoFactsCertified": False,
             "groups": dict(groups), "formatOnlyAdmissionCounts": dict(admissions),
             "validResponseTokenMetadata": dict(usage), "billingAmountKnown": False,
             "failedResponseCostsIncluded": False, "checkpointCount": len(checkpoints),
             "checkpoints": checkpoints, "findings": findings, "operatingWrites": 0}, plans)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--private-plan", type=Path, required=True)
    args = parser.parse_args()
    result, plans = aggregate(args.private_root)
    for path, value in [(args.output, result), (args.private_plan, plans)]:
        with path.open("x") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        path.chmod(0o600)
    print(json.dumps({k: result[k] for k in ["totalRows", "completedRows", "remainingRows", "groups", "formatOnlyAdmissionCounts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
