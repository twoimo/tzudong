"""Tests for the crawler-orchestration readiness audit."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from backend.pipeline_control.readiness import (
    BLOCKER_ARTIFACT_MISSING,
    BLOCKER_DEPENDENCY_MISSING,
    BLOCKER_SPEC_INCOMPLETE,
    BLOCKER_SPEC_INVALID,
    BLOCKER_SPEC_MISSING,
    BLOCKER_TESTS_FAILED,
    BLOCKER_TEST_TIMEOUT,
    BLOCKER_TRACEABILITY_INVALID,
    BLOCKER_TRACEABILITY_MISSING,
    DEFAULT_TEST_MODULES,
    MAX_REPORTED_ITEMS,
    MAX_REPORTED_LABEL_LENGTH,
    REPORT_STATUS_BLOCKED,
    REPORT_STATUS_READY,
    TEST_STATUS_FAILED,
    TEST_STATUS_PASSED,
    TEST_STATUS_TIMED_OUT,
    attach_test_execution,
    build_readiness_report,
    inspect_artifacts,
    inspect_source_revision,
    inspect_task_document,
    inspect_traceability,
    run_test_plan,
)


def _present(_name: str) -> object:
    return object()


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _traceability_entry(task_id: str) -> dict[str, object]:
    return {
        "taskId": task_id,
        "evidenceClasses": ["source"],
        "implementationPaths": ["implementation.py"],
        "verificationModules": ["backend.example.test_case"],
        "externalEvidenceTypes": [],
    }


def _write_traceability_fixture(
    root: Path,
    entries: list[dict[str, object]],
    *,
    task_text: str = "- [x] 1. done\n",
) -> tuple[Path, Path, Path]:
    spec_path = Path("spec/tasks.md")
    schema_path = Path("spec/traceability.schema.json")
    map_path = Path("spec/traceability.map.json")
    (root / spec_path).parent.mkdir(parents=True)
    (root / spec_path).write_text(task_text, encoding="utf-8")
    schema = json.loads(
        (
            REPOSITORY_ROOT
            / ".kiro/specs/crawler-pipeline-orchestration/traceability.schema.json"
        ).read_text(encoding="utf-8")
    )
    (root / schema_path).write_text(json.dumps(schema), encoding="utf-8")
    document = {
        "schemaVersion": 1,
        "specPath": spec_path.as_posix(),
        "entries": entries,
    }
    (root / map_path).write_text(json.dumps(document), encoding="utf-8")
    (root / "implementation.py").write_text("# mapped\n", encoding="utf-8")
    module_path = root / "backend/example/test_case.py"
    module_path.parent.mkdir(parents=True)
    module_path.write_text("# mapped\n", encoding="utf-8")
    return spec_path, schema_path, map_path


class TaskDocumentTest(unittest.TestCase):
    def test_counts_required_and_optional_tasks(self) -> None:
        report = inspect_task_document(
            "\n".join(
                [
                    "- [x] 1. complete",
                    "  - [ ] 1.1 open",
                    "  - [x]* 1.2 optional complete",
                    "  - [ ]* 1.3 optional open",
                    "  - [ ]! 1.4 externally gated",
                ]
            )
        )
        self.assertTrue(report["valid"])
        self.assertEqual(report["totalCount"], 5)
        self.assertEqual(report["completedCount"], 2)
        self.assertEqual(report["openCount"], 3)
        self.assertEqual(report["optionalCount"], 2)
        self.assertEqual(report["optionalOpenCount"], 1)
        self.assertEqual(report["externallyGatedCount"], 1)
        self.assertEqual(report["externallyGatedOpenCount"], 1)
        self.assertEqual(
            report["openTasks"],
            ["1.1 open", "1.3 optional open", "1.4 externally gated"],
        )

    def test_empty_document_is_invalid(self) -> None:
        report = inspect_task_document("# no task markers\n")
        self.assertFalse(report["valid"])
        self.assertEqual(report["totalCount"], 0)

    def test_open_task_list_and_labels_are_bounded(self) -> None:
        long_label = "x" * (MAX_REPORTED_LABEL_LENGTH + 40)
        text = "\n".join(
            f"- [ ] {index}. {long_label}" for index in range(MAX_REPORTED_ITEMS + 10)
        )
        report = inspect_task_document(text)
        self.assertEqual(report["openCount"], MAX_REPORTED_ITEMS + 10)
        self.assertEqual(len(report["openTasks"]), MAX_REPORTED_ITEMS)
        self.assertTrue(
            all(
                len(label) <= MAX_REPORTED_LABEL_LENGTH
                for label in report["openTasks"]
            )
        )


class TraceabilityTest(unittest.TestCase):
    def test_canonical_map_covers_every_task_artifact_and_test_module(self) -> None:
        report = inspect_traceability(REPOSITORY_ROOT)
        self.assertTrue(report["present"])
        self.assertTrue(report["valid"])
        self.assertTrue(report["complete"])
        self.assertEqual(report["taskCount"], 71)
        self.assertEqual(report["mappedTaskCount"], 71)
        self.assertEqual(report["unmappedTaskIds"], [])
        self.assertEqual(report["unknownTaskIds"], [])
        self.assertEqual(report["unmappedRequiredArtifacts"], [])
        self.assertEqual(report["unmappedTestModules"], [])
        self.assertRegex(
            report["traceabilitySha256"], re.compile(r"^[0-9a-f]{64}$")
        )

    def test_missing_and_unknown_task_ids_are_incomplete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(
                root,
                [_traceability_entry("1"), _traceability_entry("3")],
                task_text="- [x] 1. done\n- [x] 2. also done\n",
            )
            report = inspect_traceability(
                root,
                spec_path=spec,
                schema_path=schema,
                map_path=mapping,
                required_artifacts=(Path("implementation.py"),),
                test_modules=("backend.example.test_case",),
            )
        self.assertTrue(report["valid"])
        self.assertFalse(report["complete"])
        self.assertEqual(report["unmappedTaskIds"], ["2"])
        self.assertEqual(report["unknownTaskIds"], ["3"])

    def test_duplicate_task_id_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(
                root, [_traceability_entry("1"), _traceability_entry("1")]
            )
            report = inspect_traceability(
                root,
                spec_path=spec,
                schema_path=schema,
                map_path=mapping,
                required_artifacts=(Path("implementation.py"),),
                test_modules=("backend.example.test_case",),
            )
        self.assertFalse(report["valid"])
        self.assertEqual(report["duplicateTaskIds"], ["1"])
        self.assertIn("duplicate_task_id", report["validationCodes"])

    def test_invalid_closed_vocabulary_and_unsafe_references_fail_closed(self) -> None:
        entry = _traceability_entry("1")
        entry["evidenceClasses"] = ["invented"]
        entry["implementationPaths"] = ["../outside.py"]
        entry["verificationModules"] = ["outside.module"]
        entry["externalEvidenceTypes"] = ["self_attested_receipt"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(root, [entry])
            report = inspect_traceability(
                root,
                spec_path=spec,
                schema_path=schema,
                map_path=mapping,
                required_artifacts=(),
                test_modules=(),
            )
        self.assertFalse(report["valid"])
        self.assertEqual(
            set(report["validationCodes"]),
            {
                "evidence_class_invalid",
                "external_evidence_type_invalid",
                "implementation_path_invalid",
                "verification_module_invalid",
            },
        )

    def test_missing_mapped_files_and_modules_are_orphans(self) -> None:
        entry = _traceability_entry("1")
        entry["implementationPaths"] = ["missing.py"]
        entry["verificationModules"] = ["backend.missing.test_case"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(root, [entry])
            report = inspect_traceability(
                root,
                spec_path=spec,
                schema_path=schema,
                map_path=mapping,
                required_artifacts=(Path("missing.py"),),
                test_modules=("backend.missing.test_case",),
            )
        self.assertTrue(report["valid"])
        self.assertFalse(report["complete"])
        self.assertEqual(report["missingImplementationPaths"], ["missing.py"])
        self.assertEqual(
            report["missingVerificationModules"], ["backend.missing.test_case"]
        )

    def test_malformed_schema_is_invalid_without_raw_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(
                root, [_traceability_entry("1")]
            )
            (root / schema).write_text('{"type":"array"}', encoding="utf-8")
            report = inspect_traceability(
                root,
                spec_path=spec,
                schema_path=schema,
                map_path=mapping,
                required_artifacts=(Path("implementation.py"),),
                test_modules=("backend.example.test_case",),
            )
        self.assertFalse(report["valid"])
        self.assertEqual(report["validationCodes"], ["schema_document_invalid"])
        self.assertNotIn("traceback", json.dumps(report).lower())

    def test_absent_traceability_files_use_only_missing_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("tasks.md")
            (root / spec).write_text("- [x] 1. done\n", encoding="utf-8")
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(),
                dependencies={},
                traceability_schema_path=Path("missing-schema.json"),
                traceability_map_path=Path("missing-map.json"),
                test_modules=(),
            )
        self.assertEqual(report["blockerCodes"], [BLOCKER_TRACEABILITY_MISSING])

    def test_present_invalid_traceability_uses_invalid_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec, schema, mapping = _write_traceability_fixture(
                root, [_traceability_entry("1")]
            )
            (root / mapping).write_text("not-json", encoding="utf-8")
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(),
                dependencies={},
                traceability_schema_path=schema,
                traceability_map_path=mapping,
                test_modules=(),
            )
        self.assertEqual(report["blockerCodes"], [BLOCKER_TRACEABILITY_INVALID])


class StaticReadinessTest(unittest.TestCase):
    def test_ready_when_spec_artifacts_and_dependencies_are_complete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("spec/tasks.md")
            artifact = Path("implementation.py")
            (root / spec).parent.mkdir(parents=True)
            (root / spec).write_text("- [x] 1. done\n", encoding="utf-8")
            (root / artifact).write_text("# present\n", encoding="utf-8")

            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(artifact,),
                dependencies={"dependency": "Dependency"},
                traceability_schema_path=None,
                traceability_map_path=None,
                find_spec=_present,
                now=datetime(2026, 9, 3, tzinfo=timezone.utc),
            )

        self.assertEqual(report["status"], REPORT_STATUS_READY)
        self.assertEqual(report["blockerCodes"], [])
        self.assertEqual(report["generatedAt"], "2026-09-03T00:00:00Z")

    def test_missing_spec_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report = build_readiness_report(
                Path(directory),
                spec_path=Path("missing.md"),
                required_artifacts=(),
                dependencies={},
                traceability_schema_path=None,
                traceability_map_path=None,
            )
        self.assertEqual(report["status"], REPORT_STATUS_BLOCKED)
        self.assertEqual(report["blockerCodes"], [BLOCKER_SPEC_MISSING])

    def test_invalid_spec_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("tasks.md")
            (root / spec).write_text("# no tasks\n", encoding="utf-8")
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(),
                dependencies={},
                traceability_schema_path=None,
                traceability_map_path=None,
            )
        self.assertEqual(report["blockerCodes"], [BLOCKER_SPEC_INVALID])

    def test_open_tasks_missing_artifacts_and_dependencies_are_all_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("tasks.md")
            (root / spec).write_text("- [ ] 1. still open\n", encoding="utf-8")
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(Path("missing.py"),),
                dependencies={"missing_import": "MissingPackage"},
                traceability_schema_path=None,
                traceability_map_path=None,
                find_spec=lambda _name: None,
            )
        self.assertEqual(
            report["blockerCodes"],
            sorted(
                [
                    BLOCKER_SPEC_INCOMPLETE,
                    BLOCKER_ARTIFACT_MISSING,
                    BLOCKER_DEPENDENCY_MISSING,
                ]
            ),
        )
        self.assertEqual(report["spec"]["openTasks"], ["1. still open"])
        self.assertEqual(report["artifacts"]["missing"], ["missing.py"])
        self.assertEqual(report["dependencies"]["missing"], ["MissingPackage"])

    def test_dependency_probe_exception_fails_closed(self) -> None:
        def raising_probe(_name: str) -> None:
            raise ImportError("bounded by readiness report")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("tasks.md")
            (root / spec).write_text("- [x] 1. done\n", encoding="utf-8")
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(),
                dependencies={"unavailable": "UnavailablePackage"},
                traceability_schema_path=None,
                traceability_map_path=None,
                find_spec=raising_probe,
            )
        self.assertEqual(report["blockerCodes"], [BLOCKER_DEPENDENCY_MISSING])
        self.assertEqual(report["dependencies"]["missing"], ["UnavailablePackage"])

    def test_directory_does_not_satisfy_regular_file_requirement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            spec = Path("tasks.md")
            artifact = Path("artifact.py")
            (root / spec).write_text("- [x] 1. done\n", encoding="utf-8")
            (root / artifact).mkdir()
            report = build_readiness_report(
                root,
                spec_path=spec,
                required_artifacts=(artifact,),
                dependencies={},
                traceability_schema_path=None,
                traceability_map_path=None,
            )
        self.assertEqual(report["blockerCodes"], [BLOCKER_ARTIFACT_MISSING])

    def test_artifact_set_hash_is_stable_and_content_bound(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = Path("a.txt")
            second = Path("b.txt")
            (root / first).write_text("first\n", encoding="utf-8")
            (root / second).write_text("second\n", encoding="utf-8")
            before = inspect_artifacts(root, (second, first))["artifactSetSha256"]
            reordered = inspect_artifacts(root, (first, second))["artifactSetSha256"]
            (root / second).write_text("changed\n", encoding="utf-8")
            after = inspect_artifacts(root, (first, second))["artifactSetSha256"]
        self.assertRegex(before, re.compile(r"^[0-9a-f]{64}$"))
        self.assertEqual(before, reordered)
        self.assertNotEqual(before, after)

    def test_missing_artifact_suppresses_set_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report = inspect_artifacts(Path(directory), (Path("missing"),))
        self.assertIsNone(report["artifactSetSha256"])


class TestExecutionTest(unittest.TestCase):
    def test_passed_execution_parses_test_count_without_returning_output(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr="Ran 121 tests in 8.9s\nOK\n"
        )
        result = run_test_plan(
            Path("."),
            modules=("example",),
            runner=mock.Mock(return_value=completed),
            monotonic=mock.Mock(side_effect=[10.0, 10.25]),
        )
        self.assertEqual(result["status"], TEST_STATUS_PASSED)
        self.assertEqual(result["testsRun"], 121)
        self.assertEqual(result["durationMilliseconds"], 250)
        self.assertNotIn("stdout", result)
        self.assertNotIn("stderr", result)

    def test_failed_execution_uses_bounded_code(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=7, stdout="secret-shaped raw output", stderr="provider detail"
        )
        result = run_test_plan(
            Path("."),
            modules=("example",),
            runner=mock.Mock(return_value=completed),
            monotonic=mock.Mock(side_effect=[5.0, 5.1]),
        )
        self.assertEqual(result["status"], TEST_STATUS_FAILED)
        self.assertEqual(result["reasonCode"], BLOCKER_TESTS_FAILED)
        self.assertEqual(result["exitCode"], 7)
        self.assertNotIn("secret-shaped", json.dumps(result))
        self.assertNotIn("provider detail", json.dumps(result))

    def test_timeout_uses_bounded_code(self) -> None:
        runner = mock.Mock(side_effect=subprocess.TimeoutExpired(cmd=[], timeout=1))
        result = run_test_plan(
            Path("."),
            modules=("example",),
            timeout_seconds=1,
            runner=runner,
            monotonic=mock.Mock(side_effect=[1.0, 2.0]),
        )
        self.assertEqual(result["status"], TEST_STATUS_TIMED_OUT)
        self.assertEqual(result["reasonCode"], BLOCKER_TEST_TIMEOUT)

    def test_failed_execution_blocks_an_otherwise_ready_report(self) -> None:
        report = {
            "status": REPORT_STATUS_READY,
            "blockerCodes": [],
            "testPlan": {"execution": {}},
        }
        attach_test_execution(
            report,
            {
                "status": TEST_STATUS_FAILED,
                "reasonCode": BLOCKER_TESTS_FAILED,
                "exitCode": 1,
                "durationMilliseconds": 3,
                "testsRun": 1,
            },
        )
        self.assertEqual(report["status"], REPORT_STATUS_BLOCKED)
        self.assertEqual(report["blockerCodes"], [BLOCKER_TESTS_FAILED])


class SourceRevisionTest(unittest.TestCase):
    def test_revision_report_keeps_only_sha_and_cleanliness(self) -> None:
        runner = mock.Mock(
            side_effect=[
                subprocess.CompletedProcess([], 0, stdout="a" * 40 + "\n", stderr=""),
                subprocess.CompletedProcess(
                    [], 0, stdout=" M secret-looking-file\n", stderr="diagnostic"
                ),
            ]
        )
        report = inspect_source_revision(Path("."), runner=runner)
        self.assertEqual(
            report,
            {
                "available": True,
                "gitHeadSha": "a" * 40,
                "workingTreeClean": False,
            },
        )
        self.assertNotIn("secret-looking-file", json.dumps(report))
        self.assertNotIn("diagnostic", json.dumps(report))

    def test_invalid_revision_fails_closed_without_diagnostics(self) -> None:
        runner = mock.Mock(
            side_effect=[
                subprocess.CompletedProcess([], 1, stdout="not-a-sha", stderr="raw error"),
                subprocess.CompletedProcess([], 1, stdout="path", stderr="raw error"),
            ]
        )
        report = inspect_source_revision(Path("."), runner=runner)
        self.assertEqual(
            report,
            {"available": False, "gitHeadSha": None, "workingTreeClean": None},
        )
        self.assertNotIn("raw error", json.dumps(report))


class CliContractTest(unittest.TestCase):
    SCRIPT = (
        Path(__file__).resolve().parents[1]
        / "bin"
        / "check_crawler_orchestration_readiness.py"
    )
    REPO_ROOT = Path(__file__).resolve().parents[2]
    SECURITY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "security-audit.yml"

    def test_json_cli_emits_parseable_schema_without_raw_diagnostics(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(self.SCRIPT), "--json"],
            cwd=str(self.REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["status"], REPORT_STATUS_READY)
        serialized = json.dumps(report).lower()
        self.assertNotIn("stdout", serialized)
        self.assertNotIn("stderr", serialized)
        self.assertNotIn("traceback", serialized)

    def test_invalid_timeout_uses_argparse_exit_two(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(self.SCRIPT), "--timeout-seconds", "0", "--json"],
            cwd=str(self.REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")

    def test_human_cli_reports_traceability_coverage(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(self.SCRIPT)],
            cwd=str(self.REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("traceability=71/71", completed.stdout)

    def test_test_plan_is_closed_and_backend_scoped(self) -> None:
        self.assertIsInstance(DEFAULT_TEST_MODULES, tuple)
        self.assertEqual(len(DEFAULT_TEST_MODULES), len(set(DEFAULT_TEST_MODULES)))
        for module in DEFAULT_TEST_MODULES:
            self.assertRegex(module, re.compile(r"^backend(?:\.[a-zA-Z0-9_]+)+$"))

    def test_security_audit_includes_backend_test_requirements(self) -> None:
        workflow = self.SECURITY_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("- backend/test-requirements.txt", workflow)


if __name__ == "__main__":
    unittest.main()
