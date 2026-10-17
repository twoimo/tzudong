from __future__ import annotations

import importlib.util
import hashlib
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("benchmark.py")
SPEC = importlib.util.spec_from_file_location("local_compiler_benchmark", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot import local compiler benchmark")
BENCHMARK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCHMARK)


class CleanSourceAdmissionTests(unittest.TestCase):
    def test_compiler_provenance_requires_every_executed_implementation_role(self) -> None:
        provenance = {
            role: f"compiler/{role}"
            for role in BENCHMARK.COMPILER_PROVENANCE_ROLES
        }
        dependency_hashes = {
            path: hashlib.sha256(path.encode("utf-8")).hexdigest()
            for path in provenance.values()
        }
        validated = BENCHMARK.validate_compiler_provenance_contract(
            {"compilerProvenance": provenance}, dependency_hashes
        )
        self.assertEqual(set(validated), BENCHMARK.COMPILER_PROVENANCE_ROLES)
        for role, path in provenance.items():
            self.assertEqual(
                validated[role],
                {"path": path, "sha256": dependency_hashes[path]},
            )

        for role in sorted(BENCHMARK.COMPILER_PROVENANCE_ROLES):
            with self.subTest(missing_role=role):
                incomplete = dict(provenance)
                incomplete.pop(role)
                with self.assertRaisesRegex(
                    RuntimeError, "compiler provenance roles are incomplete"
                ):
                    BENCHMARK.validate_compiler_provenance_contract(
                        {"compilerProvenance": incomplete}, dependency_hashes
                    )

        with self.assertRaisesRegex(
            RuntimeError, "compiler provenance hash is missing"
        ):
            BENCHMARK.validate_compiler_provenance_contract(
                {"compilerProvenance": provenance}, {}
            )

    def make_repository(self, root: Path) -> Path:
        repository = root / "repository"
        source = repository / "apps/web"
        source.mkdir(parents=True)
        (source / "fixture.ts").write_text("export const value = 1;\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(repository)], check=True)
        subprocess.run(["git", "-C", str(repository), "add", "apps/web/fixture.ts"], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(repository),
                "-c",
                "user.name=CI Evidence Test",
                "-c",
                "user.email=ci-evidence@example.invalid",
                "commit",
                "-qm",
                "fixture",
            ],
            check=True,
        )
        return repository

    def test_clean_source_is_bound_to_exact_head_and_tree(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-clean-") as root:
            repository = self.make_repository(Path(root))
            head, tree = BENCHMARK.require_clean_measured_source(repository)
            self.assertEqual(len(head), 40)
            self.assertEqual(len(tree), 40)
            self.assertEqual(
                tree,
                subprocess.check_output(
                    ["git", "-C", str(repository), "rev-parse", "HEAD:apps/web"],
                    text=True,
                ).strip(),
            )

    def test_dirty_tracked_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-dirty-") as root:
            repository = self.make_repository(Path(root))
            (repository / "apps/web/fixture.ts").write_text(
                "export const value = 2;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "source is dirty"):
                BENCHMARK.require_clean_measured_source(repository)

    def test_dirty_untracked_source_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-untracked-") as root:
            repository = self.make_repository(Path(root))
            (repository / "apps/web/untracked.ts").write_text(
                "export const extra = true;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "source is dirty"):
                BENCHMARK.require_clean_measured_source(repository)

    def test_tracked_snapshot_content_tamper_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-snapshot-") as root:
            repository = self.make_repository(Path(root))
            snapshot = Path(root) / "snapshot"
            shutil.copytree(repository / "apps/web", snapshot)
            contract = BENCHMARK.verify_tracked_snapshot(repository, snapshot)
            self.assertEqual(contract["trackedBlobCount"], 1)
            (snapshot / "fixture.ts").write_text(
                "export const value = 3;\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "content mismatch"):
                BENCHMARK.verify_tracked_snapshot(repository, snapshot)

    def test_ignored_generated_inputs_are_pruned_before_measurement(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-ignored-") as root:
            repository = self.make_repository(Path(root))
            (repository / ".gitignore").write_text(
                "apps/web/.next/\n", encoding="utf-8"
            )
            subprocess.run(
                ["git", "-C", str(repository), "add", ".gitignore"], check=True
            )
            subprocess.run(
                [
                    "git", "-C", str(repository), "-c",
                    "user.name=CI Evidence Test", "-c",
                    "user.email=ci-evidence@example.invalid", "commit", "-qm",
                    "ignore generated compiler input",
                ],
                check=True,
            )
            generated = repository / "apps/web/.next/types/generated.d.ts"
            generated.parent.mkdir(parents=True)
            generated.write_text("declare const generated: true;\n", encoding="utf-8")
            snapshot = Path(root) / "snapshot"
            shutil.copytree(repository / "apps/web", snapshot)

            pruning = BENCHMARK.prune_snapshot_to_tracked_inputs(
                repository, snapshot
            )

            self.assertFalse((snapshot / ".next").exists())
            self.assertEqual(pruning["excludedInputEntryCount"], 1)
            contract = BENCHMARK.verify_tracked_snapshot(repository, snapshot)
            self.assertEqual(contract["untrackedOrIgnoredAppInputs"], [])

    def test_snapshot_rejects_input_created_after_pruning(self) -> None:
        with tempfile.TemporaryDirectory(prefix="tzudong-compiler-extra-") as root:
            repository = self.make_repository(Path(root))
            snapshot = Path(root) / "snapshot"
            shutil.copytree(repository / "apps/web", snapshot)
            BENCHMARK.prune_snapshot_to_tracked_inputs(repository, snapshot)
            extra = snapshot / ".next/types/generated.d.ts"
            extra.parent.mkdir(parents=True)
            extra.write_text("declare const generated: true;\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "untracked input"):
                BENCHMARK.verify_tracked_snapshot(repository, snapshot)

    @staticmethod
    def sequence(name: str, duration_ms: float) -> dict[str, object]:
        return {
            "sequence": name,
            "durationMs": duration_ms,
            "success": True,
            "cpuSeconds": duration_ms / 2000,
            "maximumResidentSetBytes": 100_000_000,
            "commands": [
                {
                    "command": command,
                    "durationMs": duration_ms / len(BENCHMARK.SEQUENCES[name]),
                }
                for command in BENCHMARK.SEQUENCES[name]
            ],
        }

    def synthetic_raw(self, aa_difference_ms: float) -> dict[str, object]:
        measured = []
        aa_pairs = []
        for index in range(7):
            measured.append(
                {
                    "runs": [
                        self.sequence("before", 10_000 + index),
                        self.sequence("after", 5_000 + index),
                    ]
                }
            )
            signed = aa_difference_ms if index % 2 == 0 else -aa_difference_ms
            aa_pairs.append(
                {
                    "runs": [
                        self.sequence("aa_a", 5_000 + signed / 2),
                        self.sequence("aa_b", 5_000 - signed / 2),
                    ]
                }
            )
        return {
            "metadata": {
                "sourceContractUnchanged": True,
                "experimentConfig": {
                    "pairs": 7,
                    "aaPairs": 7,
                    "acceptanceBudgets": {
                        "absoluteMeanReductionBootstrap95CiLowerBoundMs": 2_000,
                        "relativeMeanReductionBootstrap95CiLowerBoundPercent": 5,
                        "noiseAaP95AbsoluteRelativeDifferencePercentMaximum": 5,
                        "noiseAaMeanDifference95CiMustIncludeZero": True,
                    },
                },
            },
            "measuredPairs": measured,
            "aaPairs": aa_pairs,
        }

    def test_analysis_admits_only_when_reduction_and_noise_budgets_pass(self) -> None:
        summary = BENCHMARK.analyze(self.synthetic_raw(10))
        self.assertTrue(summary["evidenceAdmission"]["admitted"])
        self.assertTrue(all(summary["evidenceAdmission"]["budgetChecks"].values()))

    def test_analysis_rejects_excessive_aa_noise(self) -> None:
        summary = BENCHMARK.analyze(self.synthetic_raw(2_000))
        self.assertFalse(summary["evidenceAdmission"]["admitted"])
        self.assertFalse(summary["evidenceAdmission"]["budgetChecks"]["noiseP95"])

    def test_analysis_rejects_non_finite_negative_and_boolean_numeric_budgets(self) -> None:
        numeric_budgets = (
            "absoluteMeanReductionBootstrap95CiLowerBoundMs",
            "relativeMeanReductionBootstrap95CiLowerBoundPercent",
            "noiseAaP95AbsoluteRelativeDifferencePercentMaximum",
        )
        malformed_values = (True, -0.01, math.nan, math.inf, -math.inf, 10**1000)
        for budget in numeric_budgets:
            for value in malformed_values:
                with self.subTest(budget=budget, value=value):
                    raw = self.synthetic_raw(10)
                    raw["metadata"]["experimentConfig"]["acceptanceBudgets"][
                        budget
                    ] = value
                    with self.assertRaisesRegex(
                        RuntimeError, f"acceptance budget is malformed: {budget}"
                    ):
                        BENCHMARK.analyze(raw)


if __name__ == "__main__":
    unittest.main()
