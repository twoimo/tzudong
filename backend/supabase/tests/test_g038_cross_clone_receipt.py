from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_clone_rehearsal as rehearsal


def h(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def keys():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    rehearsal.PUBLIC_KEY_PEM = public.decode("ascii")
    rehearsal.PUBLIC_KEY_SHA256 = hashlib.sha256(public).hexdigest()
    return private, public


def bindings(label: str, now: int):
    names = (
        "runtime_source_root", "source_root", "manifest_root", "vector_root", "terminal_spec_root",
        "exclusions_root", "inventory_root", "target_fingerprint", "tool_identity_root",
        "docker_daemon_root", "predecessor_report_sha256", "predecessor_outcome_sha256",
        "predecessor_readback_sha256", "backup_receipt_sha256", "capture_receipt_sha256",
        "archive_sha256", "freeze_root", "starting_ledger_root", "starting_catalog_root",
        "starting_acl_root", "starting_data_root",
    )
    return {
        **{name: h(label + name) for name in names}, "source_commit": ("a" if label == "a" else "b") * 40,
        "archive_bytes": 4096, "freeze_expires_at": now + 300,
        "selected_versions": ["20260713002600", "20260713002700"],
    }


def state(bound, terminal=False, label=""):
    roots = (
        tuple(h(label + f"target_{name}_root") for name in ("ledger", "catalog", "acl", "data"))
        if terminal else
        tuple(bound[f"starting_{name}_root"] for name in ("ledger", "catalog", "acl", "data"))
    )
    return rehearsal._new_state(
        "EXACT_42" if terminal else "EXACT_40", 42 if terminal else 40, *roots,
    )


def clone(label: str, slot: int, subject):
    unique = label + str(slot)
    return rehearsal.CloneHandle(
        subject, f"g038-{label}-clone-{slot}-0001", str(10_000 + slot + (100 if label == "b" else 0)),
        str(20_000 + slot + (100 if label == "b" else 0)), h("service" + unique), h("endpoint" + unique),
        h("container" + unique), h(rehearsal.IMAGE_ID), h(rehearsal.IMAGE_DIGEST),
        h("container-custody" + unique), h("network-custody" + unique), h("restore" + unique),
    )


def create(path: Path, label: str, private, public):
    now, bound = 5000, bindings(label, 5000)
    subjects = [{"state": state(bound)}, {"state": state(bound)}]

    def owner(subject, commit, apply):
        apply(object())
        terminal = state(bound, terminal=True, label=label)
        if commit:
            subject["state"] = terminal
        return rehearsal.Applied(terminal, h(label + "execution" + str(commit)))

    sealed = rehearsal.run_dual_clone_rehearsal(
        bindings=bound, first=clone(label, 1, subjects[0]), second=clone(label, 2, subjects[1]),
        read_state=lambda subject: subject["state"], transaction_owner=owner, apply_cursor=lambda _: None,
        cleanup=lambda: None, now=now,
    )
    envelope = {
        "schema": rehearsal.SCHEMA,
        "kind": rehearsal.KIND,
        "body": dict(sealed.body),
        "signature_b64": base64.b64encode(private.sign(sealed.unsigned)).decode("ascii"),
    }
    raw = rehearsal.canonical_json_bytes(envelope) + b"\n"
    rehearsal._publish(path, raw)
    return bound, {"body": sealed.body, "receipt_sha256": hashlib.sha256(raw).hexdigest()}


def test_receipt_binds_complete_lineage_and_both_independent_identity_hashes(tmp_path):
    private, public = keys()
    bound, receipt = create(tmp_path / "receipt.json", "a", private, public)
    verified = rehearsal.verify_dual_clone_receipt(
        tmp_path / "receipt.json",
        expected={key: bound[key] for key in (
            "source_commit", "runtime_source_root", "source_root", "manifest_root", "vector_root",
            "terminal_spec_root", "exclusions_root", "inventory_root", "target_fingerprint",
            "tool_identity_root", "docker_daemon_root",
            "backup_receipt_sha256", "capture_receipt_sha256", "archive_sha256", "archive_bytes",
            "freeze_root", "freeze_expires_at", "predecessor_report_sha256",
            "predecessor_outcome_sha256", "predecessor_readback_sha256", "starting_ledger_root",
            "starting_catalog_root", "starting_acl_root", "starting_data_root", "selected_versions",
        )},
    )
    assert verified["receipt_sha256"] == receipt["receipt_sha256"]
    first, second = verified["body"]["first_clone"], verified["body"]["second_clone"]
    for field in ("system_identifier_sha256", "container_id_sha256", "endpoint_sha256", "service_file_sha256", "restore_receipt_sha256"):
        assert first[field] != second[field]


def test_cross_run_receipt_replacement_fails_exact_binding(tmp_path):
    private, public = keys()
    first_bound, _ = create(tmp_path / "first.json", "a", private, public)
    create(tmp_path / "replacement.json", "b", private, public)
    with pytest.raises(rehearsal.CloneRehearsalError, match="receipt_binding"):
        rehearsal.verify_dual_clone_receipt(tmp_path / "replacement.json", expected=first_bound)


def test_body_or_clone_identity_replacement_breaks_signature(tmp_path):
    private, public = keys()
    create(tmp_path / "receipt.json", "a", private, public)
    value = json.loads((tmp_path / "receipt.json").read_text("ascii"))
    value["body"]["first_clone"]["endpoint_sha256"] = h("replacement-endpoint")
    (tmp_path / "tampered.json").write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n", encoding="ascii",
    )
    with pytest.raises(rehearsal.CloneRehearsalError, match="receipt_signature"):
        rehearsal.verify_dual_clone_receipt(tmp_path / "tampered.json", expected={})


def test_signature_replacement_and_noncanonical_receipts_are_denied(tmp_path):
    private, public = keys()
    create(tmp_path / "receipt.json", "a", private, public)
    value = json.loads((tmp_path / "receipt.json").read_text("ascii"))
    value["signature_b64"] = base64.b64encode(b"x" * 64).decode("ascii")
    (tmp_path / "signature.json").write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n", encoding="ascii",
    )
    with pytest.raises(rehearsal.CloneRehearsalError, match="receipt_signature"):
        rehearsal.verify_dual_clone_receipt(tmp_path / "signature.json", expected={})
    (tmp_path / "pretty.json").write_text(json.dumps(value, indent=2) + "\n", encoding="ascii")
    with pytest.raises(rehearsal.CloneRehearsalError, match="receipt_invalid"):
        rehearsal.verify_dual_clone_receipt(tmp_path / "pretty.json", expected={})


def test_valid_receipt_cannot_be_overwritten_by_another_run(tmp_path):
    private, public = keys()
    path = tmp_path / "receipt.json"
    _, first = create(path, "a", private, public)
    original = path.read_bytes()
    with pytest.raises(rehearsal.CloneRehearsalError, match="output_exists"):
        create(path, "b", private, public)
    assert path.read_bytes() == original
    assert hashlib.sha256(original).hexdigest() == first["receipt_sha256"]
