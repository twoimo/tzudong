"""Independent public-evidence coverage/hash verifier; no private data or network."""
from collections import Counter, defaultdict
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "apps/web/performance/tzuyang-review-census-20261009/checkpoint-complete-v7"
PIN = ROOT / "docs/evidence/census-complete-v7-artifact-map.sha256"
SOURCE = "b8f06e7c5867b5ac2d8dfe5283e1ffdcf2a103a34f2e1d29333169fe4c5d38d8"
PROMPT = "7a279af1b9586e9b2f482f1e2b23cdb93bcc013d0daf2e4dbc9277c64a277ae7"


def verify():
    raw = (PACKAGE / "artifact-map.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != PIN.read_text().split()[0]:
        raise ValueError("CENSUS_DETACHED_MAP_DRIFT")
    entries = json.loads(raw)["files"]
    paths = [entry["path"] for entry in entries]
    actual = {str(p.relative_to(PACKAGE)) for p in PACKAGE.rglob("*") if p.is_file()}
    if len(paths) != len(set(paths)) or set(paths) != actual - {"artifact-map.json"}:
        raise ValueError("CENSUS_MAP_TREE_DRIFT")
    for item in entries:
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("CENSUS_PATH_DENIED")
        path = PACKAGE / relative
        data = path.read_bytes()
        if path.is_symlink() or len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("CENSUS_ARTIFACT_DRIFT")
    keys = set()
    groups = defaultdict(lambda: {"rows": 0, "nonempty": 0, "statusCounts": Counter(), "issueCounts": Counter()})
    checkpoint_count = 0
    for path in PACKAGE.glob("checkpoint-*.json"):
        checkpoint_count += 1
        checkpoint = json.loads(path.read_bytes())
        if (checkpoint["sourceSnapshotSha256"] != SOURCE or checkpoint["promptSha256"] != PROMPT
                or checkpoint["actualModelVersion"] != "gemini-3.8-flash" or checkpoint["thinkingLevel"] != "HIGH"):
            raise ValueError("CENSUS_MODEL_SOURCE_DENIED")
        for row in checkpoint["rows"]:
            if row["key"] in keys:
                raise ValueError("CENSUS_DUPLICATE_KEY")
            keys.add(row["key"])
            if row["status"] not in {"ok", "fix", "needs_source"}:
                raise ValueError("CENSUS_STATUS_DENIED")
            labels = ["all", "state:" + row["recordStatus"]]
            if row["recordStatus"] != "deleted":
                labels.append("active")
            if row["recordStatus"] == "approved" and row["channelVerified"]:
                labels.append("approved_tzuyang")
            for label in labels:
                group = groups[label]
                group["rows"] += 1
                group["nonempty"] += row["nonempty"]
                group["statusCounts"][row["status"]] += 1
                group["issueCounts"].update(set(row["issues"]))
    summary = json.loads((PACKAGE / "census-complete-v7.json").read_bytes())
    if keys != {f"r{i:04d}" for i in range(1659)} or checkpoint_count != 190:
        raise ValueError("CENSUS_COVERAGE_DENIED")
    if dict(groups) != summary["groups"] or summary["videoFactsCertified"] or summary["operatingWrites"]:
        raise ValueError("CENSUS_AGGREGATE_SCOPE_DRIFT")
    return {"status": "passed", "mappedFiles": len(entries), "checkpoints": checkpoint_count,
            "rows": len(keys), "duplicateOrMissing": 0, "videoFactsCertified": False,
            "performanceAdmission": 0, "operatingWrites": 0}


if __name__ == "__main__":
    print(json.dumps(verify()))
