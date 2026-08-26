import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
VERIFIER_PATH = (
    REPOSITORY_ROOT / ".github" / "scripts" / "verify-nightly-local-publication.py"
)
WORKFLOW_PATH = REPOSITORY_ROOT / ".github" / "workflows" / "nightly-local-regression.yml"
BUILDER_PATH = (
    REPOSITORY_ROOT / ".github" / "scripts" / "build-nightly-local-publication.py"
)
SPEC = importlib.util.spec_from_file_location("nightly_publication_verifier", VERIFIER_PATH)
assert SPEC is not None and SPEC.loader is not None
verifier = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verifier
SPEC.loader.exec_module(verifier)
BUILDER_SPEC = importlib.util.spec_from_file_location(
    "nightly_publication_builder",
    BUILDER_PATH,
)
assert BUILDER_SPEC is not None and BUILDER_SPEC.loader is not None
builder = importlib.util.module_from_spec(BUILDER_SPEC)
sys.modules[BUILDER_SPEC.name] = builder
BUILDER_SPEC.loader.exec_module(builder)
LOCAL_MIGRATE_PATH = REPOSITORY_ROOT / "backend" / "supabase" / "scripts" / "local-migrate.py"
LOCAL_MIGRATE_SPEC = importlib.util.spec_from_file_location(
    "local_migrate_publication_contract",
    LOCAL_MIGRATE_PATH,
)
assert LOCAL_MIGRATE_SPEC is not None and LOCAL_MIGRATE_SPEC.loader is not None
local_migrate = importlib.util.module_from_spec(LOCAL_MIGRATE_SPEC)
sys.modules[LOCAL_MIGRATE_SPEC.name] = local_migrate
LOCAL_MIGRATE_SPEC.loader.exec_module(local_migrate)
FUNCTION_SCANNER_PATH = (
    REPOSITORY_ROOT / "backend" / "supabase" / "scripts" / "local-function-runtime-scan.py"
)
FUNCTION_SCANNER_SPEC = importlib.util.spec_from_file_location(
    "local_function_publication_contract",
    FUNCTION_SCANNER_PATH,
)
assert FUNCTION_SCANNER_SPEC is not None and FUNCTION_SCANNER_SPEC.loader is not None
function_scanner = importlib.util.module_from_spec(FUNCTION_SCANNER_SPEC)
sys.modules[FUNCTION_SCANNER_SPEC.name] = function_scanner
FUNCTION_SCANNER_SPEC.loader.exec_module(function_scanner)
LIFECYCLE_WRITER_PATH = (
    REPOSITORY_ROOT / ".github" / "scripts" / "write-nightly-lifecycle-stage.py"
)
LIFECYCLE_WRITER_SPEC = importlib.util.spec_from_file_location(
    "nightly_lifecycle_stage_writer",
    LIFECYCLE_WRITER_PATH,
)
assert LIFECYCLE_WRITER_SPEC is not None and LIFECYCLE_WRITER_SPEC.loader is not None
lifecycle_writer = importlib.util.module_from_spec(LIFECYCLE_WRITER_SPEC)
sys.modules[LIFECYCLE_WRITER_SPEC.name] = lifecycle_writer
LIFECYCLE_WRITER_SPEC.loader.exec_module(lifecycle_writer)


class LocalPublicationVerifierTests(unittest.TestCase):
    FIXTURE_GITHUB_SHA = "b" * 40

    def setUp(self) -> None:
        github_sha_patch = mock.patch.dict(
            os.environ,
            {"GITHUB_SHA": self.FIXTURE_GITHUB_SHA},
        )
        github_sha_patch.start()
        self.addCleanup(github_sha_patch.stop)

    def test_lifecycle_stage_writer_is_bounded_atomic_and_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repository_root = Path(temporary)
            artifact_root = repository_root / "nightly-artifacts"
            artifact_root.mkdir(mode=0o700)
            diagnostics = artifact_root / "failure-diagnostics"
            running = lifecycle_writer.build_receipt(
                stage_index=14,
                stage="profile_mutation",
                status="running",
                exit_code=None,
            )
            target = lifecycle_writer.write_receipt(diagnostics, running)
            self.assertEqual(
                json.loads(target.read_text(encoding="utf-8")),
                running,
            )
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.stat().st_nlink, 1)
            self.assertLessEqual(target.stat().st_size, 1024)

            upload = lifecycle_writer.prepare_upload_copy(repository_root)
            self.assertEqual(
                upload,
                repository_root
                / "nightly-artifacts/validated-failure-diagnostics/local-lifecycle-stage.json",
            )
            self.assertEqual(upload.read_bytes(), target.read_bytes())
            self.assertEqual(upload.stat().st_mode & 0o777, 0o600)
            self.assertEqual(upload.stat().st_nlink, 1)

            failed = lifecycle_writer.build_receipt(
                stage_index=14,
                stage="profile_mutation",
                status="failed",
                exit_code=1,
            )
            lifecycle_writer.write_receipt(diagnostics, failed)
            self.assertEqual(
                set(json.loads(target.read_text(encoding="utf-8"))),
                lifecycle_writer.RECEIPT_FIELDS,
            )
            self.assertEqual(
                json.loads(target.read_text(encoding="utf-8"))["failure_class"],
                "command_failed",
            )
            with self.assertRaises(lifecycle_writer.LifecycleReceiptError):
                lifecycle_writer.build_receipt(
                    stage_index=13,
                    stage="profile_mutation",
                    status="failed",
                    exit_code=1,
                )

            invalid_receipts = (
                (14, "profile_mutation", "running", 0),
                (14, "profile_mutation", "passed", 1),
                (14, "profile_mutation", "failed", 0),
                (14, "profile_mutation", "failed", 256),
                (14, "profile_mutation", "failed", True),
            )
            for stage_index, stage, status, exit_code in invalid_receipts:
                with self.subTest(status=status, exit_code=exit_code):
                    with self.assertRaises(lifecycle_writer.LifecycleReceiptError):
                        lifecycle_writer.build_receipt(
                            stage_index=stage_index,
                            stage=stage,
                            status=status,
                            exit_code=exit_code,
                        )

            target.unlink()
            target.symlink_to(Path(temporary) / "outside.json")
            with self.assertRaises(lifecycle_writer.LifecycleReceiptError):
                lifecycle_writer.write_receipt(diagnostics, failed)

    def test_lifecycle_stage_upload_staging_rejects_tampering_and_hardlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repository_root = Path(temporary)
            artifact_root = repository_root / "nightly-artifacts"
            artifact_root.mkdir(mode=0o700)
            diagnostics = artifact_root / "failure-diagnostics"
            receipt = lifecycle_writer.build_receipt(
                stage_index=15,
                stage="receipt",
                status="passed",
                exit_code=0,
            )
            source = lifecycle_writer.write_receipt(diagnostics, receipt)

            source.write_text('{"private":"raw"}\n', encoding="utf-8")
            source.chmod(0o600)
            with self.assertRaises(lifecycle_writer.LifecycleReceiptError):
                lifecycle_writer.prepare_upload_copy(repository_root)
            self.assertFalse(
                (artifact_root / "validated-failure-diagnostics").exists()
            )

            source.unlink()
            outside = repository_root / "outside.json"
            outside.write_text("{}\n", encoding="utf-8")
            outside.chmod(0o600)
            os.link(outside, source)
            with self.assertRaises(lifecycle_writer.LifecycleReceiptError):
                lifecycle_writer.prepare_upload_copy(repository_root)

    def test_lifecycle_stage_upload_staging_is_optional_before_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            self.assertIsNone(
                lifecycle_writer.prepare_upload_copy(Path(temporary)),
            )

    def test_workflow_records_each_lifecycle_stage_before_failure_upload(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        previous = -1
        for index, stage in enumerate(lifecycle_writer.STAGES, start=1):
            marker = f"begin_lifecycle_stage {index} {stage}"
            position = workflow.index(marker)
            self.assertGreater(position, previous)
            previous = position
        self.assertEqual(workflow.count("begin_lifecycle_stage "), len(lifecycle_writer.STAGES))
        self.assertEqual(workflow.count("          complete_lifecycle_stage\n"), len(lifecycle_writer.STAGES))
        self.assertIn("set -Eeuo pipefail", workflow)
        self.assertIn("umask 077", workflow)
        self.assertIn("trap fail_lifecycle_stage ERR", workflow)
        self.assertIn("record_lifecycle_stage failed \"$exit_code\" || true", workflow)
        self.assertIn("id: prepare-lifecycle-diagnostic", workflow)
        prepare_index = workflow.index(
            "- name: Prepare bounded lifecycle diagnostic for failure persistence"
        )
        upload_index = workflow.index(
            "- name: Upload bounded failed or partial local nightly diagnostics"
        )
        self.assertLess(prepare_index, upload_index)
        self.assertIn("--prepare-upload", workflow[prepare_index:upload_index])
        self.assertIn(
            "path=nightly-artifacts/validated-failure-diagnostics/local-lifecycle-stage.json",
            workflow[prepare_index:upload_index],
        )
        success_upload = workflow[
            workflow.index("- name: Upload verified sanitized local nightly artifacts"):
            prepare_index
        ]
        self.assertNotIn("local-lifecycle-stage.json", success_upload)
        failed_upload = workflow[
            upload_index:
            workflow.index("- name: Upload allowlisted publication bundle")
        ]
        self.assertIn(
            "${{ steps.prepare-lifecycle-diagnostic.outputs.path }}",
            failed_upload,
        )
        self.assertNotIn(
            "nightly-artifacts/failure-diagnostics/local-lifecycle-stage.json",
            failed_upload,
        )
        begin_function = workflow[
            workflow.index("          begin_lifecycle_stage() {"):
            workflow.index("          complete_lifecycle_stage() {")
        ]
        complete_function = workflow[
            workflow.index("          complete_lifecycle_stage() {"):
            workflow.index("          fail_lifecycle_stage() {")
        ]
        self.assertLess(begin_function.index("trap - ERR"), begin_function.index("record_lifecycle_stage running"))
        self.assertLess(
            begin_function.index("record_lifecycle_stage running"),
            begin_function.index("trap fail_lifecycle_stage ERR"),
        )
        self.assertLess(complete_function.index("trap - ERR"), complete_function.index("record_lifecycle_stage passed 0"))
        first_begin = workflow.index("          begin_lifecycle_stage 1 prerequisite_verify")
        self.assertNotIn(
            "          trap fail_lifecycle_stage ERR\n",
            workflow[workflow.index("          fail_lifecycle_stage() {"):first_begin],
        )
        lifecycle_step = workflow[
            workflow.index("      - name: Apply local migrations, close functions, and seed"):
            workflow.index("      - name: Verify generated Supabase types match the local catalog")
        ]
        command_markers = (
            "local-migrate.py verify-prerequisite",
            "local-migrate.py manifest",
            "local-migrate.py verify \\",
            "local-migrate.py apply-prerequisite",
            "local-migrate.py apply \\",
            "local-function-runtime-scan.py generate",
            "local-function-runtime-scan.py apply",
            "local-function-runtime-scan.py rescan",
            "local-function-runtime-scan.py smoke",
            "local-migrate.py seed",
            "local_runtime_schema_convergence.sql",
            "local_profile_read_boundary.sql",
            "local_profile_leaderboard_page.sql",
            "local_profile_mutation_boundary.sql",
            "local-migrate.py receipt",
        )
        cursor = 0
        for index, (stage, command_marker) in enumerate(
            zip(lifecycle_writer.STAGES, command_markers, strict=True),
            start=1,
        ):
            begin = lifecycle_step.index(
                f"begin_lifecycle_stage {index} {stage}", cursor
            )
            command = lifecycle_step.index(command_marker, begin)
            complete = lifecycle_step.index("complete_lifecycle_stage", command)
            self.assertLess(begin, command)
            self.assertLess(command, complete)
            cursor = complete + len("complete_lifecycle_stage")
        self.assertLess(
            workflow.index("begin_lifecycle_stage 1 prerequisite_verify"),
            workflow.index("python3 backend/supabase/scripts/local-migrate.py verify-prerequisite"),
        )
        self.assertLess(
            workflow.index("begin_lifecycle_stage 15 receipt"),
            workflow.index("python3 backend/supabase/scripts/local-migrate.py receipt"),
        )

    def test_lifecycle_shell_contract_preserves_command_exit_codes(self) -> None:
        harness = r'''set -Eeuo pipefail
lifecycle_stage=''
lifecycle_stage_index=0
record_lifecycle_stage() {
  local status="$1"
  local exit_code="${2:-none}"
  if [[ "${FAIL_WRITER_STATUS:-}" == "$status" ]]; then
    return 2
  fi
  printf '%s:%s:%s\n' "$lifecycle_stage" "$status" "$exit_code"
}
begin_lifecycle_stage() {
  trap - ERR
  lifecycle_stage_index="$1"
  lifecycle_stage="$2"
  record_lifecycle_stage running
  trap fail_lifecycle_stage ERR
}
complete_lifecycle_stage() {
  trap - ERR
  record_lifecycle_stage passed 0
}
fail_lifecycle_stage() {
  local exit_code=$?
  trap - ERR
  if [[ -n "$lifecycle_stage" ]]; then
    record_lifecycle_stage failed "$exit_code" || true
  fi
  exit "$exit_code"
}
begin_lifecycle_stage 1 prerequisite_verify
bash -c "exit ${COMMAND_EXIT_CODE}"
complete_lifecycle_stage
'''
        for exit_code in (1, 23, 124, 137):
            with self.subTest(exit_code=exit_code):
                result = subprocess.run(
                    ["bash", "-c", harness],
                    capture_output=True,
                    text=True,
                    check=False,
                    env={**os.environ, "COMMAND_EXIT_CODE": str(exit_code)},
                )
                self.assertEqual(result.returncode, exit_code)
                self.assertEqual(
                    result.stdout.splitlines(),
                    [
                        "prerequisite_verify:running:none",
                        f"prerequisite_verify:failed:{exit_code}",
                    ],
                )

        for writer_status, expected_lines in (
            ("running", []),
            ("passed", ["prerequisite_verify:running:none"]),
        ):
            with self.subTest(writer_status=writer_status):
                result = subprocess.run(
                    ["bash", "-c", harness],
                    capture_output=True,
                    text=True,
                    check=False,
                    env={
                        **os.environ,
                        "COMMAND_EXIT_CODE": "0",
                        "FAIL_WRITER_STATUS": writer_status,
                    },
                )
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout.splitlines(), expected_lines)

        result = subprocess.run(
            ["bash", "-c", harness],
            capture_output=True,
            text=True,
            check=False,
            env={
                **os.environ,
                "COMMAND_EXIT_CODE": "23",
                "FAIL_WRITER_STATUS": "failed",
            },
        )
        self.assertEqual(result.returncode, 23)
        self.assertEqual(
            result.stdout.splitlines(),
            ["prerequisite_verify:running:none"],
        )

        redirection_harness = harness.replace(
            'bash -c "exit ${COMMAND_EXIT_CODE}"',
            ': > "${MISSING_DIRECTORY}/receipt.json"',
        )
        result = subprocess.run(
            ["bash", "-c", redirection_harness],
            capture_output=True,
            text=True,
            check=False,
            env={
                **os.environ,
                "COMMAND_EXIT_CODE": "0",
                "MISSING_DIRECTORY": "/definitely/missing/nightly-lifecycle",
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stdout.splitlines(),
            [
                "prerequisite_verify:running:none",
                f"prerequisite_verify:failed:{result.returncode}",
            ],
        )

    @staticmethod
    def _e2e_failure_evidence() -> dict[str, object]:
        return {
            "schema": "nightly-playwright-failure-evidence-v1",
            "source": "playwright-json-report-v2",
            "command_exit_code": 1,
            "outcome": "failure",
            "test_count": 2,
            "test_status_counts": {
                "expected": 1, "flaky": 0, "skipped": 0, "unexpected": 1,
            },
            "result_status_counts": {
                "failed": 1, "interrupted": 0, "passed": 1,
                "skipped": 0, "timedOut": 0,
            },
            "report_error_count": 0,
            "failure_count": 1,
            "failure_class_counts": {
                "failed": 1, "interrupted": 0, "no_result": 0,
                "runner_error": 0, "timed_out": 0, "unexpected_pass": 0,
            },
            "failures": [{
                "spec_id": "PW-NAV",
                "test_index": 2,
                "classification": "failed",
                "attempt_count": 1,
                "result_error_count": 1,
            }],
        }

    @staticmethod
    def _e2e_runner_stage_evidence() -> dict[str, object]:
        return {
            "schema": "nightly-e2e-runner-stage-evidence-v1",
            "source": "nightly-runner-stage-v1",
            "command_exit_code": 1,
            "outcome": "failure",
            "stage": "admission",
            "failure_class": "custody_rejected",
        }

    def test_accepts_exact_owner_only_bounded_e2e_failure_evidence(self) -> None:
        payload = self._e2e_failure_evidence()
        verifier.verify_e2e_failure_evidence(payload, 1)
        with tempfile.TemporaryDirectory() as raw:
            evidence_path = Path(raw) / "nightly-e2e-failure-evidence.json"
            evidence_path.write_text(
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            evidence_path.chmod(0o600)
            self.assertEqual(
                verifier.verify_e2e_failure_evidence_file(evidence_path, 1),
                payload,
            )

    def test_rejects_unbounded_or_free_form_e2e_failure_evidence(self) -> None:
        payload = self._e2e_failure_evidence()
        payload["title"] = "PRIVATE_FREE_FORM_MARKER"
        with self.assertRaisesRegex(SystemExit, "contract mismatch"):
            verifier.verify_e2e_failure_evidence(payload, 1)

        payload = self._e2e_failure_evidence()
        payload["failures"][0]["spec_id"] = "PW-UNTRUSTED"
        with self.assertRaisesRegex(SystemExit, "entry mismatch"):
            verifier.verify_e2e_failure_evidence(payload, 1)

        payload = self._e2e_failure_evidence()
        payload["failure_class_counts"]["failed"] = 0
        payload["failure_class_counts"]["runner_error"] = 1
        with self.assertRaisesRegex(SystemExit, "classification mismatch"):
            verifier.verify_e2e_failure_evidence(payload, 1)

    def test_accepts_only_fixed_runner_stage_evidence(self) -> None:
        payload = self._e2e_runner_stage_evidence()
        verifier.verify_e2e_failure_evidence(payload, 1)
        with tempfile.TemporaryDirectory() as raw:
            evidence_path = Path(raw) / "nightly-e2e-failure-evidence.json"
            evidence_path.write_text(
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            evidence_path.chmod(0o600)
            self.assertEqual(
                verifier.verify_e2e_failure_evidence_file(evidence_path, 1),
                payload,
            )

        for field, value in (
            ("stage", "private-stage"),
            ("failure_class", "private-class"),
            ("command_exit_code", 0),
            ("title", "PRIVATE_FREE_FORM_MARKER"),
        ):
            rejected = self._e2e_runner_stage_evidence()
            rejected[field] = value
            with self.assertRaisesRegex(SystemExit, "runner stage evidence contract mismatch"):
                verifier.verify_e2e_failure_evidence(rejected, 1)
        with self.assertRaisesRegex(SystemExit, "runner stage evidence contract mismatch"):
            verifier.verify_e2e_failure_evidence(payload, 0)
        with self.assertRaisesRegex(SystemExit, "runner stage evidence contract mismatch"):
            verifier.verify_e2e_failure_evidence(payload, True)
        for stage, failure_class in (
            ("health", "custody_rejected"),
            ("sanitize", "health_timeout"),
            ("diagnostics", "report_rejected"),
            ("cleanup", "diagnostics_rejected"),
        ):
            rejected = self._e2e_runner_stage_evidence()
            rejected["stage"] = stage
            rejected["failure_class"] = failure_class
            with self.assertRaisesRegex(SystemExit, "runner stage evidence contract mismatch"):
                verifier.verify_e2e_failure_evidence(rejected, 1)

        cleanup = self._e2e_runner_stage_evidence()
        cleanup["stage"] = "cleanup"
        cleanup["failure_class"] = "cleanup_rejected"
        verifier.verify_e2e_failure_evidence(cleanup, 1)

    def test_keeps_e2e_failure_evidence_out_of_publication(self) -> None:
        self.assertNotIn(
            "nightly-e2e-failure-evidence.json",
            verifier.load_allowlist(),
        )
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self._write_bundle(root)
            private_diagnostic = root / "nightly-e2e-failure-evidence.json"
            private_diagnostic.write_text(
                json.dumps(self._e2e_failure_evidence(), separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "unexpected publication artifacts"):
                verifier.verify(root)

    def test_readback_schema_matches_the_canonical_receipt_parser(self) -> None:
        self.assertEqual(verifier.READBACK_SECTIONS, local_migrate.READBACK_SECTIONS)
        self.assertEqual(
            verifier.READBACK_ROW_LENGTHS,
            {
                section: len(fields) + 1
                for section, fields in local_migrate.READBACK_FIELDS.items()
            },
        )

    def _current_function_source_sha256(self) -> str:
        input_manifest = json.loads(
            (
                REPOSITORY_ROOT
                / "backend"
                / "supabase"
                / "local-inputs"
                / "manifest.v1.json"
            ).read_text(encoding="utf-8")
        )
        evidence = [
            {
                "path": entry["output"],
                "sha256": entry.get("source_sha256") or entry.get("template_sha256"),
            }
            for entry in input_manifest["inputs"]
            if entry.get("output") in (
                "functions/main/index.ts", "functions/naver-geocode/index.ts",
            )
        ]
        return hashlib.sha256(verifier.canonical_json(evidence)).hexdigest()

    def test_builder_validates_private_rows_but_emits_only_counts_and_digests(self) -> None:
        manifest = local_migrate.verify_manifest()
        manifest_digest = verifier.sha256_bytes(verifier.canonical_json(manifest))
        digest = "a" * 64
        readback = [
            [section, "private@example.invalid"]
            for section in local_migrate.READBACK_SECTIONS
        ]
        sequence = [
            ["sequence", marker, ordinal, digest, manifest_digest]
            for ordinal, marker in enumerate(verifier.SEQUENCE_MARKERS, 1)
        ]
        receipt = {
            "project_name": "tzudong-local-123456abcdef",
            "commit_sha256": self.FIXTURE_GITHUB_SHA,
            "config_sha256": digest,
            "input_provenance_sha256": digest,
            "env_provenance_sha256": digest,
            "environment_contract_sha256": digest,
            "source_manifest_sha256": manifest_digest,
            "source_chain_sha256": manifest["source"]["chainSha256"],
            "seed_source_sha256": verifier.sha256_file(
                REPOSITORY_ROOT / local_migrate.SEED_SOURCE
            ),
            "function_source_sha256": digest,
            "platform_bootstrap_sha256": digest,
            "platform_bootstrap_evidence_sha256": digest,
            "prerequisite_sha256": digest,
            "closure_binding_sha256": digest,
            "ledger": [["private"]] * verifier.EXPECTED_LEDGER_UNITS,
            "ledger_sha256": digest,
            "readback": readback,
            "readback_sha256": digest,
            "readback_sql_sha256": digest,
            "catalog_sha256": digest,
            "seed_sha256": digest,
            "sequence": sequence,
            "sequence_sha256": digest,
            "service": [["service", "150008", "UTF8", "UTC"]],
            "service_sha256": digest,
        }
        fake_validator = types.SimpleNamespace(
            _load_receipt_file=lambda _path: receipt,
            verify_manifest=lambda _path: manifest,
            READBACK_SECTIONS=local_migrate.READBACK_SECTIONS,
            SEED_SOURCE=local_migrate.SEED_SOURCE,
        )
        with tempfile.TemporaryDirectory() as raw:
            state = Path(raw)
            (state / "local-receipt-v1.json").write_text(
                json.dumps(receipt, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            (state / "local-migration-manifest.json").write_text(
                json.dumps(manifest, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            with mock.patch.object(builder, "load_local_migrate", return_value=fake_validator):
                summary = builder.build_summary(state)
        serialized = json.dumps(summary, sort_keys=True, separators=(",", ":"))
        self.assertEqual(summary["readback_row_count"], len(readback))
        self.assertEqual(summary["ledger_count"], verifier.EXPECTED_LEDGER_UNITS)
        self.assertNotIn("readback", summary)
        self.assertNotIn("ledger", summary)
        self.assertNotIn("private@example.invalid", serialized)
        self.assertNotIn("@", serialized)

    def test_builder_requires_exact_tokenized_browser_evidence_path(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            repository_root = Path(raw) / "repository"
            canonical_browser = (
                repository_root
                / "apps"
                / "web"
                / "test-results"
                / "local-browser-route-diagnostics.json"
            )
            canonical_browser.parent.mkdir(parents=True)
            canonical_browser.write_text(
                json.dumps({
                    "schema": "local-browser-route-diagnostics-v1",
                    "source": "playwright-nightly-fixture",
                    "tests": [{"index": 0, "records": []}],
                    "record_count": 0,
                    "request_count": 0,
                }, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
            browser = Path(raw) / "browser.json"
            browser.write_text("{}", encoding="utf-8")
            with (
                mock.patch.object(builder, "REPOSITORY_ROOT", repository_root),
                self.assertRaisesRegex(SystemExit, "path mismatch"),
            ):
                builder.copy_safe_evidence(Path(raw), browser, Path(raw))

    def test_builder_boundary_is_exact_and_owner_only(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "publication-boundary.txt"
            builder.write_owner_only_bytes(path, builder.BOUNDARY_MARKER, "boundary")
            self.assertEqual(path.read_bytes(), verifier.BOUNDARY_MARKER)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def _write_bundle(self, root: Path) -> dict[str, dict]:
        payloads: dict[str, dict] = {}
        for name, fields in verifier.EXPECTED_FIELDS.items():
            payload = {field: None for field in fields}
            marker_key, marker_value = verifier.EXPECTED_MARKERS[name]
            payload[marker_key] = marker_value
            payloads[name] = payload

        digest = "a" * 64
        for name, action in (
            ("local-stack-reset.json", "reset"),
            ("local-stack-status.json", "status"),
        ):
            services = [
                {
                    "service": service_name,
                    "state": "running",
                    "health": (
                        ""
                        if action == "status"
                        and service_name in verifier.SERVICES_WITHOUT_DOCKER_HEALTHCHECK
                        else "healthy"
                    ),
                }
                for service_name in sorted(verifier.STACK_SERVICES)
            ]
            payloads[name].update(
                {
                    "action": action,
                    "ok": True,
                    "error_code": None,
                    "generator_version": "local-stack-v1",
                    "renderer": "v2.39.4",
                    "project_name": "tzudong-local-123456abcdef",
                    "config_sha256": digest,
                    "env_provenance_sha256": digest,
                    "input_provenance_sha256": digest,
                    "services": services,
                }
            )

        manifest = json.loads(json.dumps(local_migrate.verify_manifest()))
        files = manifest["source"]["files"]
        chain_digest = manifest["source"]["chainSha256"]
        payloads["local-migration-manifest.json"] = manifest

        external_case = {
            "rpc": "external_effect_branches",
            "class": "external",
            "status": "passed",
            "errorClass": "external_effect_blocked",
        }
        runtime = {
            "schemaVersion": "local-function-runtime-scan/v1",
            "mode": "runtime",
            "functionCount": 10,
            "localSearchPathCount": 10,
            "unresolvedPathCount": 0,
            "ambiguousPathCount": 0,
            "definerMissingSearchPathCount": 0,
            "functionMetadataDigest": digest,
            "definitionHash": digest,
            "extensionCatalogSha256": digest,
            "externalEffectBindingSha256": digest,
            "candidateResolution": {
                "candidateCount": 2,
                "resolvedCount": 2,
                "missingCount": 0,
                "ambiguousCount": 0,
            },
            "closureSmoke": {
                "status": "passed",
                "unresolvedPathCount": 0,
                "ambiguousPathCount": 0,
                "candidateMissingCount": 0,
                "candidateAmbiguousCount": 0,
            },
            "rpcSmoke": {
                "status": "passed",
                "passed": 1,
                "failed": 0,
                "ambiguous": 0,
                "cases": [external_case],
            },
            "unresolvedFunctions": [],
        }
        _, closure_metadata = function_scanner.generate_patch()
        closure_binding = function_scanner._closure_binding_sha256(
            closure_metadata,
            digest,
        )
        payloads["local-closure-rescan.json"] = {
            **runtime,
            "closureBinding": {
                "sourceManifestSha256": closure_metadata["sourceManifestSha256"],
                "toolSha256": closure_metadata["toolSha256"],
                "trustedExtensionManifestSha256": closure_metadata[
                    "trustedExtensionManifestSha256"
                ],
                "candidateSetSha256": closure_metadata["candidateSetSha256"],
                "patchSha256": closure_metadata["patchSha256"],
                "bindingSha256": closure_binding,
            },
        }
        candidate_cases = [
            {"rpc": "public.fixture_a()", "status": "passed", "errorClass": None},
            {"rpc": "public.fixture_b()", "status": "passed", "errorClass": None},
        ]
        smoke_rpc_cases = [
            external_case,
            {**candidate_cases[0], "class": "closure_candidate"},
            {**candidate_cases[1], "class": "closure_candidate"},
            {
                "rpc": "public.preview_privacy_incident_transition:service_role_guard",
                "class": "in_function_guard",
                "status": "passed",
                "errorClass": "in_function_sqlstate_P0001",
            },
        ]
        payloads["local-closure-smoke.json"] = {
            **runtime,
            "rpcSmoke": {
                "status": "passed",
                "passed": 2,
                "failed": 0,
                "ambiguous": 0,
                "cases": smoke_rpc_cases,
            },
            "candidateRpcSmoke": {
                "status": "passed",
                "candidateCount": 2,
                "passed": 2,
                "failed": 0,
                "cases": candidate_cases,
            },
        }
        payloads["local-browser-route-diagnostics.json"] = {
            "schema": "local-browser-route-diagnostics-v1",
            "source": "playwright-nightly-fixture",
            "tests": [{"index": 0, "records": []}],
            "record_count": 0,
            "request_count": 0,
        }
        payloads["local-image-pull-preflight.json"] = {
            "schema": "local-image-pull-preflight-v1",
            "image_count": len(verifier.EXPECTED_IMAGES),
            "images": [
                {"image": image, "status": "pulled", "failure_class": "none"}
                for image in sorted(verifier.EXPECTED_IMAGES)
            ],
            "container_probe": {"status": "passed", "failure_class": "none"},
            "typegen": dict(verifier.EXPECTED_TYPEGEN_IMAGE),
        }

        manifest_digest = verifier.sha256_bytes(verifier.canonical_json(manifest))
        prerequisite_sha = verifier.sha256_file(
            REPOSITORY_ROOT / local_migrate.PREREQUISITE_OUTPUT
        )
        seed_source_sha = verifier.sha256_file(
            REPOSITORY_ROOT / local_migrate.SEED_SOURCE
        )
        platform_sha = local_migrate._platform_bootstrap_sha256()
        platform_evidence = local_migrate._platform_bootstrap_evidence_sha256()
        sequence_evidence = (
            prerequisite_sha, chain_digest, digest, platform_evidence, seed_source_sha,
        )
        sequence = [
            {
                "marker": marker,
                "ordinal": ordinal,
                "evidence_sha256": sequence_evidence[ordinal - 1],
                "source_manifest_sha256": manifest_digest,
            }
            for ordinal, marker in enumerate(verifier.SEQUENCE_MARKERS, 1)
        ]
        section_counts = {section: 1 for section in verifier.READBACK_SECTIONS}
        payloads["local-migration-summary.json"].update({
            "schema": "local-migration-publication-summary-v1",
            "project_name": "tzudong-local-123456abcdef",
            "source_manifest_sha256": manifest_digest,
            "source_chain_sha256": chain_digest,
            "function_source_sha256": self._current_function_source_sha256(),
            "seed_source_sha256": seed_source_sha,
            "prerequisite_sha256": prerequisite_sha,
            "platform_bootstrap_sha256": platform_sha,
            "platform_bootstrap_evidence_sha256": platform_evidence,
            "sequence": sequence,
            "sequence_sha256": verifier.sha256_bytes(verifier.serialize_rows([
                [
                    "sequence", row["marker"], row["ordinal"],
                    row["evidence_sha256"], row["source_manifest_sha256"],
                ]
                for row in sequence
            ])),
            "closure_binding_sha256": closure_binding,
            "config_sha256": digest,
            "input_provenance_sha256": digest,
            "env_provenance_sha256": digest,
            "environment_contract_sha256": digest,
            "commit_sha256": self.FIXTURE_GITHUB_SHA,
            "ledger_count": verifier.EXPECTED_LEDGER_UNITS,
            "ledger_sha256": verifier.sha256_bytes(verifier.serialize_rows([
                [
                    "ledger", item["path"], item["ordinal"], item["sha256"],
                    item["byteLength"], item["transaction"]["class"], "applied",
                    verifier.expected_unit_evidence(item),
                ]
                for item in files
            ])),
            "readback_sql_sha256": verifier.sha256_file(
                REPOSITORY_ROOT / local_migrate.READBACK_SOURCE
            ),
            "readback_row_count": len(section_counts),
            "readback_section_counts": section_counts,
            "readback_sha256": digest,
            "catalog_sha256": digest,
            "seed_sha256": digest,
            "service": {
                "server_version_num": "150008",
                "server_encoding": "UTF8",
                "timezone": "UTC",
            },
            "service_sha256": verifier.sha256_bytes(verifier.serialize_rows([
                ["service", "150008", "UTF8", "UTC"]
            ])),
        })

        for name, payload in payloads.items():
            (root / name).write_text(
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                encoding="utf-8",
            )
        (root / "publication-boundary.txt").write_bytes(verifier.BOUNDARY_MARKER)
        return payloads

    def test_accepts_only_the_exact_healthy_sanitized_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self._write_bundle(root)
            verifier.verify(root)

    def test_accepts_action_specific_stack_health_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            payloads = self._write_bundle(Path(raw))
            reset = payloads["local-stack-reset.json"]
            status = payloads["local-stack-status.json"]

            verifier.verify_stack_receipt(reset, "local-stack-reset.json")
            verifier.verify_stack_receipt(status, "local-stack-status.json")

            reset_health = {
                service["service"]: service["health"]
                for service in reset["services"]
            }
            status_health = {
                service["service"]: service["health"]
                for service in status["services"]
            }
            for service_name in verifier.SERVICES_WITHOUT_DOCKER_HEALTHCHECK:
                self.assertEqual(reset_health[service_name], "healthy")
                self.assertEqual(status_health[service_name], "")

    def test_rejects_stack_health_from_the_other_action_projection(self) -> None:
        for name, replacement_health in (
            ("local-stack-reset.json", ""),
            ("local-stack-status.json", "healthy"),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as raw:
                payload = self._write_bundle(Path(raw))[name]
                functions = next(
                    service
                    for service in payload["services"]
                    if service["service"] == "functions"
                )
                functions["health"] = replacement_health
                with self.assertRaisesRegex(
                    SystemExit,
                    f"local stack service readiness mismatch: {name}",
                ):
                    verifier.verify_stack_receipt(payload, name)

    def test_rejects_mismatched_github_commit_binding(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            self._write_bundle(root)
            with (
                mock.patch.dict(os.environ, {"GITHUB_SHA": "c" * 40}),
                self.assertRaisesRegex(SystemExit, "commit binding mismatch"),
            ):
                verifier.verify(root)

    def test_rejects_failed_stack_receipts_before_persistence(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-stack-status.json"]["ok"] = False
            payloads["local-stack-status.json"]["error_code"] = "status_failed"
            (root / "local-stack-status.json").write_text(
                json.dumps(payloads["local-stack-status.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "success receipt contract mismatch"):
                verifier.verify(root)

    def test_rejects_nested_credential_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-migration-summary.json"]["readback_section_counts"] = [
                {"nested": [{"password": "forbidden"}]}
            ]
            (root / "local-migration-summary.json").write_text(
                json.dumps(payloads["local-migration-summary.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "credential-bearing field"):
                verifier.verify(root)

    def test_rejects_failed_runtime_smoke(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-closure-smoke.json"]["rpcSmoke"]["status"] = "failed"
            (root / "local-closure-smoke.json").write_text(
                json.dumps(payloads["local-closure-smoke.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "runtime success contract mismatch"):
                verifier.verify(root)

    def test_accepts_one_candidate_and_general_proof_for_the_same_rpc(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            smoke = payloads["local-closure-smoke.json"]["rpcSmoke"]
            candidate = next(
                case for case in smoke["cases"]
                if case["class"] == "closure_candidate"
            )
            smoke["cases"].append({
                "rpc": candidate["rpc"],
                "class": "read_only",
                "status": "passed",
                "errorClass": None,
            })
            smoke["passed"] += 1
            (root / "local-closure-smoke.json").write_text(
                json.dumps(
                    payloads["local-closure-smoke.json"],
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
            verifier.verify(root)

    def test_rejects_duplicate_rpc_proofs_within_candidate_or_general_proofs(self) -> None:
        for proof_group in ("candidate", "general"):
            with self.subTest(proof_group=proof_group):
                with tempfile.TemporaryDirectory() as raw:
                    root = Path(raw)
                    payloads = self._write_bundle(root)
                    smoke = payloads["local-closure-smoke.json"]["rpcSmoke"]
                    if proof_group == "candidate":
                        source = next(
                            case for case in smoke["cases"]
                            if case["class"] == "closure_candidate"
                        )
                        smoke["cases"].append(dict(source))
                    else:
                        smoke["cases"].extend((
                            {
                                "rpc": "public.duplicate_general_fixture()",
                                "class": "read_only",
                                "status": "passed",
                                "errorClass": None,
                            },
                            {
                                "rpc": "public.duplicate_general_fixture()",
                                "class": "mutating",
                                "status": "passed",
                                "errorClass": None,
                            },
                        ))
                        smoke["passed"] += 2
                    (root / "local-closure-smoke.json").write_text(
                        json.dumps(
                            payloads["local-closure-smoke.json"],
                            separators=(",", ":"),
                        ),
                        encoding="utf-8",
                    )
                    with self.assertRaisesRegex(SystemExit, "runtime case mismatch"):
                        verifier.verify(root)

    def test_rejects_failed_image_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-image-pull-preflight.json"]["container_probe"]["status"] = "failed"
            (root / "local-image-pull-preflight.json").write_text(
                json.dumps(payloads["local-image-pull-preflight.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "image pull preflight contract mismatch"):
                verifier.verify(root)

    def test_rejects_typegen_image_or_cli_drift(self) -> None:
        for field, replacement in (
            ("image", "supabase/postgres-meta:v0.96.7"),
            ("pull_reference", "supabase/postgres-meta@sha256:" + "0" * 64),
            ("repo_digest", "supabase/postgres-meta@sha256:" + "0" * 64),
            ("image_id", "sha256:" + "0" * 64),
            ("platform", "linux/arm64"),
            ("registry", "docker.io"),
            ("status", "not_attempted"),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                payloads = self._write_bundle(root)
                payloads["local-image-pull-preflight.json"]["typegen"][field] = replacement
                (root / "local-image-pull-preflight.json").write_text(
                    json.dumps(
                        payloads["local-image-pull-preflight.json"], separators=(",", ":"),
                    ),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    SystemExit, "image pull preflight contract mismatch",
                ):
                    verifier.verify(root)

    def test_typegen_preflight_binds_cli_ecr_digest_and_tag_readback(self) -> None:
        source = WORKFLOW_PATH.read_text(encoding="utf-8")
        step = source.split("      - name: Pull pinned Compose images\n", 1)[1].split(
            "      - name: Probe Compose container creation\n", 1,
        )[0]
        script = step.split("          python3 - <<'PY'\n", 1)[1].rsplit(
            "          PY\n", 1,
        )[0]
        script = "\n".join(
            line[10:] if line.startswith("          ") else line
            for line in script.splitlines()
        ) + "\n"

        calls: list[tuple[str, ...]] = []
        expected = verifier.EXPECTED_TYPEGEN_IMAGE
        readback = "\t".join((
            expected["image_id"],
            "linux",
            "amd64",
            json.dumps([expected["repo_digest"]], separators=(",", ":")),
            json.dumps([expected["image"]], separators=(",", ":")),
        )) + "\n"

        def run(command, **_kwargs):
            normalized = tuple(str(value) for value in command)
            calls.append(normalized)
            if normalized[1:] == ("--version",):
                return types.SimpleNamespace(returncode=0, stdout="2.109.1\n", stderr="")
            if normalized[:3] == ("docker", "image", "inspect"):
                return types.SimpleNamespace(returncode=0, stdout=readback, stderr="")
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "nightly-artifacts").mkdir()
            previous = Path.cwd()
            try:
                os.chdir(root)
                with mock.patch("subprocess.run", side_effect=run):
                    exec(compile(script, str(WORKFLOW_PATH), "exec"), {})
            finally:
                os.chdir(previous)
            receipt = json.loads(
                (root / "nightly-artifacts" / "local-image-pull-preflight.json").read_text(
                    encoding="utf-8",
                )
            )

        verifier.verify_image_preflight(receipt)
        self.assertIn(
            (
                "docker", "pull", "--quiet", "--platform", "linux/amd64",
                expected["pull_reference"],
            ),
            calls,
        )
        self.assertIn(
            ("docker", "image", "tag", expected["pull_reference"], expected["image"]),
            calls,
        )
        inspected = [call[3] for call in calls if call[:3] == ("docker", "image", "inspect")]
        self.assertEqual(inspected, [expected["pull_reference"], expected["image"]])

    def test_rejects_truncated_migration_ledger_count(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-migration-summary.json"]["ledger_count"] -= 1
            (root / "local-migration-summary.json").write_text(
                json.dumps(payloads["local-migration-summary.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "ledger count mismatch"):
                verifier.verify(root)

    def test_rejects_manifest_chain_not_derived_from_units(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-migration-manifest.json"]["source"]["chainSha256"] = "f" * 64
            (root / "local-migration-manifest.json").write_text(
                json.dumps(payloads["local-migration-manifest.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "chain digest mismatch"):
                verifier.verify(root)

    def test_rejects_incomplete_readback_even_with_recomputed_digests(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            receipt = payloads["local-migration-summary.json"]
            receipt["readback_section_counts"].pop(verifier.READBACK_SECTIONS[-1])
            receipt["readback_row_count"] -= 1
            (root / "local-migration-summary.json").write_text(
                json.dumps(receipt, separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "readback summary mismatch"):
                verifier.verify(root)

    def test_rejects_malformed_readback_partition_digest(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-migration-summary.json"]["catalog_sha256"] = "not-a-digest"
            (root / "local-migration-summary.json").write_text(
                json.dumps(payloads["local-migration-summary.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "publication summary contract mismatch"):
                verifier.verify(root)

    def test_rejects_failed_nested_rpc_case_under_passing_summary(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-closure-smoke.json"]["rpcSmoke"]["cases"][1]["status"] = "failed"
            (root / "local-closure-smoke.json").write_text(
                json.dumps(payloads["local-closure-smoke.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "runtime case mismatch"):
                verifier.verify(root)

    def test_rejects_cross_artifact_stack_identity_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-stack-status.json"]["project_name"] = "tzudong-local-fedcba654321"
            (root / "local-stack-status.json").write_text(
                json.dumps(payloads["local-stack-status.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "stack binding mismatch"):
                verifier.verify(root)

    def test_rejects_cross_artifact_closure_binding_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-closure-rescan.json"]["closureBinding"]["bindingSha256"] = "f" * 64
            (root / "local-closure-rescan.json").write_text(
                json.dumps(payloads["local-closure-rescan.json"], separators=(",", ":")),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "closure binding mismatch"):
                verifier.verify(root)

    def test_rejects_unknown_browser_diagnostic_class(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-browser-route-diagnostics.json"].update({
                "tests": [{
                    "index": 0,
                    "records": [{
                        "destination": "local-web",
                        "method": "GET",
                        "status": 200,
                        "class": "invented-class",
                        "count": 1,
                    }],
                }],
                "record_count": 1,
                "request_count": 1,
            })
            (root / "local-browser-route-diagnostics.json").write_text(
                json.dumps(
                    payloads["local-browser-route-diagnostics.json"],
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "diagnostics record mismatch"):
                verifier.verify(root)

    def test_rejects_incompatible_browser_destination_class(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            payloads = self._write_bundle(root)
            payloads["local-browser-route-diagnostics.json"].update({
                "tests": [{
                    "index": 0,
                    "records": [{
                        "destination": "third-party-provider",
                        "method": "GET",
                        "status": 0,
                        "class": "local-supabase-allowed",
                        "count": 1,
                    }],
                }],
                "record_count": 1,
                "request_count": 1,
            })
            (root / "local-browser-route-diagnostics.json").write_text(
                json.dumps(
                    payloads["local-browser-route-diagnostics.json"],
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "diagnostics record mismatch"):
                verifier.verify(root)


if __name__ == "__main__":
    unittest.main()
