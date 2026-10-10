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


BENCHMARK_VERSION = 1
BOOTSTRAP_SEED = 20261010
BOOTSTRAP_SAMPLES = 10_000
SEQUENCES = {
    "before": ["verify", "native", "compat", "parity"],
    "after": ["verify", "parity"],
}
COMMANDS = {
    "verify": ["scripts/verify-typescript-toolchain.mjs"],
    "native": ["scripts/run-typecheck.mjs", "--compiler", "native"],
    "compat": ["scripts/run-typecheck.mjs", "--compiler", "compat"],
    "parity": ["scripts/run-typecheck.mjs", "--compiler", "parity"],
}
HASHED_INPUTS = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "scripts/run-typecheck.mjs",
    "scripts/verify-typescript-toolchain.mjs",
]
RSS_RE = re.compile(r"^\s*(\d+)\s+maximum resident set size\s*$", re.MULTILINE)
TIME_LINE_RE = re.compile(r"^(?:real|user|sys)\s+\d+(?:\.\d+)?\s*$", re.MULTILINE)
RESOURCE_LINE_RE = re.compile(r"^\s*\d+\s+[a-z].*$", re.MULTILINE)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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
    command_stderr = strip_time_output(completed.stderr)
    return {
        "command": command_id,
        "argv": ["node", *COMMANDS[command_id]],
        "durationMs": duration_ms,
        "exitCode": completed.returncode,
        "success": completed.returncode == 0,
        "maximumResidentSetBytes": int(rss_match.group(1)) if rss_match else None,
        "stdoutBytes": len(completed.stdout.encode("utf-8")),
        "stderrBytesExcludingTime": len(command_stderr.encode("utf-8")),
        "stdoutSha256": sha256_text(completed.stdout),
        "stderrSha256ExcludingTime": sha256_text(command_stderr),
        "stderrPreview": command_stderr[:512] if completed.returncode != 0 else "",
    }


def run_sequence(node: Path, app_root: Path, name: str) -> dict[str, Any]:
    started_ns = time.perf_counter_ns()
    commands = [run_command(node, app_root, command_id) for command_id in SEQUENCES[name]]
    return {
        "sequence": name,
        "durationMs": (time.perf_counter_ns() - started_ns) / 1_000_000,
        "success": all(command["success"] for command in commands),
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


def analyze(raw: dict[str, Any]) -> dict[str, Any]:
    measured = raw["measuredPairs"]
    if not all(sequence["success"] for pair in measured for sequence in pair["runs"]):
        raise RuntimeError("at least one measured sequence failed; raw evidence retained")
    by_sequence: dict[str, list[float]] = {"before": [], "after": []}
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
        paired_absolute.append(before - after)
        paired_relative.append((before - after) / before * 100)
        for name in ("before", "after"):
            for command in indexed[name]["commands"]:
                command_timings[name][command["command"]].append(command["durationMs"])
    return {
        "schemaVersion": 1,
        "comparison": "verify+native+compat+parity versus verify+parity",
        "sampleCountPaired": len(measured),
        "sequenceDurationMs": {name: describe(values) for name, values in by_sequence.items()},
        "commandDurationMs": {
            name: {command: describe(values) for command, values in commands.items()}
            for name, commands in command_timings.items()
        },
        "pairedReduction": {
            "absoluteMs": {
                **describe(paired_absolute),
                "meanBootstrap95Ci": bootstrap_interval(paired_absolute, "mean"),
                "medianBootstrap95Ci": bootstrap_interval(paired_absolute, "median"),
            },
            "relativePercent": {
                **describe(paired_relative),
                "meanBootstrap95Ci": bootstrap_interval(paired_relative, "mean"),
                "medianBootstrap95Ci": bootstrap_interval(paired_relative, "median"),
            },
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
    }


def render_report(raw: dict[str, Any], summary: dict[str, Any]) -> str:
    before = summary["sequenceDurationMs"]["before"]
    after = summary["sequenceDurationMs"]["after"]
    absolute = summary["pairedReduction"]["absoluteMs"]
    relative = summary["pairedReduction"]["relativePercent"]
    return f"""# Local TypeScript CI duplicate replay

Measured {summary['sampleCountPaired']} paired runs on a fixed copy-on-write source snapshot. Pair order alternated deterministically: odd pairs `before -> after`, even pairs `after -> before`.

| Metric | Before | After | Paired reduction |
| --- | ---: | ---: | ---: |
| p50 | {before['p50']:.2f} ms | {after['p50']:.2f} ms | — |
| p75 | {before['p75']:.2f} ms | {after['p75']:.2f} ms | — |
| p95 | {before['p95']:.2f} ms | {after['p95']:.2f} ms | — |
| Mean | {before['mean']:.2f} ms | {after['mean']:.2f} ms | {absolute['mean']:.2f} ms / {relative['mean']:.2f}% |

Mean paired absolute reduction bootstrap 95% CI: {absolute['meanBootstrap95Ci'][0]:.2f}–{absolute['meanBootstrap95Ci'][1]:.2f} ms. Mean paired relative reduction bootstrap 95% CI: {relative['meanBootstrap95Ci'][0]:.2f}–{relative['meanBootstrap95Ci'][1]:.2f}%.

The before sequence ran `verify`, standalone `native`, standalone `compat`, then `parity`. The after sequence ran `verify` then `parity`; `parity` itself still executed both diagnostic compilers and both logical-input enumerations. This replay does not include or estimate the separately gated release benchmark.

All {sum(1 for pair in raw['measuredPairs'] for run in pair['runs'] if run['success'])} measured sequences succeeded. `/usr/bin/time -l` maximum RSS is retained per command as descriptive process data only; subprocess-tree accounting is not treated as a memory-performance result.

This is a local macOS replay under shared-host load, with {summary['sampleCountPaired']} pairs from one source snapshot. It is not evidence of hosted GitHub runner latency, production behavior, billed-minute savings, or a full CI speedup.
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--pairs", type=int, default=7)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    repository = args.repository.resolve()
    source = repository / "apps" / "web"
    output_dir = args.output_dir.resolve()
    benchmark_path = Path(__file__).resolve()
    if args.pairs < 7:
        raise ValueError("at least 7 paired runs are required")
    if args.warmups < 0 or args.warmups > 3:
        raise ValueError("warmups must be between 0 and 3")
    if not args.node.is_file() or not os.access(args.node, os.X_OK):
        raise ValueError("--node must be an executable file")
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = output_dir / "raw.json"
    summary_path = output_dir / "summary.json"
    report_path = output_dir / "report.md"
    load_before = os.getloadavg()
    temporary_root = Path(tempfile.mkdtemp(prefix="tzudong-ci-compiler-replay-"))
    snapshot = temporary_root / "web"
    try:
        clone_snapshot(source, snapshot)
        metadata = {
            "schemaVersion": BENCHMARK_VERSION,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "gitHead": git_output(repository, "rev-parse", "HEAD"),
            "gitStatusSha256": sha256_text(git_output(repository, "status", "--porcelain=v1")),
            "nodePath": str(args.node.resolve()),
            "nodeVersion": subprocess.check_output([str(args.node), "--version"], text=True).strip(),
            "npmPackageManagerPin": json.loads((snapshot / "package.json").read_text())["packageManager"],
            "bunVersion": "1.4.0 (recorded project/runtime pin; Bun not invoked)",
            "platform": platform.platform(),
            "machine": platform.machine(),
            "cpuCount": os.cpu_count(),
            "loadAverageBefore": load_before,
            "sourceSnapshotMethod": "macOS cp -cR copy-on-write app clone; materialized top-level node_modules symlink while preserving package shims",
            "sourceHashes": {relative: sha256_file(snapshot / relative) for relative in HASHED_INPUTS},
            "benchmarkScriptSha256": sha256_file(benchmark_path),
            "sequences": SEQUENCES,
            "bootstrap": {"seed": BOOTSTRAP_SEED, "samples": BOOTSTRAP_SAMPLES},
            "rssMeasurement": "/usr/bin/time -l maximum resident set size; descriptive only",
        }
        warmups = []
        for index in range(args.warmups):
            order = ["before", "after"] if index % 2 == 0 else ["after", "before"]
            warmups.append({"index": index + 1, "order": order, "runs": [run_sequence(args.node, snapshot, name) for name in order]})
        measured = []
        for index in range(args.pairs):
            order = ["before", "after"] if index % 2 == 0 else ["after", "before"]
            measured.append({
                "pair": index + 1,
                "order": order,
                "loadAverageBefore": os.getloadavg(),
                "runs": [run_sequence(args.node, snapshot, name) for name in order],
                "loadAverageAfter": os.getloadavg(),
            })
        raw = {
            "metadata": metadata,
            "warmups": warmups,
            "measuredPairs": measured,
            "loadAverageAfter": os.getloadavg(),
        }
        raw_path.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        try:
            summary = analyze(raw)
        except Exception:
            raise
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        report_path.write_text(render_report(raw, summary), encoding="utf-8")
    finally:
        shutil.rmtree(temporary_root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
