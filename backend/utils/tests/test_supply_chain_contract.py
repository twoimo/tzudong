"""Read-only supply-chain source contracts for the orchestration recovery."""

from __future__ import annotations

import json
import re
import subprocess
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web"

AUDITED_REQUIREMENTS = (
    "backend/test-requirements.txt",
    "backend/pipeline/requirements.txt",
    "backend/restaurant-crawling/scripts/requirements.txt",
    "backend/supabase/scripts/g037-hosted-closure-requirements.txt",
    "backend/pipeline-control/requirements.txt",
)

BASE_DEPENDENCY_UNITS = (
    ("github-actions", "/"),
    ("npm", "/apps/web"),
    ("npm", "/backend"),
    ("pip", "/backend/pipeline"),
    ("pip", "/backend/restaurant-crawling/scripts"),
    ("pip", "/backend/pipeline-control"),
)

PINNED_CONTAINER_SOURCES = (
    "backend/pipeline-control/Dockerfile",
    "backend/pipeline-control/docker-compose.kafka.yml",
    "backend/pipeline-control/docker-compose.observability.yml",
    "backend/pipeline-control/docker-compose.elasticsearch.yml",
    ".github/workflows/daily-crawler.yml",
)

EXACT_REQUIREMENT = re.compile(r"^[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?==[^\s\\]+(?:\s*\\)?$")
VERSIONED_IMAGE = re.compile(
    r"^(?:[a-z0-9.-]+(?::[0-9]+)?/)*[a-z0-9._-]+"
    r"(?::(?:v?[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[-._][A-Za-z0-9.-]+)?))?"
    r"(?:@sha256:[0-9a-f]{64})?$"
)


def _logical_requirement_lines(source: str) -> list[str]:
    logical: list[str] = []
    current = ""
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if current:
            current = f"{current} {line}"
        else:
            current = line
        if current.endswith("\\"):
            current = current[:-1].rstrip()
            continue
        logical.append(current)
        current = ""
    if current:
        logical.append(current)
    return logical


def _image_refs(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    refs = re.findall(r"^\s*image:\s*([^\s#]+)", source, flags=re.MULTILINE)
    refs += re.findall(r"^FROM\s+([^\s]+)", source, flags=re.MULTILINE)
    return [ref for ref in refs if ref not in {"base"}]


class SupplyChainContractTests(unittest.TestCase):
    def test_security_audit_covers_only_exact_python_requirements(self) -> None:
        workflow = (ROOT / ".github/workflows/security-audit.yml").read_text(encoding="utf-8")
        for relative in AUDITED_REQUIREMENTS:
            self.assertIn(relative, workflow)
            for requirement in _logical_requirement_lines((ROOT / relative).read_text(encoding="utf-8")):
                package = requirement.split("==", 1)[0]
                self.assertRegex(requirement.split(" --hash=", 1)[0], EXACT_REQUIREMENT, package)
                if " --hash=" in requirement:
                    tokens = re.findall(r"--hash=([^\s]+)", requirement)
                    digests = re.findall(r"--hash=sha256:([0-9a-f]+)", requirement)
                    self.assertEqual(len(tokens), len(digests), package)
                    self.assertTrue(digests, package)
                    for digest in digests:
                        self.assertEqual(len(digest), 64, package)

    def test_nullable_cas_migration_alone_triggers_its_real_postgres_suite(self) -> None:
        import fnmatch
        import yaml
        workflow = yaml.safe_load((ROOT / '.github/workflows/security-audit.yml').read_text())
        event = workflow.get('on', workflow.get(True))
        migration = 'backend/supabase/migrations/20260905015816_publication_nullable_trace_cas.sql'
        self.assertTrue(any(fnmatch.fnmatchcase(migration, pattern)
                            for pattern in event['pull_request']['paths']))
        job = workflow['jobs']['orchestration-readiness']
        self.assertNotIn('if', job)
        self.assertTrue(any('backend.pipeline_control.test_publication_cas_postgres' in step.get('run', '')
                            for step in job['steps']))

    def test_pin_contract_is_read_only_and_has_six_closed_items(self) -> None:
        verifier = (WEB / "scripts/verify-pin-contract.mjs").read_text(encoding="utf-8")
        for forbidden in ("writeFile", "appendFile", "unlink", "truncate", "rmSync"):
            self.assertNotIn(forbidden, verifier)
        for item in (
            "npm",
            "node",
            "typescript_native_alias",
            "typescript_compat_bridge",
            "package_json",
            "package_lock_json",
        ):
            self.assertIn(f"item: '{item}'", verifier)

        manifest = json.loads((WEB / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((WEB / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["packageManager"], "npm@11.6.2")
        self.assertEqual(manifest["engines"]["node"], "24.x")
        self.assertEqual(manifest["devDependencies"]["@typescript/native"], "npm:typescript@7.0.2")
        self.assertEqual(manifest["devDependencies"]["typescript"], "npm:@typescript/typescript6@6.0.2")
        self.assertEqual(lock["packages"]["node_modules/@typescript/native"]["version"], "7.0.2")
        self.assertEqual(lock["packages"]["node_modules/typescript"]["version"], "6.0.2")

    def test_pin_contract_runtime_result_is_bounded_and_environment_honest(self) -> None:
        result = subprocess.run(
            ["node", "scripts/verify-pin-contract.mjs"],
            cwd=WEB,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.stdout:
            receipt = json.loads(result.stdout.strip())
            self.assertIn(receipt["status"], {"passed", "failed"})
            self.assertIn(receipt["code"], {None, "pin_contract_drift"})
            self.assertEqual(len(receipt["pinContract"]), 6)
            self.assertEqual(
                receipt["status"] == "passed",
                all(item["match"] for item in receipt["pinContract"])
                and receipt["typecheck"]["match"]
                and receipt["lockReconciliation"]["mismatchCount"] == 0,
            )
            self.assertEqual(result.returncode, 0 if receipt["status"] == "passed" else 1)
        else:
            self.assertEqual(result.returncode, 1)
            self.assertIn("global_compiler_not_admitted", result.stderr)

    def test_dependabot_has_base_units_and_conditional_cargo(self) -> None:
        document = yaml.safe_load((ROOT / ".github/dependabot.yml").read_text(encoding="utf-8"))
        updates = document["updates"]
        actual = tuple((item["package-ecosystem"], item["directory"]) for item in updates)
        self.assertTrue(all(item["target-branch"] == "develop" for item in updates))
        self.assertTrue(all(item["open-pull-requests-limit"] <= 5 for item in updates))
        cargo_manifests = tuple(ROOT.glob("backend/rust/**/Cargo.toml"))
        expected = BASE_DEPENDENCY_UNITS + (
            (("cargo", "/backend/rust"),) if cargo_manifests else ()
        )
        self.assertEqual(actual, expected)
        self.assertTrue(cargo_manifests)
        self.assertIn(("cargo", "/backend/rust"), actual)

    def test_next_family_matches_the_declared_dependabot_hold(self) -> None:
        manifest = json.loads((WEB / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((WEB / "package-lock.json").read_text(encoding="utf-8"))
        for package in ("next", "@next/bundle-analyzer", "eslint-config-next"):
            declared = manifest.get("dependencies", {}).get(package) or manifest["devDependencies"][package]
            self.assertIn("16.2.12", declared)
            self.assertEqual(lock["packages"][f"node_modules/{package}"]["version"], "16.2.12")
        dependabot = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
        self.assertEqual(dependabot.count('          - ">=16.3.0"'), 3)

    def test_owned_container_references_are_versioned_or_digest_pinned(self) -> None:
        for relative in PINNED_CONTAINER_SOURCES:
            refs = _image_refs(ROOT / relative)
            self.assertTrue(refs, relative)
            for ref in refs:
                self.assertNotIn(ref, {"latest", "minio/minio", "minio/mc"}, relative)
                self.assertRegex(ref, VERSIONED_IMAGE, f"{relative}: {ref}")
                image_name = ref.split("@", 1)[0].rsplit("/", 1)[-1]
                self.assertTrue(
                    "@sha256:" in ref or ":" in image_name,
                    f"{relative}: unversioned image {ref}",
                )
                self.assertNotRegex(ref, r":(?:latest|stable|main|master|edge)$")

    def test_daily_postgres_service_uses_existing_repository_digest(self) -> None:
        daily = (ROOT / ".github/workflows/daily-crawler.yml").read_text(encoding="utf-8")
        admin = (ROOT / ".github/workflows/web-admin-ci.yml").read_text(encoding="utf-8")
        match = re.search(r"image:\s*(postgres@sha256:[0-9a-f]{64})", admin)
        self.assertIsNotNone(match)
        self.assertIn(f"image: {match.group(1)}", daily)

    def test_security_ci_qualifies_the_recovered_rust_workspace(self) -> None:
        workflow = (ROOT / ".github/workflows/security-audit.yml").read_text(
            encoding="utf-8"
        )
        for required in (
            "rust-recovery:",
            "rustup toolchain install 1.97.0 --profile minimal --component rustfmt",
            "cargo fmt --manifest-path backend/rust/Cargo.toml --all -- --check",
            "cargo test --manifest-path backend/rust/Cargo.toml --locked",
            "maturin==1.15.0 hypothesis==6.165.10",
            'VIRTUAL_ENV="$RUNNER_TEMP/rust-parity"',
            'import tzudong_validators; assert tzudong_validators.__file__',
            "backend.rust.tests.parity_pbt backend.rust.tests.parity_error_pbt",
            "fetch-depth: 0",
            "backend.utils.tests.test_operational_source_recovery",
            "backend.utils.tests.test_platform_modernization_reconciliation",
            "backend.bin.tests.test_check_local_runtime_unittest",
            "backend.bin.tests.test_schema_mirror_report_unittest",
            "backend.bin.tests.test_seed_fixture_guard_unittest",
            "backend.pipeline_control.test_local_pipeline_composition_unittest",
            "backend.pipeline_control.test_step_composition_pbt",
            "backend.pipeline_control.tests.test_es_index",
            "bun-version: '1.4.0'",
            "backend.bin.tests.test_tooling_gate_unittest",
            "backend.pipeline_control.test_tooling_selection_unittest",
            "apps/web/tests-unit/dependency-freshness-workflow.test.ts",
            "apps/web/tests-unit/supabase-entrypoint-source.test.ts",
            "backend.pipeline_control.test_agent_boundary_pbt",
            "backend.pipeline_control.test_log_redaction_pbt",
            "backend.pipeline_control.test_migration_readiness_unittest",
            "backend.utils.tests.test_publication_source_recovery",
            "backend.pipeline_control.test_publication_adapter_unittest",
            "backend.pipeline_control.test_publish_apply_unittest",
            "backend.pipeline_control.test_publish_batch_pbt",
            "backend.pipeline_control.test_publish_codes_pbt",
            "backend.pipeline_control.test_publish_hash_pbt",
            "backend.pipeline_control.test_publish_idempotency_pbt",
            "backend.pipeline_control.test_publish_payload_pbt",
            "backend.pipeline_control.test_publish_readback_pbt",
            "backend.pipeline_control.tests.test_batch_upsert_publication_allowlist",
            "backend.supabase.tests.test_local_compose_inputs",
            "bun test apps/web/tests-unit/publish-jobs-request-contract.test.ts",
            "backend.utils.tests.test_phase_gate_source_recovery",
            "backend.bin.tests.test_phase_gate_unittest",
            "backend.bin.tests.test_run_p1_gate_unittest",
            "backend.bin.tests.test_run_p7_gate_unittest",
            "backend.pipeline_control.test_phase_partition_pbt",
            "backend.pipeline_control.test_rollback_plan_pbt",
        ):
            self.assertIn(required, workflow)
        self.assertNotIn("continue-on-error: true", workflow)


if __name__ == "__main__":
    unittest.main()
