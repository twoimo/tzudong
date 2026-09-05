"""Offline contract tests for the G037 session-pooler metadata receipt verifier."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "backend/supabase/scripts/g037_session_pooler_metadata_receipt.py"
CONTRACT_PATH = (
    ROOT / "backend/supabase/g037-session-pooler-metadata-receipt-contract.v1.json"
)
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CENTRAL_GATES = tuple(
    json.loads(path.read_text(encoding="utf-8"))[key]
    for path, key in (
        (
            ROOT / "backend/supabase/g037-readonly-credential-contract.v1.json",
            "provisioningGate",
        ),
        (
            ROOT / "backend/supabase/hosted-db-access-decision.v1.json",
            "controllerGate",
        ),
    )
)
SPEC = importlib.util.spec_from_file_location("g037_pooler_metadata_receipt", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def valid_receipt() -> dict[str, object]:
    receipt: dict[str, object] = {
        "schema": VERIFIER.SCHEMA,
        "status": "ready",
        "fixedCode": "g037_session_pooler_metadata_ready",
        "operationId": str(uuid.UUID("5e01895e-af9a-4acd-a76f-e2e97d4396bf")),
        "observedAt": "2026-09-04T10:45:00Z",
        "alternativePreviewSha256": VERIFIER.PREVIEW_SHA256,
        "metadataRequestSha256": VERIFIER.REQUEST_SHA256,
        "hostnameSha256": "1" * 64,
        "usernameShapeSha256": "2" * 64,
    }
    receipt.update({key: True for key in VERIFIER.TRUE_KEYS})
    receipt.update({key: False for key in VERIFIER.FALSE_KEYS})
    return receipt


class G037SessionPoolerMetadataReceiptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_receipt(
        self, receipt: dict[str, object], *, canonical: bool = True, mode: int = 0o600
    ) -> Path:
        path = self.directory / "receipt.json"
        data = (
            VERIFIER.canonical_bytes(receipt)
            if canonical
            else json.dumps(receipt, indent=2).encode("utf-8")
        )
        path.write_bytes(data)
        path.chmod(mode)
        return path

    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [os.fspath(Path(os.sys.executable)), os.fspath(SCRIPT_PATH), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_contract_and_verifier_hashes_are_exact(self) -> None:
        self.assertEqual(
            sha256(SCRIPT_PATH),
            "0b3dff6e278b48695d0672e637b582c7edb8970156af92c5fe64b8395eeadba2",
        )
        self.assertEqual(
            sha256(CONTRACT_PATH),
            "746a6c80cffd188ece7c39eb540216470154f1f09286d3e887a3836b7427fd81",
        )
        self.assertEqual(CONTRACT["verifier"]["sha256"], sha256(SCRIPT_PATH))
        for prefix in ("alternativePreview", "metadataRequest"):
            self.assertEqual(
                CONTRACT["continuity"][f"{prefix}Sha256"],
                sha256(ROOT / CONTRACT["continuity"][f"{prefix}Path"]),
            )

    def test_validate_is_network_free_and_fixed(self) -> None:
        result = self.run_cli("validate")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        output = json.loads(result.stdout)
        self.assertEqual(output["status"], "valid")
        self.assertEqual(
            output["fixedCode"], "g037_session_pooler_metadata_source_valid"
        )
        self.assertIs(output["networkAccessed"], False)
        self.assertIs(output["databaseAuthenticationAttempted"], False)
        self.assertIs(output["persistentStateChanged"], False)

    def test_central_gates_bind_source_but_claim_no_success_receipt(self) -> None:
        contract_relative = CONTRACT_PATH.relative_to(ROOT).as_posix()
        verifier_relative = SCRIPT_PATH.relative_to(ROOT).as_posix()
        for gate in CENTRAL_GATES:
            self.assertIs(gate["sessionPoolerMetadataReceiptContractPresent"], True)
            self.assertEqual(
                gate["sessionPoolerMetadataReceiptContractPath"], contract_relative
            )
            self.assertEqual(
                gate["sessionPoolerMetadataReceiptContractSha256"],
                sha256(CONTRACT_PATH),
            )
            self.assertEqual(
                gate["sessionPoolerMetadataReceiptVerifierPath"], verifier_relative
            )
            self.assertEqual(
                gate["sessionPoolerMetadataReceiptVerifierSha256"], sha256(SCRIPT_PATH)
            )
            self.assertIs(gate["sessionPoolerMetadataReceiptPresent"], False)
            self.assertIs(gate["sessionPoolerMetadataReceiptVerified"], False)
            self.assertIs(gate["sessionPoolerMetadataReadAuthorizationPresent"], True)
            self.assertEqual(gate["sessionPoolerMetadataReadConsumedCount"], 1)
            self.assertIs(gate["sessionPoolerMetadataReadRetryAllowed"], False)

    def test_exact_canonical_receipt_is_accepted_without_raw_fields(self) -> None:
        path = self.write_receipt(valid_receipt())
        expected_digest = hashlib.sha256(path.read_bytes()).hexdigest()
        result = self.run_cli("verify", "--receipt-file", os.fspath(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["status"], "ready")
        self.assertEqual(
            output["fixedCode"], "g037_session_pooler_metadata_receipt_ready"
        )
        self.assertEqual(output["receiptSha256"], expected_digest)
        self.assertEqual(set(output), set(VERIFIER.fixed_result("ready", "x", "0")))
        self.assertNotIn("operationId", output)
        self.assertNotIn("hostnameSha256", output)
        self.assertNotIn("usernameShapeSha256", output)

    def test_every_required_true_and_false_field_fails_closed(self) -> None:
        for key in sorted(VERIFIER.TRUE_KEYS):
            with self.subTest(key=key):
                receipt = valid_receipt()
                receipt[key] = False
                with self.assertRaises(VERIFIER.ReceiptError):
                    VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))
        for key in sorted(VERIFIER.FALSE_KEYS):
            with self.subTest(key=key):
                receipt = valid_receipt()
                receipt[key] = True
                with self.assertRaises(VERIFIER.ReceiptError):
                    VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))

    def test_identity_hash_time_and_exact_key_drift_fail_closed(self) -> None:
        mutations = (
            ("schema", "other"),
            ("status", "denied"),
            ("fixedCode", "other"),
            ("operationId", "not-a-uuid"),
            ("observedAt", "2026-09-04 10:45:00"),
            ("alternativePreviewSha256", "3" * 64),
            ("metadataRequestSha256", "4" * 64),
            ("hostnameSha256", "0" * 64),
            ("usernameShapeSha256", "UPPER"),
        )
        for key, value in mutations:
            with self.subTest(key=key):
                receipt = valid_receipt()
                receipt[key] = value
                with self.assertRaises(VERIFIER.ReceiptError):
                    VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))
        for operation in ("missing", "added"):
            receipt = valid_receipt()
            if operation == "missing":
                receipt.pop("regionMatched")
            else:
                receipt["password"] = "must-never-be-accepted"
            with self.subTest(operation=operation), self.assertRaises(
                VERIFIER.ReceiptError
            ):
                VERIFIER.verify_receipt(VERIFIER.canonical_bytes(receipt))

    def test_noncanonical_oversized_relative_symlink_and_open_permissions_deny(self) -> None:
        with self.assertRaises(VERIFIER.ReceiptError):
            VERIFIER.verify_receipt(json.dumps(valid_receipt(), indent=2).encode())
        relative = "receipt.json"
        with self.assertRaises(VERIFIER.ReceiptError):
            VERIFIER.secure_receipt_bytes(relative)
        permissive = self.write_receipt(valid_receipt(), mode=0o640)
        with self.assertRaises(VERIFIER.ReceiptError):
            VERIFIER.secure_receipt_bytes(os.fspath(permissive))
        target = self.directory / "target.json"
        target.write_bytes(VERIFIER.canonical_bytes(valid_receipt()))
        target.chmod(0o600)
        link = self.directory / "link.json"
        link.symlink_to(target)
        with self.assertRaises(VERIFIER.ReceiptError):
            VERIFIER.secure_receipt_bytes(os.fspath(link))
        oversized = self.directory / "oversized.json"
        oversized.write_bytes(b"x" * (VERIFIER.MAX_RECEIPT_BYTES + 1))
        oversized.chmod(0o600)
        with self.assertRaises(VERIFIER.ReceiptError):
            VERIFIER.secure_receipt_bytes(os.fspath(oversized))

    def test_denials_emit_only_fixed_result_without_injected_material(self) -> None:
        receipt = valid_receipt()
        receipt["password"] = "sensitive-injected-value"
        path = self.write_receipt(receipt)
        result = self.run_cli("verify", "--receipt-file", os.fspath(path))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("sensitive-injected-value", result.stdout)
        output = json.loads(result.stdout)
        self.assertEqual(output["status"], "denied")
        self.assertEqual(
            output["fixedCode"], "g037_session_pooler_metadata_receipt_denied"
        )
        self.assertNotIn("receiptSha256", output)

    def test_argument_surface_is_only_validate_or_one_absolute_receipt(self) -> None:
        denied = self.run_cli("validate", "--receipt-file", "/tmp/unread")
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(
            json.loads(denied.stdout)["fixedCode"],
            "g037_session_pooler_metadata_argument_denied",
        )
        missing = self.run_cli("verify")
        self.assertEqual(missing.returncode, 2)
        self.assertEqual(
            json.loads(missing.stdout)["fixedCode"],
            "g037_session_pooler_metadata_argument_denied",
        )


if __name__ == "__main__":
    unittest.main()
