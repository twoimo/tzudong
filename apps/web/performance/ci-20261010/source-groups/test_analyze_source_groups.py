from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("analyze-source-groups.py")
SPEC = importlib.util.spec_from_file_location("analyze_source_groups", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot import source-group analyzer")
ANALYZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANALYZER)


class SourceGroupReproducibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.evidence_root = SCRIPT.parent.parent
        self.repository_root = SCRIPT.parents[5]
        payload = json.loads(
            (self.evidence_root / "successful-runs.json").read_text(encoding="utf-8")
        )
        self.expected_heads = {
            str(run["headSha"]).lower() for run in payload["runs"]
        }

    def test_objectless_checkout_replays_same_three_groups(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-source-groups-test-") as root:
            isolated = Path(root)
            subprocess.run(
                ["git", "init", "-q", str(isolated)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            output = isolated / "output"
            exit_code = ANALYZER.main(
                [
                    "--repository-root",
                    str(isolated),
                    "--successful-runs",
                    str(self.evidence_root / "successful-runs.json"),
                    "--baseline-summary",
                    str(self.evidence_root / "summary.json"),
                    "--baseline-artifact-map",
                    str(self.evidence_root / "artifact-map.json"),
                    "--head-tree-map",
                    str(SCRIPT.parent / "retained-head-tree-map.json"),
                    "--output-dir",
                    str(output),
                ]
            )
            self.assertEqual(exit_code, 0)
            groups = json.loads(
                (output / "source-groups.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(groups["groups"]), 3)
            self.assertEqual(
                sorted(group["runCount"] for group in groups["groups"]),
                [1, 2, 6],
            )
            self.assertEqual(
                {item["resolutionStatus"] for item in groups["resolutions"]},
                {"retained_exact_tree_object_absent"},
            )
            reproduced_summary = json.loads(
                (output / "summary.json").read_text(encoding="utf-8")
            )
            retained_summary = json.loads(
                (SCRIPT.parent / "summary.json").read_text(encoding="utf-8")
            )
            retained_groups = json.loads(
                (SCRIPT.parent / "source-groups.json").read_text(encoding="utf-8")
            )
            self.assertEqual(groups["groups"], retained_groups["groups"])
            mapping_key = lambda item: (
                item["headSha"],
                item["treeSha"],
                item["groupKey"],
            )
            self.assertEqual(
                sorted(map(mapping_key, groups["resolutions"])),
                sorted(map(mapping_key, retained_groups["resolutions"])),
            )
            self.assertEqual(reproduced_summary, retained_summary)
            critical_path = reproduced_summary["metrics"]["criticalPathSeconds"][
                "sourceGroupClusterBootstrap95PercentileIntervals"
            ]
            object_count = int(
                dict(
                    line.split(": ", 1)
                    for line in subprocess.check_output(
                        ["git", "-C", str(isolated), "count-objects", "-v"],
                        text=True,
                    ).splitlines()
                )["count"]
            )
            receipt = {
                "criticalPathMean95Ci": critical_path["mean"],
                "criticalPathMedian95Ci": critical_path["median"],
                "groupPayloadExact": True,
                "groupRunCounts": [group["runCount"] for group in groups["groups"]],
                "objectlessGitObjectCount": object_count,
                "objectlessResolutionStatuses": sorted(
                    {item["resolutionStatus"] for item in groups["resolutions"]}
                ),
                "resolutionHeadTreeMappingExact": True,
                "summaryExact": True,
                "workspaceResolutionStatuses": sorted(
                    {
                        item["resolutionStatus"]
                        for item in retained_groups["resolutions"]
                    }
                ),
            }
            self.assertEqual(
                receipt,
                json.loads(
                    (SCRIPT.parent / "objectless-verification.json").read_text(
                        encoding="utf-8"
                    )
                ),
            )

    def test_mapping_count_or_head_set_mismatch_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            ANALYZER.SensitivityError,
            "mapping count/set mismatch",
        ):
            ANALYZER.load_retained_head_tree_map(
                SCRIPT.parent / "retained-head-tree-map.json",
                ANALYZER.EXPECTED_HEAD_TREE_MAP_SHA256,
                set(sorted(self.expected_heads)[:-1]),
            )

    def test_mapping_hash_tamper_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-source-map-tamper-") as root:
            tampered = Path(root) / "retained-head-tree-map.json"
            payload = json.loads(
                (SCRIPT.parent / "retained-head-tree-map.json").read_text(
                    encoding="utf-8"
                )
            )
            payload["mappings"][0]["treeSha"] = "0" * 40
            tampered.write_text(
                json.dumps(payload, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ANALYZER.SensitivityError, "hash mismatch"):
                ANALYZER.load_retained_head_tree_map(
                    tampered,
                    ANALYZER.EXPECTED_HEAD_TREE_MAP_SHA256,
                    self.expected_heads,
                )

    def test_local_git_mapping_contradiction_fails_closed(self) -> None:
        head = sorted(self.expected_heads)[0]
        if ANALYZER.run_git(self.repository_root, ["cat-file", "-t", head]) is None:
            self.skipTest("retained head object is absent in this checkout")
        with self.assertRaisesRegex(
            ANALYZER.SensitivityError,
            "disagrees with local Git object",
        ):
            ANALYZER.resolve_head(self.repository_root, head, "0" * 40)


if __name__ == "__main__":
    unittest.main()
