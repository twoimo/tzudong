from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_clone_rehearsal as rehearsal


def h(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def signing_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
    rehearsal.PUBLIC_KEY_PEM = public.decode("ascii")
    rehearsal.PUBLIC_KEY_SHA256 = hashlib.sha256(public).hexdigest()
    return private, public


def bindings(now: int = 1000):
    result = {
        key: h(key) for key in (
            "runtime_source_root", "source_root", "manifest_root", "vector_root", "terminal_spec_root",
            "exclusions_root", "inventory_root", "target_fingerprint", "tool_identity_root",
            "docker_daemon_root", "predecessor_report_sha256", "predecessor_outcome_sha256",
            "predecessor_readback_sha256", "backup_receipt_sha256", "capture_receipt_sha256",
            "archive_sha256", "freeze_root", "starting_ledger_root", "starting_catalog_root",
            "starting_acl_root", "starting_data_root",
        )
    }
    result.update({
        "source_commit": "a" * 40, "archive_bytes": 8192, "freeze_expires_at": now + 600,
        "selected_versions": ["20260713002600", "20260713002700"],
    })
    return result


def state(bound, terminal=False, classification=None, rows=None):
    prefix = "target" if terminal else "starting"
    return rehearsal._new_state(
        classification or ("EXACT_42" if terminal else "EXACT_40"),
        (42 if terminal else 40) if rows is None else rows,
        *(bound.get(f"{prefix}_{name}_root", h(f"observed_target_{name}")) for name in ("ledger", "catalog", "acl", "data")),
    )


def handle(slot: str, subject):
    return rehearsal.CloneHandle(
        subject=subject, clone_nonce=f"g038-clone-{slot}-0001", system_identifier="100" + slot,
        database_oid="200" + slot, service_file_sha256=h("service" + slot),
        endpoint_sha256=h("endpoint" + slot), container_id_sha256=h("container" + slot),
        image_id_sha256=h(rehearsal.IMAGE_ID), image_digest_sha256=h(rehearsal.IMAGE_DIGEST),
        container_custody_sha256=h("container-custody" + slot),
        network_custody_sha256=h("network-custody" + slot),
        restore_receipt_sha256=h("restore" + slot),
    )


def successful_run(tmp_path: Path):
    now, bound = 1000, bindings()
    first_subject = {"state": state(bound)}
    second_subject = {"state": state(bound)}
    first, second = handle("1", first_subject), handle("2", second_subject)
    calls = []

    def apply_cursor(cursor):
        calls.append(cursor)

    def owner(subject, commit, apply):
        assert callable(apply)
        apply("cursor")
        after = state(bound, terminal=True)
        if commit:
            subject["state"] = after
        return rehearsal.Applied(after, h("execution-commit" if commit else "execution-rollback"))

    result = rehearsal.run_dual_clone_rehearsal(
        bindings=bound, first=first, second=second, read_state=lambda subject: subject["state"],
        transaction_owner=owner, apply_cursor=apply_cursor, cleanup=lambda: None, now=now,
    )
    return bound, first_subject, second_subject, result, calls


def test_dual_clone_exact_convergence_rollback_and_terminal_readback(tmp_path):
    bound, first, second, result, calls = successful_run(tmp_path)
    assert first["state"] == state(bound)
    assert second["state"] == state(bound, terminal=True)
    assert calls == ["cursor", "cursor"]
    assert type(result) is rehearsal.SealedRehearsal
    assert result.body["first_clone"]["outcome"] == "ROLLED_BACK_EXACT_40"
    assert result.body["second_clone"]["terminal_readback"]["rows"] == 42
    assert all(result.body["exact_equality"].values())


def test_cleanup_precedes_unsigned_result(tmp_path):
    now, bound = 1000, bindings()
    subjects = [{"state": state(bound)}, {"state": state(bound)}]
    first, second = handle("1", subjects[0]), handle("2", subjects[1])
    events = []

    def owner(subject, commit, apply):
        apply("cursor")
        after = state(bound, terminal=True)
        if commit:
            subject["state"] = after
        return rehearsal.Applied(after, h(f"execution-{commit}"))

    def cleanup():
        events.append("cleanup")


    result = rehearsal.run_dual_clone_rehearsal(
        bindings=bound, first=first, second=second, read_state=lambda subject: subject["state"],
        transaction_owner=owner, apply_cursor=lambda _: None, cleanup=cleanup, now=now,
    )
    assert events == ["cleanup"]
    assert b"signature_b64" not in result.unsigned


def test_state_cannot_be_caller_constructed():
    with pytest.raises(rehearsal.CloneRehearsalError, match="state_contract"):
        rehearsal.State("EXACT_40", 40, h("a"), h("b"), h("c"), h("d"))


def test_distinct_clone_system_container_endpoint_restore_and_service_are_required(tmp_path):
    bound = bindings()
    subject1, subject2 = {"state": state(bound)}, {"state": state(bound)}
    first, second = handle("1", subject1), handle("2", subject2)
    second = rehearsal.CloneHandle(**{**second.__dict__, "system_identifier": first.system_identifier})
    private, public = signing_key()
    with pytest.raises(rehearsal.CloneRehearsalError, match="clone_identity"):
        rehearsal.run_dual_clone_rehearsal(
            bindings=bound, first=first, second=second, read_state=lambda value: value["state"],
            transaction_owner=lambda *_: pytest.fail("must fail before transactions"),
            apply_cursor=lambda _: None, cleanup=lambda: None, now=1000,
        )


@pytest.mark.parametrize("bad", [
    rehearsal._new_state("PARTIAL_OR_AMBIGUOUS", 41, h("x"), h("y"), h("z"), h("q")),
    rehearsal._new_state("EXACT_40", 40, h("mixed"), h("starting_catalog_root"), h("starting_acl_root"), h("starting_data_root")),
])
def test_41_and_mixed_roots_are_denied_before_mutation(tmp_path, bad):
    bound = bindings()
    subjects = [{"state": bad}, {"state": state(bound)}]
    private, public = signing_key()
    with pytest.raises(rehearsal.CloneRehearsalError, match="state_mismatch"):
        rehearsal.run_dual_clone_rehearsal(
            bindings=bound, first=handle("1", subjects[0]), second=handle("2", subjects[1]),
            read_state=lambda value: value["state"], transaction_owner=lambda *_: pytest.fail("mutation"),
            apply_cursor=lambda _: None, cleanup=lambda: None, now=1000,
        )


def test_image_digest_is_pinned(tmp_path):
    bound = bindings()
    subjects = [{"state": state(bound)}, {"state": state(bound)}]
    first = handle("1", subjects[0])
    first = rehearsal.CloneHandle(**{**first.__dict__, "image_digest_sha256": h("replacement-image")})
    private, public = signing_key()
    with pytest.raises(rehearsal.CloneRehearsalError, match="clone_contract"):
        rehearsal.run_dual_clone_rehearsal(
            bindings=bound, first=first, second=handle("2", subjects[1]),
            read_state=lambda value: value["state"], transaction_owner=lambda *_: pytest.fail("mutation"),
            apply_cursor=lambda _: None, cleanup=lambda: None, now=1000,
        )


def test_stable_docker_projection_excludes_only_mutable_health_and_binds_network():
    base = {
        "Id": "a" * 64, "Image": rehearsal.IMAGE_ID,
        "Config": {"Image": rehearsal.IMAGE, "ExposedPorts": {"5432/tcp": {}}, "Labels": {"run": "a"}},
        "HostConfig": {"NetworkMode": "isolated", "Privileged": False, "Binds": None, "Mounts": None,
                       "CapAdd": None, "CapDrop": None, "PortBindings": {}},
        "Mounts": [], "NetworkSettings": {"Networks": {"isolated": {"NetworkID": "n"}}, "Ports": {}},
        "State": {"Health": {"Status": "starting"}}, "LogPath": "/one",
    }
    changed_health = {**base, "State": {"Health": {"Status": "healthy"}}, "LogPath": "/two"}
    assert rehearsal.custody_sha256(base) == rehearsal.custody_sha256(changed_health)
    changed_image = {**base, "Image": "sha256:" + "b" * 64}
    assert rehearsal.custody_sha256(base) != rehearsal.custody_sha256(changed_image)
    network = {"Id": "n", "Internal": True, "Attachable": False, "Labels": {}, "Containers": {"a": {}}, "Options": {"mutable": "ignored"}}
    replacement = {**network, "Containers": {"b": {}}}
    assert rehearsal.custody_sha256(network, network=True) != rehearsal.custody_sha256(replacement, network=True)


def test_unsigned_orchestrator_does_not_touch_output_paths(tmp_path):
    bound = bindings()
    output = tmp_path / "receipt"
    output.write_bytes(b"owner-data")
    subjects = [{"state": state(bound)}, {"state": state(bound)}]

    def owner(subject, commit, apply):
        apply("cursor")
        after = state(bound, terminal=True)
        if commit:
            subject["state"] = after
        return rehearsal.Applied(after, h("execution" + str(commit)))

    rehearsal.run_dual_clone_rehearsal(
        bindings=bound, first=handle("1", subjects[0]), second=handle("2", subjects[1]),
        read_state=lambda value: value["state"], transaction_owner=owner,
        apply_cursor=lambda _: None, cleanup=lambda: None, now=1000,
    )
    assert output.read_bytes() == b"owner-data"
