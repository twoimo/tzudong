import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
VERIFIER_PATH = (
    REPOSITORY_ROOT / ".github" / "scripts" / "verify-nightly-local-publication.py"
)
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


class LocalPublicationVerifierTests(unittest.TestCase):
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
            "commit_sha256": "b" * 40,
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

        services = [
            {
                "service": name,
                "state": "running",
                "health": "" if name in verifier.SERVICES_WITHOUT_DOCKER_HEALTHCHECK else "healthy",
            }
            for name in sorted(verifier.STACK_SERVICES)
        ]
        digest = "a" * 64
        for name, action in (
            ("local-stack-reset.json", "reset"),
            ("local-stack-status.json", "status"),
        ):
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
            "commit_sha256": "b" * 40,
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
