#!/usr/bin/env python3
"""Reproduce a source-group sensitivity analysis for the retained CI baseline.

The script reads the already-sanitized successful-run metadata. It makes no
GitHub API requests and reads no workflow logs. Every retained head must have
an authenticated head-to-tree entry. Local Git objects verify that entry when
available; they are not required to reproduce the retained three groups.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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
EXPECTED_HEAD_TREE_MAP_SHA256 = (
    "f6a54be3d5e5958f95b793844932f5f1f7d123083145304891c6dcd977700fe8"
)
EXPECTED_PROVENANCE_SOURCE_GROUPS_SHA256 = (
    "ed9833d1d9a438e2b9d78ccaadc54bfad51675f80d4d13dfe8867adf7ea5542f"
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


def percentile(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise SensitivityError("cannot calculate percentile of empty input")
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def stable_seed(base_seed: int, label: str) -> int:
    digest = hashlib.sha256(f"{base_seed}:{label}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


class SplitMix64:
    MASK = (1 << 64) - 1

    def __init__(self, seed: int) -> None:
        self.state = seed & self.MASK

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & self.MASK
        value = self.state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & self.MASK
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & self.MASK
        return value ^ (value >> 31)

    def index(self, upper_bound: int) -> int:
        if upper_bound < 1:
            raise SensitivityError("bootstrap index requires a positive bound")
        return (self.next_u64() * upper_bound) >> 64


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


def load_retained_head_tree_map(
    path: Path,
    expected_sha256: str,
    expected_heads: set[str],
) -> dict[str, str]:
    verify_hash(path, expected_sha256)
    payload = read_json(path)
    if payload.get("schema") != f"{SCHEMA}/retained-head-tree-map":
        raise SensitivityError("retained head-to-tree map schema mismatch")
    if payload.get("successfulRunsSha256") != EXPECTED_SUCCESSFUL_RUNS_SHA256:
        raise SensitivityError("retained head-to-tree map input hash mismatch")
    if (
        payload.get("provenanceSourceGroupsSha256")
        != EXPECTED_PROVENANCE_SOURCE_GROUPS_SHA256
    ):
        raise SensitivityError("retained head-to-tree map provenance hash mismatch")
    entries = payload.get("mappings")
    if not isinstance(entries, list):
        raise SensitivityError("retained head-to-tree mappings must be an array")

    retained: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise SensitivityError("retained head-to-tree entry must be an object")
        head_sha = str(entry.get("headSha", "")).lower()
        tree_sha = str(entry.get("treeSha", "")).lower()
        if not HEX_SHA.fullmatch(head_sha) or not HEX_SHA.fullmatch(tree_sha):
            raise SensitivityError("retained head-to-tree entry has an invalid SHA")
        if head_sha in retained:
            raise SensitivityError(f"duplicate retained head mapping: {head_sha}")
        retained[head_sha] = tree_sha

    retained_heads = set(retained)
    if retained_heads != expected_heads:
        missing = len(expected_heads - retained_heads)
        extra = len(retained_heads - expected_heads)
        raise SensitivityError(
            "retained head-to-tree mapping count/set mismatch: "
            f"expected {len(expected_heads)}, got {len(retained_heads)}, "
            f"missing {missing}, extra {extra}"
        )
    return retained


def resolve_head(
    repository_root: Path,
    head_sha: str,
    retained_tree_sha: str,
) -> dict[str, Any]:
    normalized = str(head_sha).lower()
    if not HEX_SHA.fullmatch(normalized):
        raise SensitivityError(f"invalid full commit SHA in retained metadata: {head_sha!r}")
    retained_tree = str(retained_tree_sha).lower()
    if not HEX_SHA.fullmatch(retained_tree):
        raise SensitivityError(f"invalid retained tree SHA for head {normalized}")

    object_type = run_git(repository_root, ["cat-file", "-t", normalized])
    if object_type is None:
        retained_tree_type = run_git(repository_root, ["cat-file", "-t", retained_tree])
        if retained_tree_type not in (None, "tree"):
            raise SensitivityError(
                f"retained mapping target is not a Git tree: {retained_tree}"
            )
        return {
            "groupKey": f"tree:{retained_tree}",
            "headSha": normalized,
            "resolutionStatus": "retained_exact_tree_object_absent",
            "treeSha": retained_tree,
        }
    if object_type != "commit":
        raise SensitivityError(f"retained head object is not a commit: {normalized}")
    tree_sha = run_git(repository_root, ["rev-parse", "--verify", f"{normalized}^{{tree}}"])
    if tree_sha is None or not HEX_SHA.fullmatch(tree_sha):
        raise SensitivityError(f"cannot resolve local tree for retained head: {normalized}")
    if tree_sha != retained_tree:
        raise SensitivityError(
            f"retained mapping disagrees with local Git object for head {normalized}"
        )
    retained_tree_type = run_git(repository_root, ["cat-file", "-t", retained_tree])
    if retained_tree_type not in (None, "tree"):
        raise SensitivityError(f"resolved object is not a Git tree: {retained_tree}")
    return {
        "groupKey": f"tree:{retained_tree}",
        "headSha": normalized,
        "resolutionStatus": "retained_exact_tree_object_verified",
        "treeSha": retained_tree,
    }


def cluster_bootstrap_interval(
    clusters: Sequence[Sequence[float]],
    statistic: Callable[[Sequence[float]], float],
    resamples: int,
    seed: int,
) -> list[float]:
    if not clusters:
        raise SensitivityError("cluster bootstrap requires at least one source group")
    rng = SplitMix64(seed)
    cluster_count = len(clusters)
    estimates: list[float] = []
    for _ in range(resamples):
        sample: list[float] = []
        for _ in range(cluster_count):
            sample.extend(clusters[rng.index(cluster_count)])
        estimates.append(float(statistic(sample)))
    return [
        round(float(percentile(estimates, 0.025)), 6),
        round(float(percentile(estimates, 0.975)), 6),
    ]


def build_report(
    configuration: dict[str, Any],
    groups_payload: dict[str, Any],
    summary: dict[str, Any],
) -> str:
    verified_count = configuration["locallyVerifiedHeadCount"]
    absent_count = configuration["localObjectAbsentHeadCount"]
    resolution_sentence = (
        f"The retained mapping supplied every exact tree; {verified_count} mapping(s) "
        f"were also verified against local commit objects and {absent_count} were "
        "replayed without requiring those objects."
    )
    lines = [
        "# CI source-group bootstrap sensitivity",
        "",
        "This is a descriptive sensitivity check on the existing nine-run observational baseline. The original per-run bootstrap and its artifacts remain unchanged.",
        "",
        "## Source groups",
        "",
        f"The {configuration['runCount']} successful runs contain {configuration['distinctHeadCount']} distinct heads and {configuration['sourceGroupCount']} exact-tree source groups. {resolution_sentence}",
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
            f"Each cluster-bootstrap draw samples {configuration['sourceGroupCount']} complete source groups with replacement, concatenates their run observations, and calculates the run-weighted statistic. Unequal group sizes make resampled run counts range from {configuration['bootstrap']['possibleResampledRunCountRange'][0]} to {configuration['bootstrap']['possibleResampledRunCountRange'][1]}.",
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
            "- Repeated runs from an identical retained Git tree are kept together. A missing, extra, duplicated, malformed, hash-tampered, or locally contradictory head-to-tree mapping fails closed.",
            "- This invocation used retained job/step metadata and an authenticated head-to-tree map. Local Git objects were optional cross-checks. It made no GitHub workflow-run query and read no workflow logs.",
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
    parser.add_argument(
        "--head-tree-map",
        type=Path,
        default=script_path.parent / "retained-head-tree-map.json",
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
    head_tree_map_path = args.head_tree_map.resolve()
    output_dir = args.output_dir.resolve()
    script_path = Path(__file__).resolve()

    if args.bootstrap_resamples < 1_000:
        raise SensitivityError("--bootstrap-resamples must be at least 1000")
    if run_git(repository_root, ["rev-parse", "--is-inside-work-tree"]) != "true":
        raise SensitivityError(f"not a Git worktree: {repository_root}")

    expected_inputs = {
        successful_runs_path: EXPECTED_SUCCESSFUL_RUNS_SHA256,
        baseline_summary_path: EXPECTED_BASELINE_SUMMARY_SHA256,
        baseline_artifact_map_path: EXPECTED_BASELINE_ARTIFACT_MAP_SHA256,
        head_tree_map_path: EXPECTED_HEAD_TREE_MAP_SHA256,
    }
    for path, expected_hash in expected_inputs.items():
        verify_hash(path, expected_hash)

    if args.fetch_origin:
        fetch_origin_heads(repository_root)

    successful_payload = read_json(successful_runs_path)
    baseline_summary = read_json(baseline_summary_path)
    runs = successful_payload.get("runs")
    if not isinstance(runs, list) or not runs:
        raise SensitivityError("retained successful-runs.json contains no runs")

    observations = baseline_summary.get("runObservations")
    if not isinstance(observations, list) or not observations:
        raise SensitivityError("retained baseline summary contains no run observations")
    observations.sort(key=lambda item: int(item["runId"]))
    retained_by_run = {int(run["id"]): run for run in runs}
    if len(retained_by_run) != len(runs) or len(observations) != len(runs):
        raise SensitivityError("baseline and retained run counts differ")
    for observation in observations:
        retained_run = retained_by_run.get(int(observation["runId"]))
        if retained_run is None:
            raise SensitivityError(f"run absent from baseline: {observation['runId']}")
        for retained_key, observation_key in (
            ("headSha", "headSha"),
            ("event", "event"),
            ("createdAt", "createdAt"),
        ):
            if retained_run.get(retained_key) != observation.get(observation_key):
                raise SensitivityError(
                    f"baseline identity mismatch for run {observation['runId']}: {observation_key}"
                )
        for metric_name in METRICS:
            if not isinstance(observation.get(metric_name), (int, float)):
                raise SensitivityError(
                    f"baseline metric is missing for run {observation['runId']}: {metric_name}"
                )

    heads = sorted({str(item["headSha"]).lower() for item in observations})
    retained_head_trees = load_retained_head_tree_map(
        head_tree_map_path,
        EXPECTED_HEAD_TREE_MAP_SHA256,
        set(heads),
    )
    resolutions = [
        resolve_head(repository_root, head, retained_head_trees[head]) for head in heads
    ]
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
                "resolutionStatus": "retained_exact_tree",
                "runCount": len(group_observations),
                "runIds": sorted(int(item["runId"]) for item in group_observations),
                "treeSha": next(iter(tree_values)) if len(tree_values) == 1 else None,
            }
        )

    group_count = len(groups)
    group_sizes = [group["runCount"] for group in groups]
    locally_verified_count = sum(
        item["resolutionStatus"] == "retained_exact_tree_object_verified"
        for item in resolutions
    )
    local_object_absent_count = sum(
        item["resolutionStatus"] == "retained_exact_tree_object_absent"
        for item in resolutions
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
            "retainedHeadTreeMap": {
                "path": repository_relative(head_tree_map_path, repository_root),
                "sha256": sha256_file(head_tree_map_path),
            },
            "successfulRuns": {
                "path": repository_relative(successful_runs_path, repository_root),
                "sha256": sha256_file(successful_runs_path),
            },
        },
        "runCount": len(observations),
        "distinctHeadCount": len(heads),
        "sourceGroupCount": group_count,
        "locallyVerifiedHeadCount": locally_verified_count,
        "localObjectAbsentHeadCount": local_object_absent_count,
        "treeResolution": {
            "fetchPerformedByScript": bool(args.fetch_origin),
            "retainedRule": "require the authenticated exact head-to-tree map",
            "localCommand": "git rev-parse --verify <head>^{tree} when object is present",
            "localObjectAbsentRule": "replay the authenticated retained tree mapping",
            "mismatchRule": "fail closed",
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
                    stable_seed(
                        args.bootstrap_seed, f"source-group:{metric_name}:mean"
                    ),
                ),
                "median": cluster_bootstrap_interval(
                    metric_clusters,
                    statistics.median,
                    args.bootstrap_resamples,
                    stable_seed(
                        args.bootstrap_seed, f"source-group:{metric_name}:median"
                    ),
                ),
            },
            "sourceGroupObservedMeans": {
                group["groupKey"]: round(float(
                    statistics.fmean(
                        float(item[metric_name])
                        for item in grouped_observations[group["groupKey"]]
                    )
                ), 6)
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
            "Every commit requires an authenticated retained exact-tree mapping.",
            "Local object absence does not change grouping; any local contradiction fails closed.",
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
