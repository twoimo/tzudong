from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[3]
PROOF = json.loads((ROOT / "source-replay-validation.json").read_text(encoding="utf-8"))
EVIDENCE_FILES = (
    "collection.json",
    "excluded-observations.json",
    "report.md",
    "successful-runs.json",
    "summary.json",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replay(script: Path, output: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            str(script),
            "--input-dir",
            str(ROOT),
            "--output-dir",
            str(output),
        ],
        cwd=REPOSITORY,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


class SourceReplayTests(unittest.TestCase):
    def test_historical_and_current_sources_replay_retained_inputs(self) -> None:
        historical = (
            ROOT
            / "historical-collector-380c6e3f/.github/scripts/collect-ci-performance.py"
        )
        current = REPOSITORY / ".github/scripts/collect-ci-performance.py"
        current_test = REPOSITORY / ".github/scripts/test_collect_ci_performance.py"
        self.assertEqual(sha256(historical), PROOF["historicalSource"]["sha256"])
        self.assertEqual(sha256(current), PROOF["currentSource"]["sha256"])
        self.assertEqual(
            sha256(current_test), PROOF["currentSource"]["testSha256"]
        )

        with tempfile.TemporaryDirectory(prefix="tzudong-ci-source-replay-") as temp:
            temp_root = Path(temp)
            historical_output = temp_root / "historical"
            current_output = temp_root / "current"
            replay(historical, historical_output)
            replay(current, current_output)

            for name in EVIDENCE_FILES:
                expected = PROOF["replayedOutputs"][name]
                self.assertEqual(sha256(ROOT / name), expected)
                self.assertEqual(sha256(historical_output / name), expected)
                self.assertEqual(sha256(current_output / name), expected)

            for name in (*EVIDENCE_FILES, "artifact-map.json", "artifact-map.json.sha256"):
                self.assertEqual(
                    (historical_output / name).read_bytes(),
                    (ROOT / name).read_bytes(),
                )
            self.assertEqual(
                sha256(historical_output / "artifact-map.json"),
                PROOF["historicalSource"]["replayedArtifactMapSha256"],
            )
            self.assertEqual(
                (current_output / "artifact-map.json").read_bytes(),
                (ROOT / "artifact-map-current-source.json").read_bytes(),
            )
            self.assertEqual(
                sha256(current_output / "artifact-map.json"),
                PROOF["currentSource"]["replayedArtifactMapSha256"],
            )

    def test_offline_monitor_receipts_retain_authenticated_inputs(self) -> None:
        monitor_root = ROOT.parent / "ci-monitor-20261011"
        artifact_map_path = monitor_root / "artifact-map.json"
        artifact_map = json.loads(artifact_map_path.read_text(encoding="utf-8"))
        artifacts = {item["path"]: item for item in artifact_map["files"]}
        self.assertEqual(len(artifact_map["files"]), 76)
        self.assertEqual(
            artifact_map["currentSourceBinding"], "current_path_sha256_and_bytes"
        )
        self.assertEqual(artifact_map["formalPerformanceAdmittedSlices"], 0)
        self.assertEqual(
            (monitor_root / "artifact-map.json.sha256").read_text(encoding="utf-8"),
            f"{sha256(artifact_map_path)}  artifact-map.json\n",
        )
        for name in ("offline-replay", "final-offline-replay"):
            directory = monitor_root / name
            tick = json.loads((directory / "tick.json").read_text(encoding="utf-8"))
            self.assertEqual(sha256(directory / "export.json"), tick["exportSha256"])
            self.assertEqual(sha256(directory / "analysis.json"), tick["analysisSha256"])
            for filename in ("analysis.json", "export.json", "tick.json"):
                path = directory / filename
                relative = path.relative_to(REPOSITORY).as_posix()
                self.assertEqual(artifacts[relative]["sha256"], sha256(path))
                self.assertEqual(artifacts[relative]["bytes"], path.stat().st_size)
        for relative, item in artifacts.items():
            path = REPOSITORY / relative
            self.assertTrue(path.is_file(), relative)
            self.assertEqual(item["sha256"], sha256(path), relative)
            self.assertEqual(item["bytes"], path.stat().st_size, relative)


if __name__ == "__main__":
    unittest.main()
