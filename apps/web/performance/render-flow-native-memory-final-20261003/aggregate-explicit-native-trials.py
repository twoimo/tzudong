"""Validate explicit native trial references and describe tab-level heap samples.

No CI or p95 is inferred from dependent cycles or one physical device.
The fixed median regression guard is reported for every pair; endpoint and
peak differences are disclosed separately, including failed secondary guards.
"""
import hashlib
import json
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local(reference):
    path = (ROOT / reference).resolve()
    assert path.is_relative_to(ROOT.resolve()), "reference outside evidence root"
    return path


def reduction(before, after):
    assert before > 0
    return {
        "before": before,
        "after": after,
        "absoluteReductionMB": before - after,
        "relativeReductionPercent": (before - after) / before * 100,
        "growthPercent": (after - before) / before * 100,
    }


manifest_path = local(sys.argv[1])
manifest = json.loads(manifest_path.read_text())
fixed = json.loads((ROOT / "PLAN.json").read_text())
assert manifest["sourceSha"] == fixed["sourceSha"]
assert manifest["regressionTolerancePercent"] == fixed["heapRegressionTolerancePercent"] == 20
rows = []
for trial in manifest["trials"]:
    path = local(trial["raw"])
    data = json.loads(path.read_text())
    plan_path = local(trial["plan"])
    plan = json.loads(plan_path.read_text())
    inspection_path = local(trial["inspection"])
    inspection = json.loads(inspection_path.read_text())
    assert data["passed"] and len(data["cycles"]) == plan["cycles"] == 60
    assert data["mode"] == trial["mode"]
    assert data["fieldAdmitted"] == data["canonicalTimingAdmitted"] == 0
    assert data["originalColdBudgetWaived"] is False and plan["noForcedGC"]
    assert data["planSha256"] == sha(plan_path)
    assert data["buildId"] == plan["expectedBuildId"]
    assert all(plan["sourceInputs"][item["original"]] == item["sha256"] for item in data["inputs"])
    assert data["sdk"]["remoteSdk"] and data["sdk"]["sdkLoaded"] and not data["sdk"]["stub"]
    assert data["nativeForeground"] and data["errors"] == {"page": 0, "console": 0}
    expected_counts = set()
    for i, cycle in enumerate(data["cycles"]):
        state = cycle["state"]
        assert cycle["cycle"] == i and cycle["nativeGesture"]
        assert cycle["nativeBefore"] == {"visible": True, "ownFocus": True, "awake": True}
        assert state["visibility"] == "visible" and state["mapCreates"] == 1
        assert state["missing"] == state["duplicates"] == state["overflow"] == 0
        assert state["expected"] == state["markers"] > 0
        expected_counts.add(state["expected"])
    assert len(expected_counts) == 1
    assert inspection["nativeCurrentFocusCheckedEachCycle"]
    assert inspection["noOSShadeSeenInObservedFrames"]
    assert len(inspection["captures"]) == 7
    assert [item["cycle"] for item in inspection["captures"]] == list(range(0, 61, 10))
    for item in inspection["captures"]:
        assert item["inspected"] and item["actualMapAndSyntheticListVisible"]
        assert item["privateDataSeen"] is False and sha(local(item["file"])) == item["sha256"]
    heaps = [item["heap"]["usedSize"] / 1e6 for item in data["cycles"]]
    rows.append({
        **trial, "rawSha256": sha(path), "inspectionSha256": sha(inspection_path),
        "startedAt": data["startedAt"], "endedAt": data["endedAt"],
        "tabMedianMB": statistics.median(heaps), "peakMB": max(heaps),
        "endpointMB": heaps[-1], "initialMB": data["initialHeap"]["usedSize"] / 1e6,
        "withinTabRangeMB": [min(heaps), max(heaps)],
        "withinTabMadMB": statistics.median(abs(x - statistics.median(heaps)) for x in heaps),
        "expectedMarkers": next(iter(expected_counts)), "viewport": data["sdk"]["viewport"],
        "userAgent": data["sdk"]["userAgent"], "cycles": 60, "nativeFramesInspected": 7,
    })

by_key = {(row["mode"], row["role"], row["label"]): row for row in rows}
assert len(by_key) == len(rows)
assert set(by_key) == {(x["mode"], x["role"], x["label"]) for x in fixed["sequence"]}
result = {
    "sourceSha": manifest["sourceSha"], "manifestSha256": sha(manifest_path), "rows": rows,
    "independentDevices": 1, "freshBrowserProcesses": 0, "cyclesNotIndependentUsers": True,
    "fieldAdmitted": 0, "forcedGc": False, "confidenceIntervals": None, "p95": None,
    "noiseSeparatedImprovementProven": False, "regressionTolerancePercent": 20,
    "protocolChanges": manifest["protocolChanges"], "browsers": {},
    "limits": [
        "Existing browser processes and natural GC phases; dependent tabs/cycles",
        "No independent native A/A estimate or population confidence interval",
        "Finite JS isolate heap only; not RSS/GPU or absence of a long-term leak",
        "Every10-cycle pixels may miss shorter overlays or flicker",
        "All individual pair results retained; aggregate cannot waive a failed pair",
    ],
}
for mode in ["samsung", "physical"]:
    before = [row for row in rows if row["mode"] == mode and row["role"] == "before"]
    after = [row for row in rows if row["mode"] == mode and row["role"] == "after"]
    assert len(before) == len(after)
    assert all(row["viewport"] == before[0]["viewport"] for row in before + after)
    assert all(row["expectedMarkers"] == before[0]["expectedMarkers"] for row in before + after)
    pairs = []
    for a, b in zip(before, after):
        metrics = {key: reduction(a[key], b[key]) for key in ["tabMedianMB", "peakMB", "endpointMB"]}
        for value in metrics.values():
            value["guardPassed"] = value["growthPercent"] <= 20
        pairs.append({"before": a["label"], "after": b["label"], "metrics": metrics,
                      "primaryMedianGuardPassed": metrics["tabMedianMB"]["guardPassed"]})
    metrics = {}
    for key in ["tabMedianMB", "peakMB", "endpointMB"]:
        value = reduction(statistics.median(row[key] for row in before), statistics.median(row[key] for row in after))
        value["aggregateGuardPassed"] = value["growthPercent"] <= 20
        metrics[key] = value
    result["browsers"][mode] = {"tabsPerVariant": len(before), "cyclesPerTab": 60, "pairs": pairs, "metrics": metrics}
result["allPrimaryPairGuardsPassed"] = all(p["primaryMedianGuardPassed"] for b in result["browsers"].values() for p in b["pairs"])
result["allSecondaryPairGuardsPassed"] = all(v["guardPassed"] for b in result["browsers"].values() for p in b["pairs"] for v in p["metrics"].values())
output = local(sys.argv[2])
with output.open("x") as handle:
    json.dump(result, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print(json.dumps({"validatedTrials": len(rows), "cycles": sum(row["cycles"] for row in rows),
                  "allPrimaryPairGuardsPassed": result["allPrimaryPairGuardsPassed"],
                  "allSecondaryPairGuardsPassed": result["allSecondaryPairGuardsPassed"],
                  "noiseSeparatedImprovementProven": False}))
