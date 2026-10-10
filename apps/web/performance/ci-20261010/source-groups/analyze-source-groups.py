#!/usr/bin/env python3
"""Reproduce a source-group sensitivity analysis for the retained CI baseline.

The script reads the already-sanitized successful-run metadata. It makes no
GitHub API requests and reads no workflow logs. Commit heads are resolved to
exact Git tree objects when those objects exist locally; unresolved heads stay
explicit and form their own ``head:<sha>`` fallback cluster.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import statistics
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Sequence


SCHEMA = "tzudong-ci-performance/v1/source-group-sensitivity"
DEFAULT_RESAMPLES = 10_000
DEFAULT_SEED = 20_261_010
EXPECTED_BASELINE_ARTIFACT_MAP_SHA256 = (
    "ad091212d4e223b711e761aafea797e2632a1ad4d5ff3c6c99d66fb74732a296"
)
EXPECTED_SUCCESSFUL_RUNS_SHA256 = (
    "245f7afc2345556e619fd7be23613b89ffa5561689bfc954b5ec3f43af9eb6b1"
)
EXPECTED_BASELINE_SUMMARY_SHA256 = (
    "97d63069ebe0d62dae2841a44dad7db0644561bd717b064493470d8f5499ae0e"
)
EXPECTED_COLLECTOR_SHA256 = (
    "b53442332490b1386e936890c6ab7f21d4d6bd00602983880447a64bf0e2f2df"
)
HEX_SHA = re.compile(r"^[0-9a-f]{40}$")
METRICS = {
    "criticalPathSeconds": "seconds",
    "runnerOccupiedSeconds": "seconds",
    "totalQueueSeconds": "seconds",
    "maxQueueSeconds": "seconds",
    "benchmarkReportSeconds": "seconds",
    "benchmarkContributionPercent": "percent",
}
GENERATED_FILES = (
    "configuration.json",
    "source-groups.json",
    "summary.json",
    "report.md",
)


class SensitivityError(RuntimeError):
    """Raised when the retained evidence cannot support this analysis."""


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json(value))


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SensitivityError(f"cannot read JSON input: {path}") from error
    if not isinstance(value, dict):
        raise SensitivityError(f"JSON input must be an object: {path}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repository_relative(path: Path, repository_root: Path) -> str:
    try:
        return path.resolve().relative_to(repository_root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def verify_hash(path: Path, expected: str) -> None:
    actual = sha256_file(path)
    if actual != expected:
        raise SensitivityError(
            f"input hash mismatch for {path}: expected {expected}, got {actual}"
        )


def load_collector(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("ci_performance_collector", path)
    if spec is None or spec.loader is None:
        raise SensitivityError(f"cannot load collector: {path}")
    module = importlib.util.module_from_spec(spec)
    previous_dont_write_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_dont_write_bytecode
    return module


def run_git(repository_root: Path, arguments: Sequence[str]) -> str | None:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=repository_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip()


def fetch_origin_heads(repository_root: Path) -> None:
    completed = subprocess.run(
        ["git", "fetch", "--no-tags", "origin", "main", "data"],
        cwd=repository_root,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if completed.returncode != 0:
        raise SensitivityError("read-only fetch of origin main/data failed")


def resolve_head(repository_root: Path, head_sha: str) -> dict[str, Any]:
    normalized = str(head_sha).lower()
    if not HEX_SHA.fullmatch(normalized):
        raise SensitivityError(f"invalid full commit SHA in retained metadata: {head_sha!r}")

    object_type = run_git(repository_root, ["cat-file", "-t", normalized])
    tree_sha = run_git(
        repository_root, ["rev-parse", "--verify", f"{normalized}^{{tree}}"]
    )
    if object_type != "commit" or tree_sha is None or not HEX_SHA.fullmatch(tree_sha):
        return {
            "groupKey": f"head:{normalized}",
            "headSha": normalized,
            "resolutionStatus": "unresolved_fallback_head",
            "treeSha": None,
        }
    if run_git(repository_root, ["cat-file", "-t", tree_sha]) != "tree":
        raise SensitivityError(f"resolved object is not a Git tree: {tree_sha}")
    return {
        "groupKey": f"tree:{tree_sha}",
        "headSha": normalized,
        "resolutionStatus": "resolved_exact_tree",
        "treeSha": tree_sha,
    }


def cluster_bootstrap_interval(
    clusters: Sequence[Sequence[float]],
    statistic: Callable[[Sequence[float]], float],
    resamples: int,
    seed: int,
    collector: Any,
) -> list[float]:
    if not clusters:
        raise SensitivityError("cluster bootstrap requires at least one source group")
    rng = collector.SplitMix64(seed)
    cluster_count = len(clusters)
    estimates: list[float] = []
    for _ in range(resamples):
        sample: list[float] = []
        for _ in range(cluster_count):
            sample.extend(clusters[rng.index(cluster_count)])
        estimates.append(float(statistic(sample)))
    return [
        collector.rounded(collector.percentile(estimates, 0.025)),
        collector.rounded(collector.percentile(estimates, 0.975)),
    ]


def build_report(
    configuration: dict[str, Any],
    groups_payload: dict[str, Any],
    summary: dict[str, Any],
) -> str:
    unresolved_count = configuration["unresolvedHeadCount"]
    resolution_sentence = (
        "All retained heads resolved to exact trees in this artifact."
        if unresolved_count == 0
        else (
            f"{unresolved_count} retained head(s) were unresolved and remain separate "
            "fallback head groups."
        )
    )
    lines = [
        "# CI source-group bootstrap sensitivity",
        "",
        "This is a descriptive sensitivity check on the existing nine-run observational baseline. The original per-run bootstrap and its artifacts remain unchanged.",
        "",
        "## Source groups",
        "",
        f"The {configuration['runCount']} successful runs contain {configuration['distinctHeadCount']} distinct heads and {configuration['sourceGroupCount']} exact-tree/fallback-head source groups. {resolution_sentence}",
        "",
        "| Source group | Runs | Distinct heads | Run IDs |",
        "| --- | ---: | ---: | --- |",
    ]
    for group in groups_payload["groups"]:
        lines.append(
            f"| `{group['groupKey']}` | {group['runCount']} | "
            f"{len(group['headShas'])} | {', '.join(str(value) for value in group['runIds'])} |"
        )

    lines.extend(
        [
            "",
            "## Interval sensitivity",
            "",
            "Each cluster-bootstrap draw samples three complete source groups with replacement, concatenates their run observations, and calculates the run-weighted statistic. Unequal group sizes make resampled run counts range from 3 to 18.",
            "",
            "| Metric | Observed mean | Observed median | Per-run mean 95% interval | Source-group mean 95% interval | Per-run median 95% interval | Source-group median 95% interval |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for metric_name, metric in summary["metrics"].items():
        per_run = metric["baselinePerRunBootstrap95PercentileIntervals"]
        grouped = metric["sourceGroupClusterBootstrap95PercentileIntervals"]
        lines.append(
            f"| {metric_name} | {metric['observed']['mean']:.2f} | "
            f"{metric['observed']['median']:.2f} | "
            f"{per_run['mean'][0]:.2f}–{per_run['mean'][1]:.2f} | "
            f"{grouped['mean'][0]:.2f}–{grouped['mean'][1]:.2f} | "
            f"{per_run['median'][0]:.2f}–{per_run['median'][1]:.2f} | "
            f"{grouped['median'][0]:.2f}–{grouped['median'][1]:.2f} |"
        )

    lines.extend(
        [
            "",
            "## Interpretation limits",
            "",
            "- Three source groups are too few for stable inferential uncertainty estimates. The source-group intervals are descriptive sensitivity ranges only.",
            "- Repeated runs from an identical Git tree are kept together. Unresolved commits would remain explicit `head:<sha>` groups and would never be labeled as a shared tree.",
            "- This invocation used retained job/step metadata and local Git objects. It made no GitHub workflow-run query and read no workflow logs.",
            "- This does not measure a before/after change or prove a performance improvement. A later forecast must account for retained verification/parity/platform coverage, coverage timing changes, and added full-history checkout/classifier cost; gross removed time is not actual net savings.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    script_path = Path(__file__).resolve()
    evidence_root = script_path.parent.parent
    repository_root = script_path.parents[5]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", type=Path, default=repository_root)
    parser.add_argument(
        "--successful-runs", type=Path, default=evidence_root / "successful-runs.json"
    )
    parser.add_argument(
        "--baseline-summary", type=Path, default=evidence_root / "summary.json"
    )
    parser.add_argument(
        "--baseline-artifact-map", type=Path, default=evidence_root / "artifact-map.json"
    )
    parser.add_argument("--output-dir", type=Path, default=script_path.parent)
    parser.add_argument("--bootstrap-resamples", type=int, default=DEFAULT_RESAMPLES)
    parser.add_argument("--bootstrap-seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--fetch-origin",
        action="store_true",
        help="Read-only fetch origin main/data before local commit-tree resolution.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    repository_root = args.repository_root.resolve()
    successful_runs_path = args.successful_runs.resolve()
    baseline_summary_path = args.baseline_summary.resolve()
    baseline_artifact_map_path = args.baseline_artifact_map.resolve()
    output_dir = args.output_dir.resolve()
    collector_path = repository_root / ".github/scripts/collect-ci-performance.py"
    script_path = Path(__file__).resolve()

    if args.bootstrap_resamples < 1_000:
        raise SensitivityError("--bootstrap-resamples must be at least 1000")
    if run_git(repository_root, ["rev-parse", "--is-inside-work-tree"]) != "true":
        raise SensitivityError(f"not a Git worktree: {repository_root}")

    expected_inputs = {
        successful_runs_path: EXPECTED_SUCCESSFUL_RUNS_SHA256,
        baseline_summary_path: EXPECTED_BASELINE_SUMMARY_SHA256,
        baseline_artifact_map_path: EXPECTED_BASELINE_ARTIFACT_MAP_SHA256,
        collector_path: EXPECTED_COLLECTOR_SHA256,
    }
    for path, expected_hash in expected_inputs.items():
        verify_hash(path, expected_hash)

    if args.fetch_origin:
        fetch_origin_heads(repository_root)

    collector = load_collector(collector_path)
    successful_payload = read_json(successful_runs_path)
    baseline_summary = read_json(baseline_summary_path)
    runs = successful_payload.get("runs")
    if not isinstance(runs, list) or not runs:
        raise SensitivityError("retained successful-runs.json contains no runs")

    observations = [collector.analyze_run(run) for run in runs]
    observations.sort(key=lambda item: int(item["runId"]))
    baseline_by_run = {
        int(item["runId"]): item for item in baseline_summary.get("runObservations", [])
    }
    if len(baseline_by_run) != len(observations):
        raise SensitivityError("baseline and retained run counts differ")
    for observation in observations:
        baseline = baseline_by_run.get(int(observation["runId"]))
        if baseline is None:
            raise SensitivityError(f"run absent from baseline: {observation['runId']}")
        for metric_name in METRICS:
            if observation[metric_name] != baseline.get(metric_name):
                raise SensitivityError(
                    f"baseline metric mismatch for run {observation['runId']}: {metric_name}"
                )

    heads = sorted({str(item["headSha"]).lower() for item in observations})
    resolutions = [resolve_head(repository_root, head) for head in heads]
    resolution_by_head = {item["headSha"]: item for item in resolutions}
    grouped_observations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for observation in observations:
        head = str(observation["headSha"]).lower()
        grouped_observations[resolution_by_head[head]["groupKey"]].append(observation)

    groups: list[dict[str, Any]] = []
    for group_key in sorted(grouped_observations):
        group_observations = grouped_observations[group_key]
        group_heads = sorted({str(item["headSha"]).lower() for item in group_observations})
        tree_values = {
            resolution_by_head[head]["treeSha"]
            for head in group_heads
            if resolution_by_head[head]["treeSha"] is not None
        }
        groups.append(
            {
                "groupKey": group_key,
                "headShas": group_heads,
                "resolutionStatus": (
                    "resolved_exact_tree"
                    if group_key.startswith("tree:")
                    else "unresolved_fallback_head"
                ),
                "runCount": len(group_observations),
                "runIds": sorted(int(item["runId"]) for item in group_observations),
                "treeSha": next(iter(tree_values)) if len(tree_values) == 1 else None,
            }
        )

    group_count = len(groups)
    group_sizes = [group["runCount"] for group in groups]
    unresolved_count = sum(
        item["resolutionStatus"] == "unresolved_fallback_head" for item in resolutions
    )
    configuration = {
        "schema": f"{SCHEMA}/configuration",
        "inputs": {
            "baselineArtifactMap": {
                "path": repository_relative(baseline_artifact_map_path, repository_root),
                "sha256": sha256_file(baseline_artifact_map_path),
            },
            "baselineSummary": {
                "path": repository_relative(baseline_summary_path, repository_root),
                "sha256": sha256_file(baseline_summary_path),
            },
            "collector": {
                "path": repository_relative(collector_path, repository_root),
                "sha256": sha256_file(collector_path),
            },
            "successfulRuns": {
                "path": repository_relative(successful_runs_path, repository_root),
                "sha256": sha256_file(successful_runs_path),
            },
        },
        "runCount": len(observations),
        "distinctHeadCount": len(heads),
        "sourceGroupCount": group_count,
        "unresolvedHeadCount": unresolved_count,
        "treeResolution": {
            "fetchPerformedByScript": bool(args.fetch_origin),
            "localCommand": "git rev-parse --verify <head>^{tree}",
            "resolvedRule": "group by exact full tree SHA",
            "unresolvedRule": "mark unresolved and group only by full head SHA",
        },
        "bootstrap": {
            "confidenceLevel": 0.95,
            "method": "one-stage source-cluster percentile bootstrap; sample K source groups with replacement, concatenate complete selected clusters, then calculate run-weighted statistic",
            "randomIndexGenerator": "splitmix64-v1",
            "resamples": args.bootstrap_resamples,
            "seed": args.bootstrap_seed,
            "sourceGroupCount": group_count,
            "resampledClusterCount": group_count,
            "possibleResampledRunCountRange": [
                group_count * min(group_sizes),
                group_count * max(group_sizes),
            ],
        },
        "dataAccess": {
            "githubWorkflowRunQueries": False,
            "rawLogReads": False,
            "retainedSanitizedMetadataOnly": True,
        },
    }

    groups_payload = {
        "schema": f"{SCHEMA}/source-groups",
        "resolutions": resolutions,
        "groups": groups,
    }
    metrics: dict[str, Any] = {}
    for metric_name, unit in METRICS.items():
        metric_clusters = [
            [float(item[metric_name]) for item in grouped_observations[group["groupKey"]]]
            for group in groups
        ]
        baseline_distribution = baseline_summary["runDistributions"][metric_name]
        metrics[metric_name] = {
            "unit": unit,
            "observed": {
                key: baseline_distribution[key]
                for key in (
                    "n",
                    "min",
                    "p25",
                    "median",
                    "p75",
                    "max",
                    "mean",
                    "sampleStandardDeviation",
                )
            },
            "baselinePerRunBootstrap95PercentileIntervals": {
                "mean": baseline_distribution["bootstrapMean95PercentileInterval"],
                "median": baseline_distribution["bootstrapMedian95PercentileInterval"],
            },
            "sourceGroupClusterBootstrap95PercentileIntervals": {
                "mean": cluster_bootstrap_interval(
                    metric_clusters,
                    statistics.fmean,
                    args.bootstrap_resamples,
                    collector.stable_seed(
                        args.bootstrap_seed, f"source-group:{metric_name}:mean"
                    ),
                    collector,
                ),
                "median": cluster_bootstrap_interval(
                    metric_clusters,
                    statistics.median,
                    args.bootstrap_resamples,
                    collector.stable_seed(
                        args.bootstrap_seed, f"source-group:{metric_name}:median"
                    ),
                    collector,
                ),
            },
            "sourceGroupObservedMeans": {
                group["groupKey"]: collector.rounded(
                    statistics.fmean(
                        float(item[metric_name])
                        for item in grouped_observations[group["groupKey"]]
                    )
                )
                for group in groups
            },
        }

    summary = {
        "schema": f"{SCHEMA}/summary",
        "analysisKind": "descriptive source-group bootstrap sensitivity",
        "performanceImprovementClaim": False,
        "sourceGroupCount": group_count,
        "limitedClusterCount": group_count < 8,
        "metrics": metrics,
        "interpretation": (
            f"Only {group_count} source groups are available. Cluster-bootstrap intervals "
            "are descriptive sensitivity ranges, not stable inferential confidence intervals."
        ),
        "counterfactualStatus": "not_computed",
        "limits": [
            "The baseline is observational and unpaired.",
            "The original per-run bootstrap remains unchanged.",
            "Identical Git trees are resampled as complete source clusters.",
            "Unresolved commits remain explicit fallback head clusters.",
            "No before/after performance improvement is measured.",
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "configuration.json", configuration)
    write_json(output_dir / "source-groups.json", groups_payload)
    write_json(output_dir / "summary.json", summary)
    (output_dir / "report.md").write_text(
        build_report(configuration, groups_payload, summary), encoding="utf-8"
    )

    artifact_map = {
        "schema": f"{SCHEMA}/artifact-map",
        "files": [
            {
                "path": name,
                "bytes": (output_dir / name).stat().st_size,
                "sha256": sha256_file(output_dir / name),
            }
            for name in GENERATED_FILES
        ],
        "sourceFiles": [
            {
                "path": repository_relative(script_path, repository_root),
                "bytes": script_path.stat().st_size,
                "sha256": sha256_file(script_path),
            }
        ],
        "inputs": configuration["inputs"],
    }
    write_json(output_dir / "artifact-map.json", artifact_map)
    artifact_map_hash = sha256_file(output_dir / "artifact-map.json")
    (output_dir / "artifact-map.json.sha256").write_text(
        f"{artifact_map_hash}  artifact-map.json\n", encoding="ascii"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SensitivityError as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
