#!/usr/bin/env python3
"""Independent, standard-library verification of retained inputs and scored scalars.

Does not import or run the JavaScript scorer and never accesses the network/browser.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import statistics
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
PROTOCOL = "c3652812b384d0f949b001dfe059882fe2adeae11c94403b5cdec91cf2097822"
URL = "https://www.tzudong.app/?__perf=initial-load"
TOOLS = ["protocol.json", "snapshot.schema.json", "evidence.mjs", "record.mjs", "score.mjs", "validate.py"]
OBSERVER = ["apps/web/lib/performance/initial-load-diagnostic.ts", "apps/web/lib/performance/initial-load-milestones.ts"]

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0

def close(a, b, tolerance=0.01):
    return finite(a) and finite(b) and abs(a-b) <= tolerance

def utc(v):
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z", v):
        return None
    try:
        return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return None

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result

def decode(data):
    return json.loads(data, object_pairs_hook=strict_object, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))

def schema_ok(value, spec):
    if "anyOf" in spec:
        return any(schema_ok(value, branch) for branch in spec["anyOf"])
    if "const" in spec and (type(value) is not type(spec["const"]) or value != spec["const"]):
        # JSON numbers have one mathematical type; bool remains distinct.
        if not (finite(value) and finite(spec["const"]) and value == spec["const"]):
            return False
    if "enum" in spec and not any(type(value) is type(v) and value == v for v in spec["enum"]):
        return False
    kinds = spec.get("type", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    kind = "null" if value is None else "boolean" if isinstance(value, bool) else "object" if isinstance(value, dict) else "array" if isinstance(value, list) else "string" if isinstance(value, str) else "number"
    if kinds and kind not in kinds and not ("integer" in kinds and finite(value) and value == int(value)):
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return finite(value) and value >= spec.get("minimum", 0) and value <= spec.get("maximum", math.inf)
    if isinstance(value, str) and "pattern" in spec and not re.search(spec["pattern"], value):
        return False
    if isinstance(value, list):
        return len(value) <= spec.get("maxItems", math.inf) and (not spec.get("uniqueItems") or len({json.dumps(v, sort_keys=True) for v in value}) == len(value)) and all(schema_ok(v, spec.get("items", {})) for v in value)
    if isinstance(value, dict):
        props = spec.get("properties", {})
        return all(k in value for k in spec.get("required", [])) and (spec.get("additionalProperties") is not False or set(value) <= set(props)) and all(schema_ok(v, props.get(k, {})) for k, v in value.items())
    return True

def snapshot_valid(s, cohort, source, schema, warmup=False):
    if not schema_ok(s, schema):
        return False
    c, n, p, m, r = (s[k] for k in ["capture", "navigation", "paints", "milestones", "completeness"])
    checks = [s["binding"] == {"gitSha": source, "hostname": "www.tzudong.app", "pathname": "/"},
        c["contextUnchanged"], finite(c["observerSetupMs"]) and c["observerSetupMs"] <= 20000,
        finite(c["frozenAtMs"]) and c["frozenAtMs"] >= 20000,
        c["visibilityAtStart"] == "visible" and c["firstHiddenAtMs"] is None,
        c["trustedInputCount"] == 0 and c["firstTrustedInputAtMs"] is None,
        c["resizeCount"] == 0 and c["firstResizeAtMs"] is None,
        s["viewport"]["initial"] == cohort.get("viewport") and s["viewport"]["final"] == cohort.get("viewport"),
        all(s["support"][k] for k in ["navigation", "paint", "largestContentfulPaint"]),
        bool(n) and n["type"] == "navigate" and n["startTime"] == 0 and n["activationStart"] == 0 and n["redirectCount"] == 0,
        not c["resourceBufferOverflow"] and not c["entryCapReached"] and not s["resources"]["overflow"]]
    if warmup:
        return all(checks)
    inside = lambda v: finite(v) and 0 < v <= 20000
    l = p["windowLcp"]
    checks += [bool(n) and inside(n["responseStart"]) and inside(n["responseEnd"]) and n["responseEnd"] >= n["responseStart"],
        inside(p["fcpMs"]) and bool(l) and inside(l["startTimeMs"]) and bool(n) and p["fcpMs"] >= n["responseStart"] and l["startTimeMs"] >= p["fcpMs"],
        p["fpMs"] is None or finite(p["fcpMs"]) and p["fpMs"] <= p["fcpMs"],
        all(r[k] for k in ["controlsReady", "dataReady", "mapConstructed", "mapVisible", "desktopPanelReady"])
            and r["visibleTileCount"] > 0 and r["visibleMarkerCount"] > 0 and not r["initialSkeletonVisible"]
            and r["desktopPanelAlertCount"] == 0 and r["desktopPopularItemCount"] > 0 and r["desktopLatestItemCount"] > 0 and inside(r["observedAtMs"]),
        all(inside(m[k]) and finite(r["observedAtMs"]) and m[k] <= r["observedAtMs"] for k in ["controlsReady", "dataReady", "mapConstructed", "mapVisible", "desktopPanelReady", "initialSkeletonHidden"]),
        (s["milestoneCounts"]["restaurantCount"] or 0) > 0 and (s["milestoneCounts"]["clusterInputCount"] or 0) > 0,
        all(m[k] is None for k in ["dataError", "naverSdkError", "mapConstructionError"]) and not r["diagnosticErrors"],
        c["readinessSamples"] > 0 and c["readinessSamplingIntervalMs"] == 500]
    if l:
        checks.append(close(l["ttfbMs"], n.get("responseStart") if n else None))
        if l["resourceApplicable"] and not l["timingDetailAvailable"]:
            checks.append(all(l[k] is None for k in ["resourceRequestStartMs", "resourceResponseEndMs", "resourceLoadDelayMs", "resourceLoadDurationMs", "elementRenderDelayMs"]))
        elif n and finite(n["responseStart"]):
            ttfb = n["responseStart"]
            request = l["resourceRequestStartMs"] if l["resourceApplicable"] else ttfb
            end = l["resourceResponseEndMs"] if l["resourceApplicable"] else ttfb
            checks.append(finite(request) and finite(end) and finite(l["startTimeMs"]) and end >= request and end <= l["startTimeMs"]
                and close(l["resourceLoadDelayMs"], max(0, request-ttfb)) and close(l["resourceLoadDurationMs"], max(0, end-max(request, ttfb)))
                and close(l["elementRenderDelayMs"], max(0, l["startTimeMs"]-max(end, ttfb))))
        else:
            checks.append(False)
    tasks = s["longTasks"]
    checks.append(s["support"]["longTask"] == (tasks is not None))
    if tasks is not None:
        entries = tasks["completedEntries"]
        checks += [all(t["startTimeMs"]+t["durationMs"] <= 20000.001 for t in entries), tasks["count"] == len(entries),
            close(tasks["totalDurationMs"], sum(t["durationMs"] for t in entries)),
            close(tasks["longTaskBlockingSumMs"], sum(max(t["durationMs"]-50, 0) for t in entries)),
            close(tasks["maxDurationMs"], max([0]+[t["durationMs"] for t in entries]))]
    groups = s["resources"]["byCategory"]
    checks.append(s["support"]["resource"] == (groups is not None))
    groups = groups or []
    checks += [len({g["category"] for g in groups}) == len(groups), sum(g["count"] for g in groups) <= 2000]
    for g in groups:
        checks.append(g["count"] == g["completedCount"] and g["knownTimingCount"]+g["unknownTimingCount"] == g["count"]
            and g["zeroTransferKnownCount"]+g["networkTransferKnownCount"] == g["knownTimingCount"]
            and finite(g["firstStartMs"]) and finite(g["lastResponseEndMs"]) and g["firstStartMs"] <= g["lastResponseEndMs"]
            and (g["networkTransferKnownCount"] > 0 or g["transferBytesKnown"] == 0))
    return all(checks)

def scalars(s):
    if s is None:
        return dict.fromkeys(["ttfbMs", "fcpMs", "windowLcpMs", "controlsReadyMs", "mapVisibleMs", "completedWindowLongTaskExcessMs"])
    n, p, m, t = s["navigation"], s["paints"], s["milestones"], s["longTasks"]
    return {"ttfbMs": n["responseStart"]-n["startTime"] if n and finite(n["responseStart"]) and finite(n["startTime"]) else None,
        "fcpMs": p["fcpMs"], "windowLcpMs": p["windowLcp"]["startTimeMs"] if p["windowLcp"] else None,
        "controlsReadyMs": m["controlsReady"], "mapVisibleMs": m["mapVisible"],
        "completedWindowLongTaskExcessMs": t["longTaskBlockingSumMs"] if t and t["crossingCutoffCount"] == 0 else None}

def summary(values):
    center = statistics.median(values) if values else None
    return {"count": len(values), "median": center, "mad": statistics.median([abs(v-center) for v in values]) if values else None,
        "min": min(values) if values else None, "max": max(values) if values else None}

def compare(before, after, budget, settings, eligible):
    b, a = summary(before), summary(after)
    delta = b["median"]-a["median"] if before and after else None
    relative = delta/b["median"] if delta is not None and b["median"] else None
    noise = settings["noiseMultiplier"] * max(b["mad"], a["mad"]) if before and after else None
    state = "not-comparable"
    if eligible and len(before) == len(after) == 5:
        state = "no-confirmed-change"
        for direction, result in [(1, "improved"), (-1, "regressed")]:
            if delta*direction >= budget["minimumAbsoluteChange"] and relative is not None and relative*direction >= settings["minimumRelativeChange"] and delta*direction > noise:
                state = result
                break
    return {"unit": "ms", "before": b, "after": a, "beforeMinusAfterMs": delta, "relativeReduction": relative, "noiseThresholdMs": noise,
        "minimumAbsoluteChangeMs": budget["minimumAbsoluteChange"], "minimumRelativeChange": settings["minimumRelativeChange"], "targetMs": budget["target"], "classification": state}

def same(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)) and not isinstance(b, bool) and math.isfinite(a) and math.isfinite(b):
        return abs(a-b) <= 1e-8
    return type(a) is type(b) and a == b

def attribution(s):
    if s is None:
        return None
    n, m = s["navigation"] or {}, s["milestones"]
    diff = lambda end, start: end-start if finite(end) and finite(start) and end >= start else None
    totals = dict.fromkeys(["knownTimingCount", "unknownTimingCount", "zeroTransferKnownCount", "networkTransferKnownCount", "transferBytesKnown"], 0)
    for group in s["resources"]["byCategory"] or []:
        for key in totals:
            totals[key] += group[key]
    return {"navigation": {"dnsMs": diff(n.get("domainLookupEnd"), n.get("domainLookupStart")), "connectionMs": diff(n.get("connectEnd"), n.get("connectStart")),
        "tlsMs": diff(n.get("connectEnd"), n.get("secureConnectionStart")) if (n.get("secureConnectionStart") or 0) > 0 else None,
        "requestToFirstByteMs": diff(n.get("responseStart"), n.get("requestStart")), "responseTransferMs": diff(n.get("responseEnd"), n.get("responseStart")), "firstByteToFcpMs": diff(s["paints"]["fcpMs"], n.get("responseStart"))},
        "lcp": s["paints"]["windowLcp"], "application": {"dataFetchMs": diff(m["dataFetchCompleted"], m["dataQueryStarted"]), "dataMergeMs": diff(m["dataMergeCompleted"], m["dataFetchCompleted"]),
            "naverSdkMs": diff(m["naverSdkReady"], m["naverSdkRequested"]), "mapConstructionMs": diff(m["mapConstructed"], m["mapConstructionStarted"]), "clusterIndexMs": diff(m["clusterIndexReady"], m["clusterIndexStarted"])},
        "cacheObservation": {"control": "unavailable", "coverage": "unavailable" if s["resources"]["byCategory"] is None else "completed-resources-only", **totals, "incompleteRequestCount": None},
        "collector": {key: s["capture"][key] for key in ["observerSetupMs", "observerWorkMs", "readinessWorkMs", "readinessSamples", "readinessSamplingIntervalMs", "frozenAtMs"]},
        "longTaskMetricUnavailableReason": "unsupported" if not s["support"]["longTask"] else "unavailable" if s["longTasks"] is None else "crossing-cutoff" if s["longTasks"]["crossingCutoffCount"] > 0 else None}

def phase_valid(f, phase, repository, protocol):
    keys = {"schemaVersion", "phase", "frozenAtUtc", "sourceSha", "sourceTreeSha", "deploymentId", "projectId", "canonicalHost", "observerFiles", "providerIdentity", "healthIdentity"}
    if not f or set(f) != keys:
        return False
    ok = [f["schemaVersion"] == "production-attribution.phase.v1" and f["phase"] == phase and f["canonicalHost"] == "www.tzudong.app",
        bool(re.fullmatch(r"[a-f0-9]{40}", f.get("sourceSha", ""))), bool(re.fullmatch(r"[a-f0-9]{40}", f.get("sourceTreeSha", ""))),
        bool(re.fullmatch(r"dpl_[A-Za-z0-9]+", f.get("deploymentId", ""))), bool(re.fullmatch(r"prj_[A-Za-z0-9]+", f.get("projectId", ""))),
        utc(f["frozenAtUtc"]) is not None and utc(f["frozenAtUtc"]) >= utc(protocol["declaredAtUtc"])]
    try:
        git = lambda *a: subprocess.check_output(["git", "-C", str(repository), *a], stderr=subprocess.DEVNULL)
        ok += [git("rev-parse", f["sourceSha"]+"^{tree}").decode().strip() == f["sourceTreeSha"], [o["path"] for o in f["observerFiles"]] == OBSERVER]
        for o in f["observerFiles"]:
            ok.append(set(o) == {"path", "sha256"} and o["path"] in OBSERVER and digest(git("show", f["sourceSha"]+":"+o["path"])) == o["sha256"])
    except (subprocess.CalledProcessError, KeyError, TypeError):
        ok.append(False)
    for kind in ["providerIdentity", "healthIdentity"]:
        i = f[kind]
        keys = {"observedAtUtc", "observedVia", "gitSha", "deploymentId", "projectId", "target", "state"} if kind == "providerIdentity" else {"observedAtUtc", "observedVia", "gitSha", "deploymentId", "ok"}
        ok += [set(i) == keys, i.get("gitSha") == f["sourceSha"] and i.get("deploymentId") == f["deploymentId"],
            utc(i.get("observedAtUtc")) is not None and utc(f["frozenAtUtc"]) is not None and utc(i["observedAtUtc"]) <= utc(f["frozenAtUtc"])]
        ok.append(i.get("projectId") == f["projectId"] and i.get("target") == "production" and i.get("state") == "READY" and i.get("observedVia") in ["vercel-dashboard", "vercel-tool", "vercel-cli"] if kind == "providerIdentity" else i.get("ok") is True and i.get("observedVia") == "cua-public-health")
    return all(ok)

def validate(root, repository, map_name, expected_map, baseline_hash, scored):
    def read(path):
        require(isinstance(path, str) and re.fullmatch(r"[A-Za-z0-9._/-]+", path) and not path.startswith("/") and "//" not in path and all(p not in [".", "..", ""] for p in path.split("/")), "unsafe artifact path")
        target = root / path
        require(target.resolve() == target and target.is_file() and target.stat().st_size <= 2*1024*1024, "symlink, missing or excessive input")
        return target.read_bytes()
    require(bool(re.fullmatch(r"[a-f0-9]{64}", expected_map or "")), "detached map hash required")
    map_bytes = read(map_name)
    require(digest(map_bytes) == expected_map, "map hash mismatch")
    artifact = decode(map_bytes)
    require(artifact["schemaVersion"] == "production-attribution.artifact-map.v1" and artifact["stage"] in ["before", "final"], "map schema")
    content = {}
    for row in artifact["files"]:
        require(row["path"] not in content, "duplicate map path")
        data = read(row["path"])
        require(len(data) == row["sizeBytes"] and digest(data) == row["sha256"], "artifact changed")
        content[row["path"]] = data
        if row["path"].startswith("inputs/"):
            require(bool(re.fullmatch(r"inputs/(?:cohort\.json|phases/(?:before|after)\.json|(?:before|after)/0[0-5]\.(?:receipt|snapshot)\.json)", row["path"])), "unplanned or replacement attempt")
    for path in TOOLS:
        require(path in content and digest(content[path]) == digest((HERE/path).read_bytes()), "validator/tool differs from mapped code")
    require(digest(content["protocol.json"]) == PROTOCOL, "protocol changed")
    for path in (root/"inputs").rglob("*"):
        if path.is_file():
            relative = path.relative_to(root).as_posix()
            if artifact["stage"] == "before" and (relative.startswith("inputs/after/") or relative == "inputs/phases/after.json"):
                continue
            require(relative in content, "unmapped retained input")
    if artifact["stage"] == "final":
        require(baseline_hash == artifact["baselineMapSha256"] and digest(content["baseline-artifact-map.json"]) == baseline_hash, "detached baseline seal mismatch")
        base = decode(content["baseline-artifact-map.json"])
        require(base["stage"] == "before" and all(row in artifact["files"] for row in base["files"]), "baseline evidence changed")
    get = lambda path: decode(content[path]) if path in content else None
    protocol, schema, report = get("protocol.json"), get("snapshot.schema.json"), decode(read(scored))
    require(report["schemaVersion"] == "production-attribution.score.v1" and report["protocolSha256"] == PROTOCOL and report["artifactMapSha256"] == expected_map and report["baselineMapSha256"] == artifact["baselineMapSha256"], "score binding")
    require(report["fieldAdmissionCount"] == 0 and report["g003AdmissionCount"] == 0 and report["legacyTtiMs"] is None and report["classification"] == protocol["scope"]["classification"] and report["limitations"] == protocol["scope"]["limitations"], "scope or limitations altered")
    cohort = get("inputs/cohort.json")
    require(report["cohort"] == cohort, "cohort omitted or altered")
    ck = {"schemaVersion","protocolSha256","frozenAtUtc","browserSurface","browserVersion","viewport","navigationType","cacheControl","networkControl","cpuControl","setupReceipt","setupReceiptSha256","setupSnapshotSha256"}
    cohort_ok = bool(cohort) and set(cohort) == ck and cohort["schemaVersion"] == "production-attribution.cohort.v1" and cohort["protocolSha256"] == PROTOCOL and cohort["browserSurface"] == "cua-cloud-cdp" and cohort["browserVersion"] is None and cohort["navigationType"] == "navigate" and all(cohort[k] == "unavailable" for k in ["cacheControl", "networkControl", "cpuControl"]) and utc(cohort["frozenAtUtc"]) is not None
    if cohort_ok:
        v = cohort["viewport"]
        rb, sb = content.get("inputs/before/00.receipt.json"), content.get("inputs/before/00.snapshot.json")
        cohort_ok = finite(v.get("width")) and v["width"] >= 1024 and finite(v.get("height")) and v["height"] > 0 and finite(v.get("dpr")) and v["dpr"] > 0 and cohort["setupReceipt"] == "inputs/before/00.receipt.json" and bool(rb) and bool(sb) and digest(rb) == cohort["setupReceiptSha256"] and digest(sb) == cohort["setupSnapshotSha256"] and utc(decode(rb)["observedAtUtc"]) <= utc(cohort["frozenAtUtc"])
    phases = {}
    for phase in ["before", "after"]:
        f = get(f"inputs/phases/{phase}.json")
        saved = report["phases"][phase]
        if not f:
            require(saved is None, "invented phase")
            phases[phase] = None
            continue
        require(saved["metadata"] == f and len(saved["trials"]) == 6, "phase identity or attempt omission")
        phase_ok, trials, previous_end = phase_valid(f, phase, repository, protocol), [], None
        for ordinal in range(6):
            stem = f"inputs/{phase}/{ordinal:02d}"
            receipt = get(stem+".receipt.json")
            s, valid = None, bool(receipt)
            if receipt:
                keys = {"schemaVersion","phase","ordinal","role","navigationStartedAtUtc","observedAtUtc","observedUrl","extraction","outcome","snapshot","snapshotSha256"}
                role = "declared-warmup" if ordinal == 0 else "planned-measurement"
                valid = set(receipt) == keys and receipt["schemaVersion"] == "production-attribution.receipt.v1" and receipt["phase"] == phase and receipt["ordinal"] == ordinal and receipt["role"] == role and receipt["extraction"] == "visible-diagnostic-pre-text" and receipt["observedUrl"] == URL
                start, end = utc(receipt.get("navigationStartedAtUtc")), utc(receipt.get("observedAtUtc"))
                valid = valid and start is not None and end is not None and start <= end and utc(f["frozenAtUtc"]) is not None and start >= utc(f["frozenAtUtc"]) and (ordinal == 0 or bool(cohort) and utc(cohort["frozenAtUtc"]) is not None and start >= utc(cohort["frozenAtUtc"])) and (previous_end is None or start >= previous_end)
                if end is not None:
                    previous_end = end
                bound = receipt.get("outcome") == "captured" and receipt.get("snapshot") == stem+".snapshot.json" and stem+".snapshot.json" in content and digest(content[stem+".snapshot.json"]) == receipt.get("snapshotSha256")
                valid = valid and bound
                if bound:
                    candidate = get(stem+".snapshot.json")
                    if schema_ok(candidate, schema):
                        s = candidate
                        valid = valid and snapshot_valid(s, cohort or {}, f["sourceSha"], schema, warmup=ordinal == 0)
                    else:
                        valid = False
            valid = bool(valid and phase_ok and cohort_ok)
            values = scalars(s)
            item = saved["trials"][ordinal]
            require(item["ordinal"] == ordinal and item["role"] == ("declared-warmup" if ordinal == 0 else "planned-measurement") and item["receipt"] == (stem+".receipt.json" if receipt else None) and item["snapshot"] == (receipt.get("snapshot") if receipt else None), "attempt identity differs")
            require(item["valid"] == valid and item["timingEligible"] == (valid and ordinal > 0) and same(item["values"], values), "eligibility or scalar derivation differs")
            require(same(item["attribution"], attribution(s)), "attribution scalar arithmetic differs")
            trials.append({"ordinal": ordinal, "eligible": valid and ordinal > 0, "valid": valid, "values": values})
        count = sum(t["eligible"] for t in trials)
        require(saved["validMeasurements"] == count and (not saved["issues"]) == (phase_ok and trials[0]["valid"]), "phase eligibility differs")
        phases[phase] = {"metadata": f, "trials": trials, "valid": phase_ok and trials[0]["valid"], "count": count}
    global_ok = bool(cohort_ok and phases["before"] and phases["after"])
    if global_ok:
        b, a = phases["before"]["metadata"], phases["after"]["metadata"]
        last = get("inputs/before/05.receipt.json")
        global_ok = b["sourceSha"] != a["sourceSha"] and b["deploymentId"] != a["deploymentId"] and b["projectId"] == a["projectId"] and b["observerFiles"] == a["observerFiles"] and bool(last) and utc(last["observedAtUtc"]) < utc(a["frozenAtUtc"]) and artifact["stage"] == "final"
    require((not report["globalProblems"]) == global_ok, "global eligibility differs")
    eligible = global_ok and all(p["valid"] and p["count"] == 5 for p in phases.values())
    require(set(report["metrics"]) == set(protocol["metrics"]), "metric omitted or invented")
    classifications = []
    for name, budget in protocol["metrics"].items():
        samples = {phase: [{"ordinal": t["ordinal"], "value": t["values"][name]} for t in phases[phase]["trials"] if t["eligible"] and finite(t["values"][name])] if phases[phase] else [] for phase in phases}
        expected = compare([x["value"] for x in samples["before"]], [x["value"] for x in samples["after"]], budget, protocol["comparison"], eligible)
        expected["samples"] = samples
        require(same(report["metrics"][name], expected), "independent arithmetic mismatch: "+name)
        classifications.append(expected["classification"])
    comparable = sum(c != "not-comparable" for c in classifications)
    status = "complete-observational-comparison" if comparable == len(protocol["metrics"]) else "incomplete-observational-comparison"
    require(report["status"] == status and report["comparableMetricCount"] == comparable and report["improvedMetricCount"] == classifications.count("improved") and report["regressedMetricCount"] == classifications.count("regressed"), "score summary differs")
    return {"schemaVersion": "production-attribution.validation.v1", "status": "evidence-and-scalars-verified", "experimentStatus": status,
        "protocolSha256": PROTOCOL, "artifactMapSha256": expected_map, "baselineMapSha256": artifact["baselineMapSha256"], "scoredSha256": digest(read(scored)),
        "retainedArtifacts": len(content), "comparableMetricCount": comparable, "fieldAdmissionCount": 0, "g003AdmissionCount": 0,
        "meaning": "Independent eligibility and scalar calculations agree; this is not a field admission, general performance pass or code-only causal proof."}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(HERE))
    parser.add_argument("--repository")
    parser.add_argument("--artifact-map", default="artifact-map.json")
    parser.add_argument("--artifact-map-sha256", required=True)
    parser.add_argument("--baseline-map-sha256")
    parser.add_argument("--scored", default="scored.json")
    parser.add_argument("--output", default="validated.json")
    args = parser.parse_args()
    try:
        root = pathlib.Path(args.root).resolve()
        result = validate(root, pathlib.Path(args.repository).resolve() if args.repository else (root/"../../../..").resolve(), args.artifact_map, args.artifact_map_sha256, args.baseline_map_sha256, args.scored)
        require(bool(re.fullmatch(r"[A-Za-z0-9._-]+\.json", args.output)), "use a new JSON output filename")
        with (root/args.output).open("x") as output:
            output.write(json.dumps(result, indent=2)+"\n")
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, "production validation: "+str(error)+"\n")
