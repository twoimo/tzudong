from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable


REPO_ROOT = Path(__file__).resolve().parents[3]
CHECKER_PATH = REPO_ROOT / "backend" / "bin" / "check_g002_external_package.py"
POLICY_PATH = REPO_ROOT / "backend" / "fixtures" / "g002-external-package" / "required-artifacts.v1.json"

_spec = importlib.util.spec_from_file_location("check_g002_external_package", CHECKER_PATH)
assert _spec is not None and _spec.loader is not None
checker = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = checker
_spec.loader.exec_module(checker)


CLASSES = list(checker.POLICY["canonicalClasses"])
INVENTORY_NAME = checker.INVENTORY_NAME
SUBJECT_DIGEST = "2" * 64
REQUEST_DIGEST = "1" * 64
NOT_BEFORE = "2026-01-01T00:00:00Z"
EXPIRES_AT = "2026-01-01T01:00:00Z"


def _json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _common(evidence_class: str, *, issued_at: str = "2026-01-01T00:05:00Z") -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "class": evidence_class,
        "packageId": "pkg:external-package",
        "actionId": "action:deploy",
        "requestDigest": REQUEST_DIGEST,
        "subjectDigest": SUBJECT_DIGEST,
        "targetId": "target:protected",
        "issuedAt": issued_at,
    }


def _documents() -> dict[str, dict[str, Any]]:
    return {
        CLASSES[0]: {
            **_common(CLASSES[0]),
            "rootReferenceId": "rootref:release",
            "rootReferenceType": "organization_key_registry",
            "rootFingerprint": "3" * 64,
            "registrySnapshotDigest": "4" * 64,
            "keyId": "keyref:release",
            "keyStatus": "active",
            "algorithm": "Ed25519",
            "signedSubjectDigest": SUBJECT_DIGEST,
            "verifierReceiptDigest": "5" * 64,
        },
        CLASSES[1]: {
            **_common(CLASSES[1]),
            "verifierId": "verifier:primary",
            "verifierVersion": 1,
            "algorithm": "HMAC-SHA256",
            "keyReferenceId": "keyref:hmac",
            "keyProviderReferenceId": "keyref:provider",
            "verifiedSubjectDigest": SUBJECT_DIGEST,
            "verificationOutcome": "claimed_verified",
            "verifierReceiptDigest": "6" * 64,
            "keyMaterialIncluded": False,
        },
        CLASSES[2]: {
            **_common(CLASSES[2]),
            "providerId": "provider:primary",
            "deploymentId": "deployment:protected",
            "environmentId": "environment:protected",
            "targetClass": "protected_target",
            "componentDigests": {"application": "7" * 64},
            "measurementMechanism": "provider_attestation",
            "attestationReferenceId": "attest:primary",
            "attestationDigest": "8" * 64,
            "capturedAt": "2026-01-01T00:10:00Z",
        },
        CLASSES[3]: {
            **_common(CLASSES[3]),
            "eventId": "event:power-loss",
            "eventType": "power_loss",
            "acceptedAt": "2026-01-01T00:15:00Z",
            "committedAt": "2026-01-01T00:16:00Z",
            "observedAt": "2026-01-01T00:17:00Z",
            "durableStoreId": "store:primary",
            "recordId": "record:one",
            "observationReceiptDigest": "9" * 64,
            "observerReferenceId": "observer:external",
            "simulation": False,
            "replay": False,
        },
        CLASSES[4]: {
            **_common(CLASSES[4], issued_at=NOT_BEFORE),
            "issuerReferenceId": "issuer:operator",
            "principalId": "principal:release",
            "audience": checker.POLICY["audience"],
            "grantedScopes": list(checker.POLICY["requiredScopes"]),
            "authorizationFingerprint": "a" * 64,
            "expiresAt": EXPIRES_AT,
            "authorizationReceiptDigest": "b" * 64,
        },
    }


def _write_package(
    root: Path,
    *,
    mutate_documents: Callable[[dict[str, dict[str, Any]]], None] | None = None,
    mutate_inventory: Callable[[dict[str, Any]], None] | None = None,
    synthetic: bool = False,
) -> tuple[dict[str, Any], dict[str, Path]]:
    docs = _documents()
    if mutate_documents is not None:
        mutate_documents(docs)
    paths: dict[str, Path] = {}
    entries: list[dict[str, Any]] = []
    for index, evidence_class in enumerate(CLASSES, start=1):
        filename = f"artifact-{index}.json"
        raw = _json_bytes(docs[evidence_class])
        path = root / filename
        path.write_bytes(raw)
        paths[evidence_class] = path
        entries.append(
            {
                "class": evidence_class,
                "path": filename,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "sizeBytes": len(raw),
            }
        )
    inventory: dict[str, Any] = {
        "schemaVersion": 1,
        "packageId": "pkg:external-package",
        "synthetic": synthetic,
        "nonEvidenceLabel": checker.SYNTHETIC_LABEL if synthetic else None,
        "actionBinding": {
            "actionId": "action:deploy",
            "requestDigest": REQUEST_DIGEST,
            "subjectDigest": SUBJECT_DIGEST,
            "targetId": "target:protected",
            "audience": checker.POLICY["audience"],
            "requiredScopes": list(checker.POLICY["requiredScopes"]),
            "notBefore": NOT_BEFORE,
            "expiresAt": EXPIRES_AT,
        },
        "entries": entries,
    }
    if mutate_inventory is not None:
        mutate_inventory(inventory)
    (root / INVENTORY_NAME).write_bytes(_json_bytes(inventory))
    return inventory, paths


def _codes(report: dict[str, Any]) -> set[str]:
    return {row["code"] for row in report["diagnostics"]}


class G002ExternalPackageVerifierTests(unittest.TestCase):
    def verify(self, root: Path, **kwargs: Any) -> tuple[dict[str, Any], int]:
        return checker.verify(
            root,
            max_files=kwargs.get("max_files", 32),
            max_file_bytes=kwargs.get("max_file_bytes", 1_048_576),
            max_total_bytes=kwargs.get("max_total_bytes", 8_388_608),
            checked_at=kwargs.get("checked_at"),
        )

    def test_policy_file_is_exact_closed_non_authenticating_contract(self) -> None:
        policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(policy, checker.POLICY)
        self.assertFalse(policy["canEstablishAuthenticity"])
        self.assertEqual(policy["exitCodes"], {"empty": 1, "locally_consistent_unverified": 1, "invalid": 2})

    def test_empty_inbox_is_expected_non_success(self) -> None:
        with TemporaryDirectory() as tmp:
            report, code = self.verify(Path(tmp))
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "empty")
        self.assertEqual(_codes(report), {"G002_EMPTY_INBOX"})

    def test_complete_packet_is_only_locally_consistent_unverified(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root)
            report, code = self.verify(root, checked_at="2026-01-01T00:30:00Z")
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "locally_consistent_unverified")
        self.assertEqual(report["terminal"], "LOCAL_QUALIFIED_ONLY")
        self.assertEqual(report["satisfies"], [])
        self.assertEqual(report["doesNotCompleteOrUnblock"], ["G002", "G003", "aggregate"])
        self.assertEqual(len(report["classResults"]), 5)
        self.assertEqual(report["diagnostics"], [])
        self.assertNotIn("qualified", {report["status"]})

    def test_subprocess_output_is_deterministic_and_redacted(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root)
            argv = [sys.executable, "-B", str(CHECKER_PATH), "--inbox", str(root), "--checked-at", "2026-01-01T00:30:00Z"]
            first = subprocess.run(argv, cwd=REPO_ROOT, capture_output=True, check=False)
            second = subprocess.run(argv, cwd=REPO_ROOT, capture_output=True, check=False)
        self.assertEqual(first.returncode, 1)
        self.assertEqual(first.stdout, second.stdout)
        self.assertEqual(first.stderr, b"")
        self.assertNotIn(str(root).encode(), first.stdout)
        self.assertNotIn(b"authenticity-bearing", first.stdout)

    def test_missing_inventory_in_nonempty_inbox_is_invalid(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "extra.json").write_text("{}\n", encoding="utf-8")
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertIn("G002_INVENTORY_MISSING", _codes(report))

    def test_exact_fileset_rejects_extra_file_and_directory(self) -> None:
        for make_extra in (
            lambda root: (root / "extra.json").write_text("{}\n", encoding="utf-8"),
            lambda root: (root / "extra-dir").mkdir(),
        ):
            with self.subTest(make_extra=make_extra):
                with TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    _write_package(root)
                    make_extra(root)
                    report, code = self.verify(root)
                self.assertEqual(code, 2)
                self.assertIn("G002_FILESET_MISMATCH", _codes(report))

    def test_inventory_path_must_be_single_component(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root, mutate_inventory=lambda value: value["entries"][0].__setitem__("path", "nested/artifact.json"))
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertIn("G002_PATH_INVALID", _codes(report))

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_leaf_symlink_is_rejected_without_reading_target(self) -> None:
        with TemporaryDirectory() as tmp, TemporaryDirectory() as outside_tmp:
            root = Path(tmp)
            _, paths = _write_package(root)
            victim = paths[CLASSES[0]]
            victim.unlink()
            outside = Path(outside_tmp) / "secret.json"
            outside.write_text('{"SECRET":"must-not-leak"}\n', encoding="utf-8")
            os.symlink(outside, victim)
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertIn("G002_FILE_UNSAFE", _codes(report))
        self.assertNotIn("must-not-leak", json.dumps(report))

    def test_synthetic_packet_is_always_invalid(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root, synthetic=True)
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertIn("G002_SYNTHETIC_NON_EVIDENCE", _codes(report))

    def test_closed_schema_rejects_key_material_field_without_echoing_value(self) -> None:
        secret = "-----BEGIN " + "PRIVATE KEY-----never-echo"

        def mutate(docs: dict[str, dict[str, Any]]) -> None:
            docs[CLASSES[1]]["secret"] = secret

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root, mutate_documents=mutate)
            report, code = self.verify(root)
        rendered = json.dumps(report)
        self.assertEqual(code, 2)
        self.assertIn("G002_SCHEMA_FIELD", _codes(report))
        self.assertNotIn(secret, rendered)

    def test_forbidden_jwt_shape_in_typed_reference_is_rejected(self) -> None:
        def mutate(docs: dict[str, dict[str, Any]]) -> None:
            docs[CLASSES[1]]["verifierId"] = "aaa.bbb.ccc"

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root, mutate_documents=mutate)
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertTrue(_codes(report) & {"G002_TYPE_OR_RANGE", "G002_FORBIDDEN_VALUE_SHAPE"})

    def test_local_target_simulation_scope_and_time_fail_closed(self) -> None:
        mutations: list[tuple[str, Callable[[dict[str, dict[str, Any]]], None], str]] = [
            ("local target", lambda docs: docs[CLASSES[2]].__setitem__("targetClass", "local"), "G002_LOCAL_TARGET"),
            ("simulation", lambda docs: docs[CLASSES[3]].__setitem__("simulation", True), "G002_SIMULATION"),
            ("scope", lambda docs: docs[CLASSES[4]].__setitem__("grantedScopes", ["g038:deploy"]), "G002_SCOPE_INVALID"),
            ("time", lambda docs: docs[CLASSES[3]].__setitem__("observedAt", "2025-12-31T23:00:00Z"), "G002_TIME_INVALID"),
        ]
        for label, mutate, expected in mutations:
            with self.subTest(label=label):
                with TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    _write_package(root, mutate_documents=mutate)
                    report, code = self.verify(root)
                self.assertEqual(code, 2)
                self.assertIn(expected, _codes(report))

    def test_cross_binding_and_signature_subject_mismatch_reject(self) -> None:
        mutations = [
            lambda docs: docs[CLASSES[0]].__setitem__("actionId", "action:other"),
            lambda docs: docs[CLASSES[0]].__setitem__("signedSubjectDigest", "c" * 64),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                with TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    _write_package(root, mutate_documents=mutate)
                    report, code = self.verify(root)
                self.assertEqual(code, 2)
                self.assertIn("G002_BINDING_MISMATCH", _codes(report))

    def test_embedded_root_fingerprint_rejects(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs = _documents()
            hmac_raw = _json_bytes(docs[CLASSES[1]])
            embedded = hashlib.sha256(hmac_raw).hexdigest()
            _write_package(root, mutate_documents=lambda value: value[CLASSES[0]].__setitem__("rootFingerprint", embedded))
            report, code = self.verify(root)
        self.assertEqual(code, 2)
        self.assertIn("G002_ROOT_EMBEDDED", _codes(report))

    def test_duplicate_json_key_and_invalid_utf8_reject(self) -> None:
        payloads = [b'{"schemaVersion":1,"schemaVersion":1}\n', b"\xff\xfe"]
        expected = ["G002_DUPLICATE_KEY", "G002_JSON_INVALID"]
        for raw, code_name in zip(payloads, expected):
            with self.subTest(code=code_name):
                with TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    _write_package(root)
                    (root / INVENTORY_NAME).write_bytes(raw)
                    report, code = self.verify(root)
                self.assertEqual(code, 2)
                self.assertIn(code_name, _codes(report))

    def test_file_and_total_byte_limits_reject(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root)
            report, code = self.verify(root, max_file_bytes=32)
            self.assertEqual(code, 2)
            self.assertIn("G002_FILE_UNSAFE", _codes(report))
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root)
            report, code = self.verify(root, max_total_bytes=64)
            self.assertEqual(code, 2)
            self.assertIn("G002_LIMIT_EXCEEDED", _codes(report))

    def test_output_inside_inbox_or_existing_output_fails(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_package(root)
            inside = subprocess.run(
                [sys.executable, "-B", str(CHECKER_PATH), "--inbox", str(root), "--output", str(root / "report.json")],
                cwd=REPO_ROOT,
                capture_output=True,
                check=False,
            )
            outside = root.parent / f"{root.name}-existing-report.json"
            outside.write_text("existing\n", encoding="utf-8")
            try:
                existing = subprocess.run(
                    [sys.executable, "-B", str(CHECKER_PATH), "--inbox", str(root), "--output", str(outside)],
                    cwd=REPO_ROOT,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(outside.read_text(encoding="utf-8"), "existing\n")
            finally:
                outside.unlink(missing_ok=True)
        self.assertEqual(inside.returncode, 2)
        self.assertEqual(existing.returncode, 2)
        self.assertIn(b"G002_OUTPUT_FAILURE", inside.stdout)
        self.assertIn(b"G002_OUTPUT_FAILURE", existing.stdout)

    def test_cli_rejects_out_of_range_limits(self) -> None:
        result = subprocess.run(
            [sys.executable, "-B", str(CHECKER_PATH), "--inbox", ".", "--max-files", "5"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"expected 6..64", result.stderr)


if __name__ == "__main__":
    unittest.main()
