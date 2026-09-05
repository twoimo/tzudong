"""Reproducible readiness audit for the crawler orchestration specification.

The completed Kiro checklist is useful planning evidence, but it is not by
itself executable proof.  This module turns the static parts of that evidence
into a bounded, machine-readable preflight:

* every task in the selected checklist must be complete;
* every required implementation/evidence path must exist as a regular file;
* every dependency needed by the focused verification suite must import; and
* when requested, the focused tests must pass under the exact interpreter that
  launched the audit.

The report deliberately excludes captured stdout/stderr, environment values,
provider diagnostics, and database diagnostics.  A failed test is represented
only by a fixed code, exit code, duration, and parsed test count.
"""

from __future__ import annotations

import importlib.util
import hashlib
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable, Mapping, Sequence


SCHEMA_VERSION = 1
REPORT_STATUS_READY = "Ready"
REPORT_STATUS_BLOCKED = "Blocked"

BLOCKER_SPEC_MISSING = "spec_missing"
BLOCKER_SPEC_INVALID = "spec_invalid"
BLOCKER_SPEC_INCOMPLETE = "spec_incomplete"
BLOCKER_TRACEABILITY_MISSING = "traceability_missing"
BLOCKER_TRACEABILITY_INVALID = "traceability_invalid"
BLOCKER_TRACEABILITY_INCOMPLETE = "traceability_incomplete"
BLOCKER_ARTIFACT_MISSING = "artifact_missing"
BLOCKER_DEPENDENCY_MISSING = "dependency_missing"
BLOCKER_TESTS_FAILED = "tests_failed"
BLOCKER_TEST_TIMEOUT = "test_timeout"
BLOCKER_SOURCE_UNAVAILABLE = "source_unavailable"
BLOCKER_SOURCE_DIRTY = "source_dirty"

BLOCKER_CODES = frozenset(
    {
        BLOCKER_SPEC_MISSING,
        BLOCKER_SPEC_INVALID,
        BLOCKER_SPEC_INCOMPLETE,
        BLOCKER_TRACEABILITY_MISSING,
        BLOCKER_TRACEABILITY_INVALID,
        BLOCKER_TRACEABILITY_INCOMPLETE,
        BLOCKER_ARTIFACT_MISSING,
        BLOCKER_DEPENDENCY_MISSING,
        BLOCKER_TESTS_FAILED,
        BLOCKER_TEST_TIMEOUT,
        BLOCKER_SOURCE_UNAVAILABLE,
        BLOCKER_SOURCE_DIRTY,
    }
)

TEST_STATUS_NOT_RUN = "NotRun"
TEST_STATUS_PASSED = "Passed"
TEST_STATUS_FAILED = "Failed"
TEST_STATUS_TIMED_OUT = "TimedOut"

MAX_REPORTED_ITEMS = 50
MAX_REPORTED_LABEL_LENGTH = 160

DEFAULT_SPEC_PATH = Path(
    ".kiro/specs/crawler-pipeline-orchestration/tasks.md"
)
DEFAULT_TRACEABILITY_SCHEMA_PATH = Path(
    ".kiro/specs/crawler-pipeline-orchestration/traceability.schema.json"
)
DEFAULT_TRACEABILITY_MAP_PATH = Path(
    ".kiro/specs/crawler-pipeline-orchestration/traceability.map.json"
)

DEFAULT_REQUIRED_ARTIFACTS = (
    Path(".kiro/specs/crawler-pipeline-orchestration/requirements.md"),
    Path(".kiro/specs/crawler-pipeline-orchestration/design.md"),
    DEFAULT_SPEC_PATH,
    DEFAULT_TRACEABILITY_SCHEMA_PATH,
    DEFAULT_TRACEABILITY_MAP_PATH,
    Path("backend/pipeline_control/cadence.schedule.json"),
    Path("backend/pipeline_control/schedule.py"),
    Path("backend/pipeline_control/health.py"),
    Path("backend/pipeline_control/manifest.py"),
    Path("backend/pipeline_control/profiles.py"),
    Path("backend/pipeline_control/worker.py"),
    Path("backend/bin/check_env_contract.py"),
    Path("backend/bin/run_hosted_new_video_pipeline.py"),
    Path("backend/bin/apply_hosted_pending_candidates.py"),
    Path("backend/supabase/scripts/hosted_data_plane.py"),
    Path("backend/supabase/migrations/20260828000100_hosted_candidate_identity_unique.sql"),
    Path(".github/workflows/daily-crawler.yml"),
    Path(".github/workflows/gdrive-frame-backfill.yml"),
)

DEFAULT_TEST_DEPENDENCIES = {
    "hypothesis": "Hypothesis",
    "yaml": "PyYAML",
}

DEFAULT_TEST_MODULES = (
    "backend.pipeline_control.test_readiness_unittest",
    "backend.pipeline_control.test_cadence_config_unittest",
    "backend.pipeline_control.test_schedule_pbt",
    "backend.pipeline_control.test_health_unittest",
    "backend.pipeline_control.test_health_pbt",
    "backend.pipeline_control.test_manifest_pbt",
    "backend.pipeline_control.test_manifest_presence_unittest",
    "backend.pipeline_control.test_profiles_pbt",
    "backend.pipeline_control.test_profiles_source_contract_unittest",
    "backend.pipeline_control.test_publish_gate_pbt",
    "backend.pipeline_control.test_reflection_pbt",
    "backend.supabase.scripts.test_hosted_data_plane",
    "backend.pipeline_control.test_end_to_end_lite_run",
    "backend.utils.tests.test_supabase_boundary_pbt",
    "backend.utils.tests.test_env_contract_pbt",
    "backend.utils.tests.test_env_contract_preflight_ordering",
    "backend.utils.tests.test_backfill_planner_pbt",
    "backend.utils.tests.test_gha_degradation_evidence",
    "backend.utils.tests.test_gitignore_forbidden_paths",
    "backend.utils.tests.test_governance_boundaries",
    "backend.utils.tests.test_mac_launchd_install_script",
    "backend.bin.tests.test_mac_dry_run_no_auto_enable_unittest",
)

_TASK_LINE = re.compile(r"^\s*- \[([ xX])\]([*!])?\s+(.+?)\s*$", re.MULTILINE)
_TASK_ID = re.compile(r"^([1-9]\d*(?:\.\d+)?)\b")
_TRACEABILITY_TASK_ID = re.compile(r"^[1-9]\d*(?:\.\d+)?$")
_VERIFICATION_MODULE = re.compile(r"^backend(?:\.[A-Za-z0-9_]+)+$")
_TEST_COUNT = re.compile(r"Ran\s+(\d+)\s+tests?\b")
_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")

TRACEABILITY_SCHEMA_VERSION = 1
TRACEABILITY_EVIDENCE_CLASSES = frozenset(
    {
        "checkpoint",
        "local_runtime",
        "source",
        "source_contract",
        "hosted_supabase",
    }
)
TRACEABILITY_EXTERNAL_EVIDENCE_TYPES = frozenset(
    {
        "github_branch_protection_readback",
        "hosted_supabase_readback",
        "mac_launchagent_readback",
    }
)
TRACEABILITY_VALIDATION_CODES = frozenset(
    {
        "duplicate_task_id",
        "evidence_class_invalid",
        "external_evidence_type_invalid",
        "implementation_path_invalid",
        "map_document_invalid",
        "schema_document_invalid",
        "task_id_invalid",
        "verification_module_invalid",
    }
)
_TRACEABILITY_MAP_KEYS = frozenset({"schemaVersion", "specPath", "entries"})
_TRACEABILITY_ENTRY_KEYS = frozenset(
    {
        "taskId",
        "evidenceClasses",
        "implementationPaths",
        "verificationModules",
        "externalEvidenceTypes",
    }
)
_FORBIDDEN_TRACEABILITY_PATH_PARTS = frozenset(
    {
        ".hypothesis",
        ".next",
        "__pycache__",
        "node_modules",
        "reports",
        "target",
    }
)


def _utc_timestamp(now: datetime | None = None) -> str:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _bounded_labels(labels: Sequence[str]) -> list[str]:
    return [
        str(label).strip()[:MAX_REPORTED_LABEL_LENGTH]
        for label in labels[:MAX_REPORTED_ITEMS]
    ]


def inspect_task_document(text: str) -> dict[str, object]:
    """Return completion counts for a Kiro Markdown task document."""

    matches = list(_TASK_LINE.finditer(text))
    if not matches:
        return {
            "valid": False,
            "totalCount": 0,
            "completedCount": 0,
            "openCount": 0,
            "optionalCount": 0,
            "optionalOpenCount": 0,
            "externallyGatedCount": 0,
            "externallyGatedOpenCount": 0,
            "openTasks": [],
        }

    open_matches = [match for match in matches if match.group(1) == " "]
    optional_matches = [match for match in matches if match.group(2) == "*"]
    optional_open = [
        match for match in open_matches if match.group(2) == "*"
    ]
    externally_gated = [match for match in matches if match.group(2) == "!"]
    externally_gated_open = [
        match for match in open_matches if match.group(2) == "!"
    ]
    return {
        "valid": True,
        "totalCount": len(matches),
        "completedCount": len(matches) - len(open_matches),
        "openCount": len(open_matches),
        "optionalCount": len(optional_matches),
        "optionalOpenCount": len(optional_open),
        "externallyGatedCount": len(externally_gated),
        "externallyGatedOpenCount": len(externally_gated_open),
        "openTasks": _bounded_labels(
            [match.group(3) for match in open_matches]
        ),
    }


def inspect_spec(repo_root: Path, spec_path: Path = DEFAULT_SPEC_PATH) -> dict[str, object]:
    """Inspect the selected task document without surfacing read diagnostics."""

    relative_path = spec_path.as_posix()
    path = repo_root / spec_path
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {
            "path": relative_path,
            "present": False,
            **inspect_task_document(""),
        }
    return {
        "path": relative_path,
        "present": True,
        **inspect_task_document(text),
    }


def _extract_task_ids(text: str) -> tuple[str, ...]:
    task_ids: list[str] = []
    for match in _TASK_LINE.finditer(text):
        task_id = _TASK_ID.match(match.group(3))
        if task_id is not None:
            task_ids.append(task_id.group(1))
    return tuple(task_ids)


def _read_json_object(path: Path) -> tuple[dict[str, object] | None, bytes | None]:
    try:
        content = path.read_bytes()
        value = json.loads(content)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None, None
    if not isinstance(value, dict):
        return None, content
    return value, content


def _traceability_schema_is_valid(document: Mapping[str, object]) -> bool:
    required = document.get("required")
    properties = document.get("properties")
    if not (
        document.get("$schema") == "https://json-schema.org/draft/2020-12/schema"
        and document.get("x-schemaVersion") == TRACEABILITY_SCHEMA_VERSION
        and document.get("type") == "object"
        and document.get("additionalProperties") is False
        and isinstance(required, list)
        and set(required) == _TRACEABILITY_MAP_KEYS
        and isinstance(properties, dict)
        and set(properties) == _TRACEABILITY_MAP_KEYS
    ):
        return False
    entries = properties.get("entries")
    if not isinstance(entries, dict):
        return False
    item = entries.get("items")
    return (
        entries.get("type") == "array"
        and entries.get("minItems") == 1
        and isinstance(item, dict)
        and item.get("type") == "object"
        and item.get("additionalProperties") is False
        and isinstance(item.get("required"), list)
        and set(item["required"]) == _TRACEABILITY_ENTRY_KEYS
        and isinstance(item.get("properties"), dict)
        and set(item["properties"]) == _TRACEABILITY_ENTRY_KEYS
    )


def _is_string_list(value: object, *, allow_empty: bool) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or bool(value))
        and all(isinstance(item, str) and bool(item) for item in value)
        and len(value) == len(set(value))
    )


def _is_safe_traceability_path(value: str) -> bool:
    if "\\" in value or value.endswith(".pyc") or value.startswith("/"):
        return False
    path = PurePosixPath(value)
    return (
        bool(value)
        and path.as_posix() == value
        and all(part not in {"", ".", ".."} for part in path.parts)
        and not (_FORBIDDEN_TRACEABILITY_PATH_PARTS & set(path.parts))
    )


def _module_source_path(module: str) -> Path:
    return Path(*module.split(".")).with_suffix(".py")


def _resolves_within_repo(repo_root: Path, relative_path: Path) -> bool:
    try:
        (repo_root / relative_path).resolve().relative_to(repo_root.resolve())
    except (OSError, ValueError):
        return False
    return True


def inspect_traceability(
    repo_root: Path,
    *,
    spec_path: Path = DEFAULT_SPEC_PATH,
    schema_path: Path = DEFAULT_TRACEABILITY_SCHEMA_PATH,
    map_path: Path = DEFAULT_TRACEABILITY_MAP_PATH,
    required_artifacts: Sequence[Path] = DEFAULT_REQUIRED_ARTIFACTS,
    test_modules: Sequence[str] = DEFAULT_TEST_MODULES,
) -> dict[str, object]:
    """Validate the closed task-to-evidence map and detect orphaned coverage."""

    schema_source = repo_root / schema_path
    map_source = repo_root / map_path
    schema_document, schema_content = _read_json_object(schema_source)
    map_document, map_content = _read_json_object(map_source)
    present = schema_source.is_file() and map_source.is_file()
    validation_codes: set[str] = set()

    if schema_source.is_file() and (
        schema_document is None or not _traceability_schema_is_valid(schema_document)
    ):
        validation_codes.add("schema_document_invalid")
    if map_source.is_file() and map_document is None:
        validation_codes.add("map_document_invalid")

    try:
        spec_text = (repo_root / spec_path).read_text(encoding="utf-8")
    except OSError:
        spec_text = ""
    spec_task_ids = _extract_task_ids(spec_text)
    spec_task_count = len(list(_TASK_LINE.finditer(spec_text)))
    mapped_task_ids: list[str] = []
    implementation_paths: set[str] = set()
    verification_modules: set[str] = set()

    if map_document is not None:
        if (
            set(map_document) != _TRACEABILITY_MAP_KEYS
            or map_document.get("schemaVersion") != TRACEABILITY_SCHEMA_VERSION
            or map_document.get("specPath") != spec_path.as_posix()
            or not isinstance(map_document.get("entries"), list)
            or not map_document.get("entries")
        ):
            validation_codes.add("map_document_invalid")
        else:
            for entry in map_document["entries"]:
                if not isinstance(entry, dict) or set(entry) != _TRACEABILITY_ENTRY_KEYS:
                    validation_codes.add("map_document_invalid")
                    continue
                task_id = entry.get("taskId")
                evidence_classes = entry.get("evidenceClasses")
                paths = entry.get("implementationPaths")
                modules = entry.get("verificationModules")
                external_types = entry.get("externalEvidenceTypes")

                if not isinstance(task_id, str) or not _TRACEABILITY_TASK_ID.fullmatch(task_id):
                    validation_codes.add("task_id_invalid")
                else:
                    mapped_task_ids.append(task_id)
                if not _is_string_list(evidence_classes, allow_empty=False) or not set(
                    evidence_classes if isinstance(evidence_classes, list) else []
                ).issubset(TRACEABILITY_EVIDENCE_CLASSES):
                    validation_codes.add("evidence_class_invalid")
                if not _is_string_list(paths, allow_empty=False):
                    validation_codes.add("implementation_path_invalid")
                else:
                    for value in paths:
                        if not _is_safe_traceability_path(value):
                            validation_codes.add("implementation_path_invalid")
                        elif not _resolves_within_repo(repo_root, Path(value)):
                            validation_codes.add("implementation_path_invalid")
                        else:
                            implementation_paths.add(value)
                if not _is_string_list(modules, allow_empty=True):
                    validation_codes.add("verification_module_invalid")
                else:
                    for value in modules:
                        if not _VERIFICATION_MODULE.fullmatch(value):
                            validation_codes.add("verification_module_invalid")
                        elif not _resolves_within_repo(
                            repo_root, _module_source_path(value)
                        ):
                            validation_codes.add("verification_module_invalid")
                        else:
                            verification_modules.add(value)
                if not _is_string_list(external_types, allow_empty=True) or not set(
                    external_types if isinstance(external_types, list) else []
                ).issubset(TRACEABILITY_EXTERNAL_EVIDENCE_TYPES):
                    validation_codes.add("external_evidence_type_invalid")

    duplicate_task_ids = sorted(
        {
            task_id
            for task_id in (*spec_task_ids, *mapped_task_ids)
            if spec_task_ids.count(task_id) > 1 or mapped_task_ids.count(task_id) > 1
        }
    )
    if duplicate_task_ids:
        validation_codes.add("duplicate_task_id")
    if len(spec_task_ids) != spec_task_count:
        validation_codes.add("task_id_invalid")

    spec_task_id_set = set(spec_task_ids)
    mapped_task_id_set = set(mapped_task_ids)
    unmapped_task_ids = sorted(spec_task_id_set - mapped_task_id_set)
    unknown_task_ids = sorted(mapped_task_id_set - spec_task_id_set)
    missing_implementation_paths = sorted(
        path
        for path in implementation_paths
        if not (repo_root / Path(path)).is_file()
    )
    missing_verification_modules = sorted(
        module
        for module in verification_modules
        if not (repo_root / _module_source_path(module)).is_file()
    )
    unmapped_required_artifacts = sorted(
        path.as_posix()
        for path in required_artifacts
        if path.as_posix() not in implementation_paths
    )
    unmapped_test_modules = sorted(
        module for module in test_modules if module not in verification_modules
    )
    unplanned_verification_modules = sorted(
        module for module in verification_modules if module not in set(test_modules)
    )
    complete = not any(
        (
            unmapped_task_ids,
            unknown_task_ids,
            missing_implementation_paths,
            missing_verification_modules,
            unmapped_required_artifacts,
            unmapped_test_modules,
            unplanned_verification_modules,
        )
    )
    traceability_hash = hashlib.sha256()
    if schema_content is not None:
        traceability_hash.update(schema_path.as_posix().encode("utf-8"))
        traceability_hash.update(b"\0")
        traceability_hash.update(schema_content)
        traceability_hash.update(b"\0")
    if map_content is not None:
        traceability_hash.update(map_path.as_posix().encode("utf-8"))
        traceability_hash.update(b"\0")
        traceability_hash.update(map_content)
        traceability_hash.update(b"\0")

    return {
        "schemaPath": schema_path.as_posix(),
        "mapPath": map_path.as_posix(),
        "present": present,
        "valid": present and not validation_codes,
        "complete": complete,
        "taskCount": len(spec_task_ids),
        "mappedTaskCount": len(mapped_task_id_set),
        "validationCodes": sorted(validation_codes),
        "duplicateTaskIds": _bounded_labels(duplicate_task_ids),
        "unmappedTaskIds": _bounded_labels(unmapped_task_ids),
        "unknownTaskIds": _bounded_labels(unknown_task_ids),
        "missingImplementationPaths": _bounded_labels(missing_implementation_paths),
        "missingVerificationModules": _bounded_labels(missing_verification_modules),
        "unmappedRequiredArtifacts": _bounded_labels(unmapped_required_artifacts),
        "unmappedTestModules": _bounded_labels(unmapped_test_modules),
        "unplannedVerificationModules": _bounded_labels(
            unplanned_verification_modules
        ),
        "traceabilitySha256": traceability_hash.hexdigest() if present else None,
    }


def inspect_artifacts(
    repo_root: Path,
    required_artifacts: Sequence[Path] = DEFAULT_REQUIRED_ARTIFACTS,
) -> dict[str, object]:
    """Report required regular-file presence using repository-relative paths."""

    missing: list[str] = []
    artifact_hash = hashlib.sha256()
    for path in sorted(required_artifacts, key=lambda item: item.as_posix()):
        source = repo_root / path
        if not source.is_file():
            missing.append(path.as_posix())
            continue
        try:
            content = source.read_bytes()
        except OSError:
            missing.append(path.as_posix())
            continue
        artifact_hash.update(path.as_posix().encode("utf-8"))
        artifact_hash.update(b"\0")
        artifact_hash.update(content)
        artifact_hash.update(b"\0")
    return {
        "requiredCount": len(required_artifacts),
        "presentCount": len(required_artifacts) - len(missing),
        "missing": _bounded_labels(missing),
        "artifactSetSha256": None if missing else artifact_hash.hexdigest(),
    }


def inspect_source_revision(
    repo_root: Path,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, object]:
    """Return bounded Git provenance without exposing status paths."""

    try:
        revision = runner(
            ["git", "rev-parse", "--verify", "HEAD"],
            cwd=str(repo_root.resolve()),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        status = runner(
            ["git", "status", "--porcelain", "--untracked-files=normal"],
            cwd=str(repo_root.resolve()),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            "available": False,
            "gitHeadSha": None,
            "workingTreeClean": None,
        }

    sha = (revision.stdout or "").strip().lower()
    available = revision.returncode == 0 and _GIT_SHA.fullmatch(sha) is not None
    status_available = status.returncode == 0
    return {
        "available": available and status_available,
        "gitHeadSha": sha if available else None,
        "workingTreeClean": not bool(status.stdout) if status_available else None,
    }


def inspect_dependencies(
    dependencies: Mapping[str, str] = DEFAULT_TEST_DEPENDENCIES,
    *,
    find_spec: Callable[[str], object | None] = importlib.util.find_spec,
) -> dict[str, object]:
    """Report import readiness without importing dependency code."""

    missing: list[str] = []
    for import_name, display_name in dependencies.items():
        try:
            present = find_spec(import_name) is not None
        except (ImportError, AttributeError, ValueError):
            present = False
        if not present:
            missing.append(display_name)
    required = list(dependencies.values())
    return {
        "required": _bounded_labels(required),
        "missing": _bounded_labels(missing),
        "ready": not missing,
    }


def build_readiness_report(
    repo_root: Path,
    *,
    spec_path: Path = DEFAULT_SPEC_PATH,
    required_artifacts: Sequence[Path] = DEFAULT_REQUIRED_ARTIFACTS,
    dependencies: Mapping[str, str] = DEFAULT_TEST_DEPENDENCIES,
    traceability_schema_path: Path | None = DEFAULT_TRACEABILITY_SCHEMA_PATH,
    traceability_map_path: Path | None = DEFAULT_TRACEABILITY_MAP_PATH,
    test_modules: Sequence[str] = DEFAULT_TEST_MODULES,
    find_spec: Callable[[str], object | None] = importlib.util.find_spec,
    now: datetime | None = None,
) -> dict[str, object]:
    """Build the static, fail-closed orchestration readiness report."""

    root = repo_root.resolve()
    spec = inspect_spec(root, spec_path)
    artifacts = inspect_artifacts(root, required_artifacts)
    dependency_report = inspect_dependencies(dependencies, find_spec=find_spec)
    traceability = None
    if traceability_schema_path is not None and traceability_map_path is not None:
        traceability = inspect_traceability(
            root,
            spec_path=spec_path,
            schema_path=traceability_schema_path,
            map_path=traceability_map_path,
            required_artifacts=required_artifacts,
            test_modules=test_modules,
        )

    source = inspect_source_revision(root)
    blockers: list[str] = []
    if source["available"] is not True:
        blockers.append(BLOCKER_SOURCE_UNAVAILABLE)
    elif source["workingTreeClean"] is not True:
        blockers.append(BLOCKER_SOURCE_DIRTY)
    if not spec["present"]:
        blockers.append(BLOCKER_SPEC_MISSING)
    elif not spec["valid"]:
        blockers.append(BLOCKER_SPEC_INVALID)
    elif spec["openCount"]:
        blockers.append(BLOCKER_SPEC_INCOMPLETE)
    if traceability is not None:
        if not traceability["present"]:
            blockers.append(BLOCKER_TRACEABILITY_MISSING)
        elif not traceability["valid"]:
            blockers.append(BLOCKER_TRACEABILITY_INVALID)
        elif not traceability["complete"]:
            blockers.append(BLOCKER_TRACEABILITY_INCOMPLETE)
    if artifacts["missing"]:
        blockers.append(BLOCKER_ARTIFACT_MISSING)
    if dependency_report["missing"]:
        blockers.append(BLOCKER_DEPENDENCY_MISSING)

    blockers = sorted(set(blockers))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": _utc_timestamp(now),
        "status": REPORT_STATUS_READY if not blockers else REPORT_STATUS_BLOCKED,
        "blockerCodes": blockers,
        "source": source,
        "spec": spec,
        "traceability": traceability,
        "artifacts": artifacts,
        "dependencies": dependency_report,
        "testPlan": {
            "moduleCount": len(test_modules),
            "execution": {
                "status": TEST_STATUS_NOT_RUN,
                "reasonCode": None,
                "exitCode": None,
                "durationMilliseconds": None,
                "testsRun": None,
            },
        },
    }


def run_test_plan(
    repo_root: Path,
    *,
    modules: Sequence[str] = DEFAULT_TEST_MODULES,
    timeout_seconds: int = 180,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    monotonic: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    """Execute focused tests and return only bounded outcome metadata."""

    started = monotonic()
    try:
        completed = runner(
            [sys.executable, "-m", "unittest", *modules],
            cwd=str(repo_root.resolve()),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        duration_ms = max(0, round((monotonic() - started) * 1000))
        return {
            "status": TEST_STATUS_TIMED_OUT,
            "reasonCode": BLOCKER_TEST_TIMEOUT,
            "exitCode": None,
            "durationMilliseconds": duration_ms,
            "testsRun": None,
        }

    duration_ms = max(0, round((monotonic() - started) * 1000))
    combined = f"{completed.stdout or ''}\n{completed.stderr or ''}"
    counts = [int(match) for match in _TEST_COUNT.findall(combined)]
    passed = completed.returncode == 0
    return {
        "status": TEST_STATUS_PASSED if passed else TEST_STATUS_FAILED,
        "reasonCode": None if passed else BLOCKER_TESTS_FAILED,
        "exitCode": int(completed.returncode),
        "durationMilliseconds": duration_ms,
        "testsRun": counts[-1] if counts else None,
    }


def attach_test_execution(
    report: dict[str, object], execution: Mapping[str, object]
) -> dict[str, object]:
    """Attach a test result and recompute the final readiness status."""

    test_plan = dict(report["testPlan"])
    test_plan["execution"] = dict(execution)
    report["testPlan"] = test_plan

    blockers = set(report["blockerCodes"])
    reason = execution.get("reasonCode")
    if reason in BLOCKER_CODES:
        blockers.add(str(reason))
    report["blockerCodes"] = sorted(blockers)
    report["status"] = (
        REPORT_STATUS_READY if not blockers else REPORT_STATUS_BLOCKED
    )
    return report


def audit_and_maybe_test(
    repo_root: Path,
    *,
    run_tests: bool,
    timeout_seconds: int = 180,
) -> dict[str, object]:
    """Run static preflight, then focused tests only when the preflight is ready."""

    report = build_readiness_report(repo_root)
    if not run_tests:
        return report
    if report["status"] != REPORT_STATUS_READY:
        execution = dict(report["testPlan"]["execution"])
        execution["reasonCode"] = "preflight_blocked"
        return attach_test_execution(report, execution)
    return attach_test_execution(
        report,
        run_test_plan(repo_root, timeout_seconds=timeout_seconds),
    )
