#!/usr/bin/env python3
"""Publish a path-redacted counterpart of private compiler evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


PLACEHOLDER = "<shared-node-modules-root>"
CONFIG_REDACTIONS = ["/expectedNodeModulesTarget"]
RAW_REDACTIONS = [
    "/metadata/experimentConfig/expectedNodeModulesTarget",
    "/metadata/nodeModulesTarget",
]


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_canonical(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def replace_pointer(document: dict[str, Any], pointer: str) -> None:
    parts = pointer.removeprefix("/").split("/")
    current: Any = document
    for part in parts[:-1]:
        if not isinstance(current, dict) or part not in current:
            raise RuntimeError(f"missing redaction pointer: {pointer}")
        current = current[part]
    leaf = parts[-1]
    if not isinstance(current, dict) or not isinstance(current.get(leaf), str):
        raise RuntimeError(f"invalid redaction pointer: {pointer}")
    if not current[leaf].startswith("/Users/"):
        raise RuntimeError(f"redaction pointer does not contain a private path: {pointer}")
    current[leaf] = PLACEHOLDER


def private_path_pointers(value: Any, pointer: str = "") -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            paths.extend(private_path_pointers(item, f"{pointer}/{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            paths.extend(private_path_pointers(item, f"{pointer}/{index}"))
    elif isinstance(value, str) and "/Users/" in value:
        paths.append(pointer)
    return paths


def sanitize(document: dict[str, Any], pointers: list[str]) -> dict[str, Any]:
    result = json.loads(json.dumps(document))
    observed = sorted(private_path_pointers(result))
    if observed != sorted(pointers):
        raise RuntimeError(
            f"private path inventory differs from the declared redactions: {observed}"
        )
    for pointer in pointers:
        replace_pointer(result, pointer)
    if private_path_pointers(result):
        raise RuntimeError("sanitized document still contains a private path")
    return result


def render_public_report(private_report: str, summary: dict[str, Any]) -> str:
    before_mean = summary["sequenceDurationMs"]["before"]["mean"]
    after_mean = summary["sequenceDurationMs"]["after"]["mean"]
    paired_relative_mean = summary["pairedReduction"]["relativePercent"]["mean"]
    aggregate_mean_ratio = 100 * (1 - after_mean / before_mean)
    marker = (
        "Mean paired absolute reduction bootstrap 95% CI: "
        f"{summary['pairedReduction']['absoluteMs']['meanBootstrap95Ci'][0]:.2f}–"
        f"{summary['pairedReduction']['absoluteMs']['meanBootstrap95Ci'][1]:.2f} ms. "
        "Mean paired relative reduction bootstrap 95% CI: "
        f"{summary['pairedReduction']['relativePercent']['meanBootstrap95Ci'][0]:.2f}–"
        f"{summary['pairedReduction']['relativePercent']['meanBootstrap95Ci'][1]:.2f}%."
    )
    if private_report.count(marker) != 1:
        raise RuntimeError("cannot locate the frozen statistical interpretation marker")
    clarification = (
        f"\n\nThe ratio of aggregate means, `1 - {after_mean:.2f}/{before_mean:.2f}`, "
        f"is {aggregate_mean_ratio:.2f}%. The {paired_relative_mean:.2f}% value above is "
        "the mean of the seven within-pair relative reductions. These are different "
        "estimators; neither is admitted because the predeclared A/A noise budget failed."
    )
    return private_report.replace(marker, marker + clarification)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-results", type=Path, required=True)
    parser.add_argument("--private-failed-raw", type=Path, required=True)
    parser.add_argument("--public-dir", type=Path, required=True)
    parser.add_argument("--replace-generated", action="store_true")
    args = parser.parse_args()
    private_results = args.private_results.resolve(strict=True)
    failed_raw_path = args.private_failed_raw.resolve(strict=True)
    public_dir = args.public_dir.resolve(strict=True)
    private_config_path = private_results / "configuration.json"
    private_raw_path = private_results / "raw.json"
    private_summary_path = private_results / "summary.json"
    private_report_path = private_results / "report.md"
    public_config_path = public_dir / "configuration.json"
    public_raw_path = public_dir / "raw.json"
    public_summary_path = public_dir / "summary.json"
    public_report_path = public_dir / "report.md"
    receipt_path = public_dir / "sanitization-receipt.json"
    failed_receipt_path = public_dir / "failed-v1-receipt.json"
    for path in (
        public_raw_path,
        public_summary_path,
        public_report_path,
        receipt_path,
        failed_receipt_path,
    ):
        if path.exists() and not args.replace_generated:
            raise RuntimeError(f"refusing to overwrite public evidence: {path.name}")
    private_config = json.loads(private_config_path.read_text(encoding="utf-8"))
    private_raw = json.loads(private_raw_path.read_text(encoding="utf-8"))
    private_summary = json.loads(private_summary_path.read_text(encoding="utf-8"))
    public_config = json.loads(public_config_path.read_text(encoding="utf-8"))
    sanitized_config = sanitize(private_config, CONFIG_REDACTIONS)
    sanitized_raw = sanitize(private_raw, RAW_REDACTIONS)
    public_report = render_public_report(
        private_report_path.read_text(encoding="utf-8"), private_summary
    )
    if public_config != sanitized_config:
        raise RuntimeError("public pre-measurement configuration is not the exact redacted counterpart")
    for path in (private_summary_path, private_report_path):
        if b"/Users/" in path.read_bytes():
            raise RuntimeError(f"private path found in unchanged public artifact: {path.name}")
    if args.replace_generated:
        if public_raw_path.exists() and json.loads(
            public_raw_path.read_text(encoding="utf-8")
        ) != sanitized_raw:
            raise RuntimeError("existing generated raw evidence differs")
        for private_path, public_path in (
            (private_summary_path, public_summary_path),
        ):
            if public_path.exists() and public_path.read_bytes() != private_path.read_bytes():
                raise RuntimeError(f"existing generated artifact differs: {public_path.name}")
        if public_report_path.exists() and public_report_path.read_text(
            encoding="utf-8"
        ) not in (private_report_path.read_text(encoding="utf-8"), public_report):
            raise RuntimeError("existing generated report differs")
        for path, schema in (
            (receipt_path, "tzudong-ci-performance/v1/path-sanitization-receipt"),
            (failed_receipt_path, "tzudong-ci-performance/v1/failed-experiment-receipt"),
        ):
            if path.exists() and json.loads(path.read_text(encoding="utf-8")).get(
                "schema"
            ) != schema:
                raise RuntimeError(f"existing generated receipt differs: {path.name}")
    public_raw_path.write_text(canonical_json(sanitized_raw), encoding="utf-8")
    shutil.copyfile(private_summary_path, public_summary_path)
    public_report_path.write_text(public_report, encoding="utf-8")
    failed_raw = json.loads(failed_raw_path.read_text(encoding="utf-8"))
    failed_sequences = [
        sequence
        for group in ("warmups", "measuredPairs", "aaPairs")
        for pair in failed_raw.get(group, [])
        for sequence in pair.get("runs", [])
    ]
    failed_codes = sorted(
        {
            preview
            for sequence in failed_sequences
            for command in sequence.get("commands", [])
            for preview in [command.get("stderrPreview", "")]
            if preview
        }
    )
    failed_receipt = {
        "schema": "tzudong-ci-performance/v1/failed-experiment-receipt",
        "privateRawSha256": sha256_file(failed_raw_path),
        "statusAtTermination": failed_raw.get("status"),
        "gitHead": failed_raw.get("metadata", {}).get("gitHead"),
        "sourceTreeSha": failed_raw.get("metadata", {}).get("sourceTreeSha"),
        "warmupsRecorded": len(failed_raw.get("warmups", [])),
        "measuredPairsRecorded": len(failed_raw.get("measuredPairs", [])),
        "aaPairsRecorded": len(failed_raw.get("aaPairs", [])),
        "sequencesRecorded": len(failed_sequences),
        "successfulSequences": sum(
            sequence.get("success") is True for sequence in failed_sequences
        ),
        "failureCodes": failed_codes,
        "admitted": False,
        "reason": "The source node_modules symlink caused toolchain receipt path validation to fail; the incomplete raw evidence is retained privately and was never reused.",
    }
    failed_receipt_path.write_text(canonical_json(failed_receipt), encoding="utf-8")
    receipt = {
        "schema": "tzudong-ci-performance/v1/path-sanitization-receipt",
        "placeholder": PLACEHOLDER,
        "redactedJsonPointers": {
            "configuration.json": CONFIG_REDACTIONS,
            "raw.json": RAW_REDACTIONS,
        },
        "hashes": {
            "privateConfigurationSha256": sha256_file(private_config_path),
            "publicConfigurationSha256": sha256_file(public_config_path),
            "privateRawSha256": sha256_file(private_raw_path),
            "publicRawSha256": sha256_file(public_raw_path),
            "privateSummarySha256": sha256_file(private_summary_path),
            "publicSummarySha256": sha256_file(public_summary_path),
            "privateReportSha256": sha256_file(private_report_path),
            "publicReportSha256": sha256_file(public_report_path),
            "sanitizerScriptSha256": sha256_file(Path(__file__).resolve()),
        },
        "canonicalProof": {
            "sanitizedPrivateConfigurationSha256": sha256_canonical(sanitized_config),
            "publicConfigurationCanonicalSha256": sha256_canonical(public_config),
            "sanitizedPrivateRawSha256": sha256_canonical(sanitized_raw),
            "publicRawCanonicalSha256": sha256_file(public_raw_path),
            "summaryBytesUnchanged": sha256_file(private_summary_path)
            == sha256_file(public_summary_path),
            "reportBytesUnchanged": False,
            "reportEditorialClarificationOnly": True,
            "privatePathsRemainingInPublicEvidence": 0,
        },
        "preservedFields": [
            "source and dependency content hashes",
            "Git head and apps/web tree hash",
            "predeclared budgets and bootstrap settings",
            "all measured timings, CPU, RSS, statuses, and output hashes",
        ],
        "editorialTransforms": {
            "report.md": [
                "added the aggregate-means reduction estimator",
                "distinguished it from the mean within-pair relative reduction",
                "repeated that neither estimator is admitted after the A/A noise failure",
            ]
        },
        "privateOriginalsRetained": True,
    }
    receipt_path.write_text(canonical_json(receipt), encoding="utf-8")
    evidence_paths = (
        public_config_path,
        public_raw_path,
        public_summary_path,
        public_report_path,
        receipt_path,
        failed_receipt_path,
        public_dir / "input-manifest.json",
    )
    for path in evidence_paths:
        if path.is_file() and b"/Users/" in path.read_bytes():
            raise RuntimeError(f"private path remains in public evidence: {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
