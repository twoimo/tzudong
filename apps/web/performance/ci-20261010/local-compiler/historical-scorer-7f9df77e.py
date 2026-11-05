#!/usr/bin/env python3
"""Measure the removed TypeScript CI command duplication on a fixed snapshot.

This benchmark deliberately compares only the command sequences changed by the
CI simplification:

* before: verify -> native -> compat -> parity
* after:  verify -> parity

The parity command still runs both diagnostic compilers and both logical-input
enumerations. This script does not model the separately gated release benchmark.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import re
import shutil
import statistics
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BENCHMARK_VERSION = 2
BOOTSTRAP_SEED = 20261010
BOOTSTRAP_SAMPLES = 10_000
SEQUENCES = {
    "before": ["verify", "native", "compat", "parity"],
    "after": ["verify", "parity"],
    "aa_a": ["verify", "parity"],
    "aa_b": ["verify", "parity"],
}
COMMANDS = {
    "verify": ["scripts/verify-typescript-toolchain.mjs"],
    "native": ["scripts/run-typecheck.mjs", "--compiler", "native"],
    "compat": ["scripts/run-typecheck.mjs", "--compiler", "compat"],
    "parity": ["scripts/run-typecheck.mjs", "--compiler", "parity"],
}
RSS_RE = re.compile(r"^\s*(\d+)\s+maximum resident set size\s*$", re.MULTILINE)
TIME_LINE_RE = re.compile(r"^(?:real|user|sys)\s+\d+(?:\.\d+)?\s*$", re.MULTILINE)
RESOURCE_LINE_RE = re.compile(r"^\s*\d+\s+[a-z].*$", re.MULTILINE)
TIME_VALUE_RE = re.compile(
    r"^(real|user|sys)\s+(\d+(?:\.\d+)?)\s*$", re.MULTILINE
)
EXPERIMENT_CONFIG_SCHEMA = "tzudong-ci-performance/v2/local-compiler-experiment"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def write_json_atomic(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(canonical_json(value), encoding="utf-8")
    with temporary.open("rb") as handle:
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def read_experiment_config(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("cannot read experiment configuration") from error
    if not isinstance(value, dict) or value.get("schema") != EXPERIMENT_CONFIG_SCHEMA:
        raise RuntimeError("experiment configuration schema mismatch")
    return value


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("percentile requires at least one value")
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def describe(values: list[float]) -> dict[str, float | int]:
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "p50": percentile(values, 0.50),
        "p75": percentile(values, 0.75),
        "p95": percentile(values, 0.95),
        "min": min(values),
        "max": max(values),
    }


def bootstrap_interval(values: list[float], statistic: str) -> list[float]:
    rng = random.Random(BOOTSTRAP_SEED + (0 if statistic == "mean" else 1))
    estimates: list[float] = []
    for _ in range(BOOTSTRAP_SAMPLES):
        sample = [values[rng.randrange(len(values))] for _ in values]
        estimates.append(
            statistics.fmean(sample)
            if statistic == "mean"
            else statistics.median(sample)
        )
    return [percentile(estimates, 0.025), percentile(estimates, 0.975)]


def strip_time_output(stderr: str) -> str:
    value = TIME_LINE_RE.sub("", stderr)
    value = RESOURCE_LINE_RE.sub("", value)
    return "\n".join(line for line in value.splitlines() if line.strip())


def run_command(node: Path, app_root: Path, command_id: str) -> dict[str, Any]:
    command = [str(node), *COMMANDS[command_id]]
    environment = dict(os.environ)
    environment.update({"LC_ALL": "C", "LANG": "C", "NO_COLOR": "1"})
    started_ns = time.perf_counter_ns()
    completed = subprocess.run(
        ["/usr/bin/time", "-lp", *command],
        cwd=app_root,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    duration_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
    rss_match = RSS_RE.search(completed.stderr)
    time_values = {
        name: float(value) for name, value in TIME_VALUE_RE.findall(completed.stderr)
    }
    command_stderr = strip_time_output(completed.stderr)
    return {
        "command": command_id,
        "argv": ["node", *COMMANDS[command_id]],
        "durationMs": duration_ms,
        "exitCode": completed.returncode,
        "success": completed.returncode == 0,
        "maximumResidentSetBytes": int(rss_match.group(1)) if rss_match else None,
        "userCpuSeconds": time_values.get("user"),
        "systemCpuSeconds": time_values.get("sys"),
        "cpuSeconds": (
            time_values["user"] + time_values["sys"]
            if "user" in time_values and "sys" in time_values
            else None
        ),
        "stdoutBytes": len(completed.stdout.encode("utf-8")),
        "stderrBytesExcludingTime": len(command_stderr.encode("utf-8")),
        "stdoutSha256": sha256_text(completed.stdout),
        "stderrSha256ExcludingTime": sha256_text(command_stderr),
        "stderrPreview": command_stderr[:512] if completed.returncode != 0 else "",
    }


def run_sequence(node: Path, app_root: Path, name: str) -> dict[str, Any]:
    started_ns = time.perf_counter_ns()
    commands = [run_command(node, app_root, command_id) for command_id in SEQUENCES[name]]
    cpu_values = [command["cpuSeconds"] for command in commands]
    rss_values = [command["maximumResidentSetBytes"] for command in commands]
    return {
        "sequence": name,
        "durationMs": (time.perf_counter_ns() - started_ns) / 1_000_000,
        "success": all(command["success"] for command in commands),
        "cpuSeconds": (
            sum(float(value) for value in cpu_values)
            if all(value is not None for value in cpu_values)
            else None
        ),
        "maximumResidentSetBytes": (
            max(int(value) for value in rss_values)
            if all(value is not None for value in rss_values)
            else None
        ),
        "commands": commands,
    }


def clone_snapshot(source: Path, destination: Path) -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("snapshot cloning requires macOS cp -c")
    completed = subprocess.run(
        ["/bin/cp", "-cR", str(source), str(destination)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"snapshot clone failed: {completed.stderr[:512]}")
    snapshot_modules = destination / "node_modules"
    if not snapshot_modules.is_symlink():
        raise RuntimeError("source snapshot did not preserve the expected node_modules symlink")
    source_modules = snapshot_modules.resolve(strict=True)
    snapshot_modules.unlink()
    completed = subprocess.run(
        ["/bin/cp", "-cR", str(source_modules), str(snapshot_modules)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"node_modules clone failed: {completed.stderr[:512]}")
    if snapshot_modules.is_symlink():
        raise RuntimeError("snapshot retained the top-level node_modules symlink")


def git_blob_sha1(content: bytes) -> str:
    digest = hashlib.sha1(usedforsecurity=False)
    digest.update(f"blob {len(content)}\0".encode("ascii"))
    digest.update(content)
    return digest.hexdigest()


def verify_tracked_snapshot(repository: Path, snapshot: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "ls-tree",
            "-rz",
            "--full-tree",
            "HEAD",
            "apps/web",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("cannot enumerate measured Git tree")
    count = 0
    for entry in completed.stdout.split(b"\0"):
        if not entry:
            continue
        header, path_bytes = entry.split(b"\t", 1)
        mode, object_type, expected_blob = header.decode("ascii").split(" ")
        if object_type != "blob":
            raise RuntimeError("measured Git tree contains an unsupported object")
        full_path = path_bytes.decode("utf-8", errors="strict")
        prefix = "apps/web/"
        if not full_path.startswith(prefix):
            raise RuntimeError("measured Git path escaped apps/web")
        snapshot_path = snapshot / full_path[len(prefix) :]
        if mode == "120000":
            if not snapshot_path.is_symlink():
                raise RuntimeError(f"tracked snapshot symlink mismatch: {full_path}")
            content = os.readlink(snapshot_path).encode("utf-8")
        else:
            if not snapshot_path.is_file() or snapshot_path.is_symlink():
                raise RuntimeError(f"tracked snapshot file mismatch: {full_path}")
            content = snapshot_path.read_bytes()
        if git_blob_sha1(content) != expected_blob:
            raise RuntimeError(f"tracked snapshot content mismatch: {full_path}")
        count += 1
    return {
        "trackedBlobCount": count,
        "lsTreeSha256": hashlib.sha256(completed.stdout).hexdigest(),
    }


def git_output(repository: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"git {' '.join(arguments)} failed")
    return completed.stdout.strip()


def require_clean_measured_source(repository: Path) -> tuple[str, str]:
    head_sha = git_output(repository, "rev-parse", "--verify", "HEAD^{commit}")
    source_tree_sha = git_output(repository, "rev-parse", "--verify", "HEAD:apps/web")
    status = git_output(
        repository,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        "apps/web",
    )
    if status:
        raise RuntimeError(
            "measured apps/web source is dirty; benchmark requires an exact clean Git tree"
        )
    return head_sha, source_tree_sha


def verify_file_hashes(root: Path, expected: dict[str, Any], label: str) -> dict[str, str]:
    if not isinstance(expected, dict) or not expected:
        raise RuntimeError(f"{label} hash contract is missing")
    actual: dict[str, str] = {}
    for relative, expected_hash in sorted(expected.items()):
        if not isinstance(relative, str) or not isinstance(expected_hash, str):
            raise RuntimeError(f"{label} hash contract is malformed")
        path = root / relative
        if not path.is_file():
            raise RuntimeError(f"{label} input is missing: {relative}")
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise RuntimeError(f"{label} input hash mismatch: {relative}")
        actual[relative] = actual_hash
    return actual


def validate_experiment_contract(
    config: dict[str, Any],
    repository: Path,
    source: Path,
    node: Path,
    benchmark_path: Path,
    pairs: int,
    aa_pairs: int,
    warmups: int,
) -> dict[str, Any]:
    head_sha, source_tree_sha = require_clean_measured_source(repository)
    exact_values = {
        "expectedGitHead": head_sha,
        "expectedSourceTreeSha": source_tree_sha,
        "expectedNodePath": str(node.resolve()),
        "expectedNodeVersion": subprocess.check_output(
            [str(node), "--version"], text=True
        ).strip(),
        "expectedBenchmarkScriptSha256": sha256_file(benchmark_path),
        "pairs": pairs,
        "aaPairs": aa_pairs,
        "warmups": warmups,
        "bootstrapSeed": BOOTSTRAP_SEED,
        "bootstrapSamples": BOOTSTRAP_SAMPLES,
    }
    for key, actual in exact_values.items():
        if config.get(key) != actual:
            raise RuntimeError(f"experiment configuration mismatch: {key}")

    budgets = config.get("acceptanceBudgets")
    required_budgets = {
        "absoluteMeanReductionBootstrap95CiLowerBoundMs": (int, float),
        "relativeMeanReductionBootstrap95CiLowerBoundPercent": (int, float),
        "noiseAaP95AbsoluteRelativeDifferencePercentMaximum": (int, float),
        "noiseAaMeanDifference95CiMustIncludeZero": bool,
    }
    if not isinstance(budgets, dict):
        raise RuntimeError("acceptance budgets are missing")
    for key, expected_type in required_budgets.items():
        if not isinstance(budgets.get(key), expected_type):
            raise RuntimeError(f"acceptance budget is malformed: {key}")
    if budgets["noiseAaMeanDifference95CiMustIncludeZero"] is not True:
        raise RuntimeError("A/A mean-difference interval budget must require zero")

    source_hashes = verify_file_hashes(
        source, config.get("expectedSourceHashes"), "source"
    )
    node_modules = source / "node_modules"
    if not node_modules.is_symlink():
        raise RuntimeError("node_modules must be a read-only-use symlink")
    dependency_target = node_modules.resolve(strict=True)
    if str(dependency_target) != config.get("expectedNodeModulesTarget"):
        raise RuntimeError("node_modules symlink target mismatch")
    dependency_hashes = verify_file_hashes(
        node_modules, config.get("expectedDependencyHashes"), "dependency"
    )
    return {
        "gitHead": head_sha,
        "sourceTreeSha": source_tree_sha,
        "sourceHashes": source_hashes,
        "dependencyHashes": dependency_hashes,
        "nodeModulesTarget": str(dependency_target),
    }


def analyze(raw: dict[str, Any]) -> dict[str, Any]:
    measured = raw["measuredPairs"]
    aa_pairs = raw["aaPairs"]
    all_sequences = [
        sequence
        for pair in [*measured, *aa_pairs]
        for sequence in pair["runs"]
    ]
    if not all(sequence["success"] for sequence in all_sequences):
        raise RuntimeError("at least one measured sequence failed; raw evidence retained")
    by_sequence: dict[str, list[float]] = {"before": [], "after": []}
    cpu_by_sequence: dict[str, list[float]] = {"before": [], "after": []}
    rss_by_sequence: dict[str, list[float]] = {"before": [], "after": []}
    command_timings: dict[str, dict[str, list[float]]] = {
        "before": {command: [] for command in SEQUENCES["before"]},
        "after": {command: [] for command in SEQUENCES["after"]},
    }
    paired_absolute: list[float] = []
    paired_relative: list[float] = []
    for pair in measured:
        indexed = {run["sequence"]: run for run in pair["runs"]}
        before = indexed["before"]["durationMs"]
        after = indexed["after"]["durationMs"]
        by_sequence["before"].append(before)
        by_sequence["after"].append(after)
        for name in ("before", "after"):
            if indexed[name]["cpuSeconds"] is not None:
                cpu_by_sequence[name].append(float(indexed[name]["cpuSeconds"]))
            if indexed[name]["maximumResidentSetBytes"] is not None:
                rss_by_sequence[name].append(
                    float(indexed[name]["maximumResidentSetBytes"])
                )
        paired_absolute.append(before - after)
        paired_relative.append((before - after) / before * 100)
        for name in ("before", "after"):
            for command in indexed[name]["commands"]:
                command_timings[name][command["command"]].append(command["durationMs"])
    aa_signed_ms: list[float] = []
    aa_absolute_relative_percent: list[float] = []
    for pair in aa_pairs:
        indexed = {run["sequence"]: run for run in pair["runs"]}
        first = float(indexed["aa_a"]["durationMs"])
        second = float(indexed["aa_b"]["durationMs"])
        aa_signed_ms.append(first - second)
        aa_absolute_relative_percent.append(
            abs(first - second) / ((first + second) / 2) * 100
        )

    absolute_ci = bootstrap_interval(paired_absolute, "mean")
    relative_ci = bootstrap_interval(paired_relative, "mean")
    aa_mean_ci = bootstrap_interval(aa_signed_ms, "mean")
    aa_relative = describe(aa_absolute_relative_percent)
    budgets = raw["metadata"]["experimentConfig"]["acceptanceBudgets"]
    budget_checks = {
        "absolute": (
            absolute_ci[0]
            >= float(budgets["absoluteMeanReductionBootstrap95CiLowerBoundMs"])
        ),
        "relative": (
            relative_ci[0]
            >= float(
                budgets["relativeMeanReductionBootstrap95CiLowerBoundPercent"]
            )
        ),
        "noiseP95": (
            aa_relative["p95"]
            <= float(
                budgets[
                    "noiseAaP95AbsoluteRelativeDifferencePercentMaximum"
                ]
            )
        ),
        "noiseMeanCiIncludesZero": aa_mean_ci[0] <= 0 <= aa_mean_ci[1],
    }
    resource_complete = all(
        sequence["cpuSeconds"] is not None
        and sequence["maximumResidentSetBytes"] is not None
        for sequence in all_sequences
    )
    integrity_checks = {
        "allSequencesSucceeded": True,
        "sourceContractUnchanged": bool(raw["metadata"]["sourceContractUnchanged"]),
        "resourceMeasurementsComplete": resource_complete,
        "pairedSampleCountPreserved": len(measured)
        == int(raw["metadata"]["experimentConfig"]["pairs"]),
        "aaSampleCountPreserved": len(aa_pairs)
        == int(raw["metadata"]["experimentConfig"]["aaPairs"]),
    }
    admitted = all(budget_checks.values()) and all(integrity_checks.values())

    return {
        "schemaVersion": 2,
        "comparison": "verify+native+compat+parity versus verify+parity",
        "sampleCountPaired": len(measured),
        "sampleCountAaPaired": len(aa_pairs),
        "sequenceDurationMs": {name: describe(values) for name, values in by_sequence.items()},
        "sequenceCpuSeconds": {
            name: describe(values) for name, values in cpu_by_sequence.items()
        },
        "sequenceMaximumResidentSetBytes": {
            name: describe(values) for name, values in rss_by_sequence.items()
        },
        "commandDurationMs": {
            name: {command: describe(values) for command, values in commands.items()}
            for name, commands in command_timings.items()
        },
        "pairedReduction": {
            "absoluteMs": {
                **describe(paired_absolute),
                "meanBootstrap95Ci": absolute_ci,
                "medianBootstrap95Ci": bootstrap_interval(paired_absolute, "median"),
            },
            "relativePercent": {
                **describe(paired_relative),
                "meanBootstrap95Ci": relative_ci,
                "medianBootstrap95Ci": bootstrap_interval(paired_relative, "median"),
            },
        },
        "aaNoise": {
            "signedDifferenceMs": {
                **describe(aa_signed_ms),
                "meanBootstrap95Ci": aa_mean_ci,
            },
            "absoluteRelativeDifferencePercent": aa_relative,
        },
        "scope": {
            "included": "local duplicate diagnostic sequence only",
            "excluded": [
                "hosted runner latency and queue time",
                "release typecheck benchmark routing",
                "GitHub billing or billed minutes",
                "application tests, builds, lint, and security scans",
            ],
        },
        "evidenceAdmission": {
            "admitted": admitted,
            "scope": "local duplicate compiler command sequence only",
            "predeclaredBudgets": budgets,
            "budgetChecks": budget_checks,
            "integrityChecks": integrity_checks,
            "officialApproval": False,
        },
    }


def render_report(raw: dict[str, Any], summary: dict[str, Any]) -> str:
    before = summary["sequenceDurationMs"]["before"]
    after = summary["sequenceDurationMs"]["after"]
    absolute = summary["pairedReduction"]["absoluteMs"]
    relative = summary["pairedReduction"]["relativePercent"]
    before_cpu = summary["sequenceCpuSeconds"]["before"]
    after_cpu = summary["sequenceCpuSeconds"]["after"]
    before_rss = summary["sequenceMaximumResidentSetBytes"]["before"]
    after_rss = summary["sequenceMaximumResidentSetBytes"]["after"]
    aa_signed = summary["aaNoise"]["signedDifferenceMs"]
    aa_relative = summary["aaNoise"]["absoluteRelativeDifferencePercent"]
    admission = summary["evidenceAdmission"]
    status = "admitted local evidence" if admission["admitted"] else "not admitted"
    return f"""# Local TypeScript CI duplicate replay — {status}

Measured {summary['sampleCountPaired']} before/after pairs and {summary['sampleCountAaPaired']} A/A pairs on a content-verified copy-on-write snapshot of clean private source tree `{raw['metadata']['sourceTreeSha']}` at commit `{raw['metadata']['gitHead']}`. Pair order alternated deterministically.

| Metric | Before | After | Paired reduction |
| --- | ---: | ---: | ---: |
| p50 | {before['p50']:.2f} ms | {after['p50']:.2f} ms | — |
| p75 | {before['p75']:.2f} ms | {after['p75']:.2f} ms | — |
| p95 | {before['p95']:.2f} ms | {after['p95']:.2f} ms | — |
| Mean | {before['mean']:.2f} ms | {after['mean']:.2f} ms | {absolute['mean']:.2f} ms / {relative['mean']:.2f}% |

Mean paired absolute reduction bootstrap 95% CI: {absolute['meanBootstrap95Ci'][0]:.2f}–{absolute['meanBootstrap95Ci'][1]:.2f} ms. Mean paired relative reduction bootstrap 95% CI: {relative['meanBootstrap95Ci'][0]:.2f}–{relative['meanBootstrap95Ci'][1]:.2f}%.

| Resource (descriptive) | Before | After |
| --- | ---: | ---: |
| Mean CPU | {before_cpu['mean']:.2f} s | {after_cpu['mean']:.2f} s |
| p75 CPU | {before_cpu['p75']:.2f} s | {after_cpu['p75']:.2f} s |
| p95 CPU | {before_cpu['p95']:.2f} s | {after_cpu['p95']:.2f} s |
| p75 max command RSS | {before_rss['p75'] / 1048576:.2f} MiB | {after_rss['p75'] / 1048576:.2f} MiB |
| p95 max command RSS | {before_rss['p95'] / 1048576:.2f} MiB | {after_rss['p95'] / 1048576:.2f} MiB |

A/A noise p95 absolute relative difference: {aa_relative['p95']:.2f}%. A/A signed mean-difference bootstrap 95% CI: {aa_signed['meanBootstrap95Ci'][0]:.2f}–{aa_signed['meanBootstrap95Ci'][1]:.2f} ms.

Acceptance: absolute={admission['budgetChecks']['absolute']}, relative={admission['budgetChecks']['relative']}, noise-p95={admission['budgetChecks']['noiseP95']}, noise-mean-CI={admission['budgetChecks']['noiseMeanCiIncludesZero']}, integrity={all(admission['integrityChecks'].values())}. Local evidence admitted={admission['admitted']}; official approval remains false.

The before sequence ran `verify`, standalone `native`, standalone `compat`, then `parity`. The after sequence ran `verify` then `parity`; `parity` itself still executed both diagnostic compilers and both logical-input enumerations. This replay does not include or estimate the separately gated release benchmark.

All {sum(1 for pair in [*raw['measuredPairs'], *raw['aaPairs']] for run in pair['runs'] if run['success'])} measured sequences succeeded. `/usr/bin/time -l` CPU and maximum RSS are retained per command; maximum RSS is descriptive process data only and is not subprocess-tree memory.

This is a local macOS replay under shared-host load. It is not evidence of hosted GitHub runner latency, production behavior, billed-minute savings, a full CI speedup, or G003 approval.

The absolute, relative, and A/A budgets were frozen in the hashed experiment configuration before measurement. They originated as post hoc guardrails after the rejected historical run; they are prospective only for this new experiment.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--pairs", type=int, default=7)
    parser.add_argument("--aa-pairs", type=int, default=7)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--experiment-config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    repository = args.repository.resolve()
    source = repository / "apps" / "web"
    output_dir = args.output_dir.resolve()
    experiment_config_path = args.experiment_config.resolve()
    benchmark_path = Path(__file__).resolve()
    if args.pairs < 7:
        raise ValueError("at least 7 paired runs are required")
    if args.aa_pairs < 7:
        raise ValueError("at least 7 A/A paired runs are required")
    if args.warmups < 0 or args.warmups > 3:
        raise ValueError("warmups must be between 0 and 3")
    if not args.node.is_file() or not os.access(args.node, os.X_OK):
        raise ValueError("--node must be an executable file")
    if output_dir == source or source in output_dir.parents:
        raise ValueError("--output-dir must be outside the measured apps/web tree")
    if output_dir.exists():
        raise ValueError("--output-dir must not already exist")
    experiment_config = read_experiment_config(experiment_config_path)
    contract_before = validate_experiment_contract(
        experiment_config,
        repository,
        source,
        args.node,
        benchmark_path,
        args.pairs,
        args.aa_pairs,
        args.warmups,
    )
    git_head = contract_before["gitHead"]
    source_tree_sha = contract_before["sourceTreeSha"]
    output_dir.mkdir(parents=True)
    raw_path = output_dir / "raw.json"
    summary_path = output_dir / "summary.json"
    report_path = output_dir / "report.md"
    retained_config_path = output_dir / "configuration.json"
    retained_config_path.write_text(canonical_json(experiment_config), encoding="utf-8")
    load_before = os.getloadavg()
    temporary_root = Path(
        tempfile.mkdtemp(prefix="private-snapshot-", dir=output_dir.parent)
    )
    snapshot = temporary_root / "web"
    clone_snapshot(source, snapshot)
    snapshot_contract_before = verify_tracked_snapshot(repository, snapshot)
    snapshot_dependency_hashes_before = verify_file_hashes(
        snapshot / "node_modules",
        experiment_config["expectedDependencyHashes"],
        "snapshot dependency",
    )
    metadata = {
        "schemaVersion": BENCHMARK_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "gitHead": git_head,
        "gitStatusSha256": sha256_text(""),
        "sourceTreeSha": source_tree_sha,
        "sourceAdmission": "clean exact tracked apps/web Git tree",
        "sourceExecutionMode": "copy-on-write snapshot from clean private checkout; shared node_modules used only as the source of a private copy",
        "nodePath": str(args.node.resolve()),
        "nodeVersion": subprocess.check_output(
            [str(args.node), "--version"], text=True
        ).strip(),
        "npmPackageManagerPin": json.loads((source / "package.json").read_text())[
            "packageManager"
        ],
        "bunVersion": "1.4.0 (recorded project/runtime pin; Bun not invoked)",
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpuCount": os.cpu_count(),
        "loadAverageBefore": load_before,
        "sourceHashes": contract_before["sourceHashes"],
        "dependencyHashes": contract_before["dependencyHashes"],
        "nodeModulesTarget": contract_before["nodeModulesTarget"],
        "trackedSnapshotContract": snapshot_contract_before,
        "snapshotDependencyHashes": snapshot_dependency_hashes_before,
        "benchmarkScriptSha256": sha256_file(benchmark_path),
        "experimentConfigSha256": sha256_file(experiment_config_path),
        "experimentConfig": experiment_config,
        "sequences": SEQUENCES,
        "bootstrap": {"seed": BOOTSTRAP_SEED, "samples": BOOTSTRAP_SAMPLES},
        "rssMeasurement": "/usr/bin/time -l maximum resident set size per command; descriptive only",
        "sourceContractUnchanged": False,
    }
    raw = {
        "metadata": metadata,
        "warmups": [],
        "measuredPairs": [],
        "aaPairs": [],
        "status": "running",
    }
    write_json_atomic(raw_path, raw)
    for index in range(args.warmups):
        order = ["before", "after"] if index % 2 == 0 else ["after", "before"]
        raw["warmups"].append(
            {
                "index": index + 1,
                "order": order,
                "runs": [run_sequence(args.node, snapshot, name) for name in order],
            }
        )
        write_json_atomic(raw_path, raw)
    for index in range(args.pairs):
        order = ["before", "after"] if index % 2 == 0 else ["after", "before"]
        raw["measuredPairs"].append(
            {
                "pair": index + 1,
                "order": order,
                "loadAverageBefore": os.getloadavg(),
                "runs": [run_sequence(args.node, snapshot, name) for name in order],
                "loadAverageAfter": os.getloadavg(),
            }
        )
        write_json_atomic(raw_path, raw)
    for index in range(args.aa_pairs):
        order = ["aa_a", "aa_b"] if index % 2 == 0 else ["aa_b", "aa_a"]
        raw["aaPairs"].append(
            {
                "pair": index + 1,
                "order": order,
                "loadAverageBefore": os.getloadavg(),
                "runs": [run_sequence(args.node, snapshot, name) for name in order],
                "loadAverageAfter": os.getloadavg(),
            }
        )
        write_json_atomic(raw_path, raw)
    contract_after = validate_experiment_contract(
        experiment_config,
        repository,
        source,
        args.node,
        benchmark_path,
        args.pairs,
        args.aa_pairs,
        args.warmups,
    )
    snapshot_contract_after = verify_tracked_snapshot(repository, snapshot)
    snapshot_dependency_hashes_after = verify_file_hashes(
        snapshot / "node_modules",
        experiment_config["expectedDependencyHashes"],
        "snapshot dependency",
    )
    raw["metadata"]["sourceContractUnchanged"] = (
        contract_after == contract_before
        and snapshot_contract_after == snapshot_contract_before
        and snapshot_dependency_hashes_after == snapshot_dependency_hashes_before
    )
    raw["loadAverageAfter"] = os.getloadavg()
    raw["completedAt"] = datetime.now(timezone.utc).isoformat()
    raw["status"] = "completed"
    write_json_atomic(raw_path, raw)
    summary = analyze(raw)
    write_json_atomic(summary_path, summary)
    report_path.write_text(render_report(raw, summary), encoding="utf-8")
    shutil.rmtree(temporary_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
