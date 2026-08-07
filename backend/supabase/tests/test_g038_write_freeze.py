from __future__ import annotations

import hashlib
import os
import socket
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_write_freeze as freeze
from g038_successor_contract import canonical_json_bytes

H = "a" * 64


def assertion(now: int = 1000) -> dict[str, object]:
    channels = {
        name: {"status": "stopped", "active_writers": 0, "evidence_sha256": H, "observed_at": now - 1}
        for name in freeze.RESIDUAL_CHANNELS
    }
    return {
        "schema": freeze.SCHEMA, "freeze_id": "g038-freeze-0001", "source_commit": "b" * 40,
        "runtime_source_root": H, "manifest_root": H,
        "predecessor_report_sha256": freeze.PREDECESSOR_REPORT_SHA256,
        "target_fingerprint": freeze.TARGET_FINGERPRINT,
        "starting_roots": {name: H for name in ("ledger", "catalog", "acl", "data", "spec")},
        "relation_root": H, "acl_root": H, "inventory_root": H,
        "issued_at": now, "expires_at": now + 600, "residual_channels": channels,
        "scoped_operations": list(freeze.SCOPED_OPERATIONS), "github_variable_toggled": False,
        "signature_b64": "AA==",
    }


def signed_monitor_response(
        now: int = 1000, *, checkpoint: str = "precommit", continuity_epoch: int = 900):
    channels = {name: {"status": "stopped", "active_writers": 0,
        "evidence_sha256": H, "observed_at": now} for name in freeze.RESIDUAL_CHANNELS}
    request = {
        "schema": freeze.MONITOR_REQUEST_SCHEMA, "challenge": "b" * 64,
        "checkpoint": checkpoint, "continuity_epoch": continuity_epoch,
        "requested_at": now, "deadline": now + 30,
        "source_commit": "b" * 40, "runtime_source_root": H,
        "target_fingerprint": freeze.TARGET_FINGERPRINT, "freeze_root": H,
        "authorization_sha256": H, "attempt_receipt_sha256": H,
        "prepared_receipt_sha256": H, "executor_evidence_sha256": H,
        "state_sha256": H, "parent_evidence_sha256": H,
    }
    request["request_sha256"] = hashlib.sha256(canonical_json_bytes(request)).hexdigest()
    response = {**request, "schema": freeze.MONITOR_RESPONSE_SCHEMA,
        "observed_at": now, "expires_at": now + 20,
        "residual_channels": channels, "no_active_writers": True,
        "all_residual_channels_stopped": True, "freeze_continuity_maintained": True,
        "worker_state_sha256": hashlib.sha256(canonical_json_bytes(channels)).hexdigest()}
    response["signature_b64"] = "AA=="
    return request, response


class WriteFreezeTests(unittest.TestCase):
    def validate(self, value, now=1000):
        freeze._validate_payload(value, source_commit="b" * 40, runtime_source_root=H,
            manifest_root=H, starting_roots={name: H for name in ("ledger", "catalog", "acl", "data", "spec")}, now=now)

    def test_exact_scope_stops_all_channels_and_never_toggles_github_variable(self):
        value = assertion(); self.validate(value)
        for malformed in (
            {**value, "scoped_operations": [*freeze.SCOPED_OPERATIONS, "general_producer"]},
            {**value, "github_variable_toggled": True},
            {**value, "residual_channels": {key: item for key, item in value["residual_channels"].items() if key != "producer_stop"}},
        ):
            with self.assertRaises(freeze.FreezeError): self.validate(malformed)

    def test_active_writer_stale_evidence_and_expired_freeze_fail_closed(self):
        for mutate, now in ((lambda value: value["residual_channels"]["producer_stop"].update(active_writers=1), 1000),
                            (lambda value: value["residual_channels"]["producer_stop"].update(observed_at=1), 1000),
                            (lambda value: value.update(expires_at=1000), 1000)):
            value = assertion(); mutate(value)
            with self.assertRaises(freeze.FreezeError): self.validate(value, now)

    def test_wrong_source_target_or_authorization_key_is_denied(self):
        value = assertion()
        for key, replacement in (("source_commit", "c" * 40), ("target_fingerprint", H), ("predecessor_report_sha256", H)):
            changed = dict(value); changed[key] = replacement
            with self.assertRaises(freeze.FreezeError): self.validate(changed)
        with patch.object(freeze, "PUBLIC_KEY_SHA256", "0" * 64), self.assertRaisesRegex(freeze.FreezeError, "freeze_signature"):
            freeze.verify_freeze_assertion(value, source_commit="b" * 40, runtime_source_root=H,
                manifest_root=H, starting_roots=value["starting_roots"], now=1000)

    def test_monitor_response_is_fresh_exact_and_challenge_bound(self):
        request, response = signed_monitor_response()
        with patch.object(freeze, "_verify_monitor_signature"):
            freeze._verify_checkpoint_response(response, request, now=1000, require_fresh=True)
            for change in (
                {"challenge": "c" * 64},
                {"observed_at": 994},
                {"parent_evidence_sha256": "d" * 64},
                {"continuity_epoch": 901},
            ):
                replay = {**response, **change}
                replay["signature_b64"] = response["signature_b64"]
                with self.assertRaises(freeze.FreezeError):
                    freeze._verify_checkpoint_response(replay, request, now=1000, require_fresh=True)
            invalid_request = dict(request)
            invalid_request["continuity_epoch"] = 0
            invalid_request["request_sha256"] = hashlib.sha256(canonical_json_bytes(
                {key: item for key, item in invalid_request.items() if key != "request_sha256"}
            )).hexdigest()
            with self.assertRaisesRegex(freeze.FreezeError, "monitor_request"):
                freeze._verify_checkpoint_response(
                    {**response, "continuity_epoch": 0,
                     "request_sha256": invalid_request["request_sha256"]},
                    invalid_request, now=1000, require_fresh=True)

    def test_monitor_restart_or_epoch_change_fails_every_checkpoint_boundary(self):
        for checkpoint in freeze.CHECKPOINTS:
            request, response = signed_monitor_response(checkpoint=checkpoint)
            with patch.object(freeze, "_verify_monitor_signature"):
                freeze._verify_checkpoint_response(
                    response, request, now=1000, require_fresh=True)
                for epoch in (request["continuity_epoch"] - 1,
                              request["continuity_epoch"] + 1):
                    restarted = {**response, "continuity_epoch": epoch}
                    with self.assertRaisesRegex(freeze.FreezeError, "monitor_"):
                        freeze._verify_checkpoint_response(
                            restarted, request, now=1000, require_fresh=True)

    def test_monitor_denies_active_writer_even_with_valid_signature(self):
        request, response = signed_monitor_response()
        response["residual_channels"]["producer_stop"]["active_writers"] = 1
        with patch.object(freeze, "_verify_monitor_signature"), \
                self.assertRaisesRegex(freeze.FreezeError, "monitor_channels"):
            freeze._verify_checkpoint_response(response, request, now=1000, require_fresh=True)

    def test_monitor_socket_and_checkpoint_paths_require_external_owner_only_custody(self):
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw); os.chmod(base, 0o700)
            repository = base / "checkout"; repository.mkdir(mode=0o700)
            external = base / "external"; external.mkdir(mode=0o700)
            socket_path = external / "monitor.sock"
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                server.bind(str(socket_path)); os.chmod(socket_path, 0o600)
                self.assertEqual(
                    freeze._socket_path(socket_path, repository),
                    socket_path.parent.resolve() / socket_path.name)
                receipt = external / "checkpoint.json"
                self.assertEqual(
                    freeze.preflight_checkpoint_path(receipt, repository_root=repository),
                    receipt.parent.resolve() / receipt.name)
                with self.assertRaisesRegex(freeze.FreezeError, "checkpoint_custody"):
                    freeze.preflight_checkpoint_path(
                        repository / "checkpoint.json", repository_root=repository)
                receipt.write_bytes(b"occupied")
                with self.assertRaisesRegex(freeze.FreezeError, "checkpoint_custody"):
                    freeze.preflight_checkpoint_path(receipt, repository_root=repository)
                os.chmod(socket_path, 0o666)
                with self.assertRaisesRegex(freeze.FreezeError, "monitor_custody"):
                    freeze._socket_path(socket_path, repository)
            finally:
                server.close()

    def test_historical_parent_accepts_only_retained_pre_or_post_checkpoint(self):
        _, response = signed_monitor_response()
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw); os.chmod(base, 0o700)
            repository = base / "checkout"; repository.mkdir(mode=0o700)
            external = base / "external"; external.mkdir(mode=0o700)
            receipt = external / "precommit.json"
            payload = canonical_json_bytes(response) + b"\n"
            receipt.write_bytes(payload); os.chmod(receipt, 0o600)
            with patch.object(freeze, "_verify_monitor_signature"):
                parent = freeze.load_checkpoint(
                    receipt, repository_root=repository,
                    allowed_checkpoints=frozenset(("precommit", "postcommit-terminal-readback")))
                self.assertEqual(parent.receipt_sha256, hashlib.sha256(payload).hexdigest())
                self.assertEqual(parent.continuity_epoch, response["continuity_epoch"])
                with self.assertRaisesRegex(freeze.FreezeError, "monitor_parent"):
                    freeze.load_checkpoint(
                        receipt, repository_root=repository,
                        allowed_checkpoints=frozenset(("historical-terminal-readback",)))


if __name__ == "__main__": unittest.main()
