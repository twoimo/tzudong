from __future__ import annotations

import base64
import hashlib
import inspect
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_local_clone_adapter as adapter


def completed(stdout: str = "", returncode: int = 0):
    return subprocess.CompletedProcess([], returncode, stdout, "")


def minimum_cli(tmp_path: Path) -> list[str]:
    return [
        "--source-root", str(tmp_path), "--run-root", str(tmp_path),
        "--source-receipt", str(tmp_path / "source-receipt"),
        "--source-attestation-bundle", str(tmp_path / "source-bundle"),
        "--gh-path", str(tmp_path / "gh"),
        "--archive", str(tmp_path / "archive"), "--capture-receipt", str(tmp_path / "capture"),
        "--backup-receipt", str(tmp_path / "backup"), "--predecessor-report", str(tmp_path / "predecessor"),
        "--predecessor-final-receipt", str(tmp_path / "predecessor-final"),
        "--predecessor-readback-receipt", str(tmp_path / "predecessor-readback"),
        "--freeze-receipt", str(tmp_path / "freeze"), "--output", str(tmp_path / "output"),
        "--identity-fd-1", "3", "--identity-fd-2", "4", "--clone-signing-key-fd", "5",
        "--deadline-epoch", str(time.time() + 60), "--docker", "docker", "--git", "git",
        "--age", "age", "--pg-restore", "pg_restore",
    ]


@pytest.mark.parametrize("forbidden", [
    "--dsn", "--host", "--port", "--service", "--image", "--migration-root",
    "--repository-root", "--docker-context",
])
def test_cli_has_no_authority_or_topology_overrides(tmp_path, forbidden):
    with pytest.raises(SystemExit):
        adapter.parser().parse_args(minimum_cli(tmp_path) + [forbidden, "attacker-value"])


def test_cli_requires_separate_identity_and_signing_channels(tmp_path):
    argv = minimum_cli(tmp_path)
    parsed = adapter.parser().parse_args(argv)
    assert parsed.identity_fd_1 == "3"
    assert parsed.identity_fd_2 == "4"
    assert parsed.clone_signing_key_fd == "5"
    assert parsed.source_receipt == str(tmp_path / "source-receipt")
    assert parsed.source_attestation_bundle == str(tmp_path / "source-bundle")
    assert parsed.gh_path == str(tmp_path / "gh")
    with pytest.raises(SystemExit):
        adapter.parser().parse_args(argv + ["--identity-handle-1", "9"])


def test_direct_full_cli_is_denied_before_input_or_docker_access(tmp_path):
    result = subprocess.run(
        [sys.executable, adapter.__file__, *minimum_cli(tmp_path)],
        cwd="/", capture_output=True, text=True, check=False,
        env={**os.environ, "DOCKER_HOST": "tcp://attacker.invalid:2375"},
    )
    assert result.returncode == 1


def test_protected_cli_dispatches_validated_inputs(monkeypatch, tmp_path):
    validated = object()
    observed = []
    monkeypatch.setattr(
        adapter.g038_successor_source, "assert_isolated_bootstrap", lambda: None,
    )
    monkeypatch.setattr(adapter, "_inputs", lambda args: validated)
    monkeypatch.setattr(adapter, "run", lambda inputs: observed.append(inputs))
    assert adapter.main(minimum_cli(tmp_path)) == 0
    assert observed == [validated]


def test_protected_cli_sanitizes_adapter_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(
        adapter.g038_successor_source, "assert_isolated_bootstrap", lambda: None,
    )
    monkeypatch.setattr(
        adapter,
        "_inputs",
        lambda args: (_ for _ in ()).throw(adapter.LocalCloneError("private")),
    )
    assert adapter.main(minimum_cli(tmp_path)) == 1



class AdmissionOps:
    def __init__(self, inputs, nonce):
        self.events = []
        self.inputs = inputs
        self.run_nonce = nonce

    def assert_local_docker(self):
        self.events.append("docker")
        raise adapter.LocalCloneError("stop")

    def cleanup(self):
        self.events.append("cleanup")

    def survivors(self):
        self.events.append("survivors")
        return ()

def _clone_inspection(*, network_options=None):
    labels = {
        adapter.RUN_LABEL: "nonce",
        adapter.CLONE_LABEL: "1",
    }
    container = {
        "Image": adapter.IMAGE_ID,
        "Config": {
            "Image": adapter.IMAGE,
            "User": "postgres",
            "Labels": labels,
        },
        "HostConfig": {
            "Privileged": False,
            "Binds": None,
            "Mounts": None,
            "CapAdd": None,
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges"],
            "PortBindings": {
                "5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": ""}],
            },
        },
        "Mounts": [],
        "NetworkSettings": {
            "Ports": {
                "5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "32768"}],
            },
        },
    }
    network = {
        "Driver": "bridge",
        "Internal": False,
        "Attachable": False,
        "Labels": labels,
        "Options": network_options or {
            "com.docker.network.bridge.enable_ip_masquerade": "false",
            "com.docker.network.bridge.enable_icc": "false",
        },
    }
    return container, network


def test_clone_uses_nonroot_capability_free_egress_disabled_loopback_network():
    container, network = _clone_inspection()
    commands = []

    def command(argv, **kwargs):
        commands.append(tuple(argv))
        if tuple(argv[1:3]) == ("inspect", "g038-nonce-1-db"):
            return completed(json.dumps([container]))
        if tuple(argv[1:4]) == ("network", "inspect", "g038-nonce-1-net"):
            return completed(json.dumps([network]))
        return completed()

    ops = adapter.LocalCloneOps(type("Inputs", (), {"docker": "/docker"})(), "nonce")
    ops.command = command
    clone = ops.create_clone(1)

    assert clone["port"] == 32768
    assert commands[0] == (
        "/docker", "network", "create", "--driver", "bridge",
        "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
        "--opt", "com.docker.network.bridge.enable_icc=false",
        "--label", "io.tzudong.g038.rehearsal=nonce",
        "--label", "io.tzudong.g038.clone=1",
        "g038-nonce-1-net",
    )
    assert "--user" in commands[1]
    assert commands[1][commands[1].index("--user") + 1] == "postgres"
    assert "--cap-drop=ALL" in commands[1]
    assert not any(item.startswith("--cap-add") for item in commands[1])
    assert "127.0.0.1::5432" in commands[1]


@pytest.mark.parametrize("mutation", [
    {"com.docker.network.bridge.enable_ip_masquerade": "true",
     "com.docker.network.bridge.enable_icc": "false"},
    {"com.docker.network.bridge.enable_ip_masquerade": "false"},
])
def test_clone_rejects_network_that_can_egress_or_communicate(mutation):
    container, network = _clone_inspection(network_options=mutation)

    def command(argv, **kwargs):
        if tuple(argv[1:3]) == ("inspect", "g038-nonce-1-db"):
            return completed(json.dumps([container]))
        if tuple(argv[1:4]) == ("network", "inspect", "g038-nonce-1-net"):
            return completed(json.dumps([network]))
        return completed()

    ops = adapter.LocalCloneOps(type("Inputs", (), {"docker": "/docker"})(), "nonce")
    ops.command = command
    with pytest.raises(adapter.LocalCloneError, match="custody_drift"):
        ops.create_clone(1)


def test_clone_rejects_host_binding_request_without_assigned_loopback_port():
    container, network = _clone_inspection()
    container["NetworkSettings"]["Ports"]["5432/tcp"] = None

    def command(argv, **kwargs):
        if tuple(argv[1:3]) == ("inspect", "g038-nonce-1-db"):
            return completed(json.dumps([container]))
        if tuple(argv[1:4]) == ("network", "inspect", "g038-nonce-1-net"):
            return completed(json.dumps([network]))
        return completed()

    ops = adapter.LocalCloneOps(type("Inputs", (), {"docker": "/docker"})(), "nonce")
    ops.command = command
    with pytest.raises(adapter.LocalCloneError, match="endpoint_custody"):
        ops.create_clone(1)

def _attestation(receipt: Path, receipt_sha: str, commit: str) -> list[dict]:
    certificate = {
        "issuer": "https://token.actions.githubusercontent.com",
        "subjectAlternativeName": (
            "https://github.com/twoimo/tzudong/.github/workflows/"
            "g038-account-deletion-successor.yml@refs/heads/main"
        ),
        "sourceRepositoryURI": "https://github.com/twoimo/tzudong",
        "sourceRepositoryDigest": commit,
        "sourceRepositoryRef": "refs/heads/main",
        "runnerEnvironment": "github-hosted",
    }
    statement = {
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [{"name": receipt.name, "digest": {"sha256": receipt_sha}}],
        "predicateType": "https://slsa.dev/provenance/v1",
        "predicate": {},
    }
    return [{
        "attestation": {"bundle": "opaque"},
        "verificationResult": {
            "signature": {"certificate": certificate},
            "verifiedTimestamps": [{"type": "rekor"}],
            "statement": statement,
        },
    }]


def _authenticated_backup_material(monkeypatch, tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    from g038_successor_source import SourceBinding

    tmp_path.chmod(0o700)
    repository = tmp_path / "repository"
    repository.mkdir(mode=0o700)
    commit = "b" * 40
    source = SourceBinding(commit, "1" * 64)
    manifest = type("Manifest", (), {
        "statement_vector_root": "4" * 64,
        "terminal_spec_root": "5" * 64,
    })()
    manifest_root, migration_root = "2" * 64, "3" * 64
    monkeypatch.setattr(
        adapter.production, "_manifest_roots",
        lambda root, value: (manifest_root, migration_root),
    )

    receipt_body = {
        "schema": adapter.production._SOURCE_RECEIPT_SCHEMA,
        "status": "source-valid",
        "source_commit": commit,
        "runtime_source_root": source.runtime_source_root,
        "manifest_root": manifest_root,
        "source_root": migration_root,
        "vector_root": manifest.statement_vector_root,
        "terminal_spec_root": manifest.terminal_spec_root,
        "selected_versions": list(adapter.production.SELECTED_VERSIONS),
        "repository": adapter.production._SOURCE_REPOSITORY,
        "ref": adapter.production._SOURCE_REF,
        "workflow": adapter.production._SOURCE_WORKFLOW,
        "run_id": 101,
        "run_attempt": 1,
        "artifact_name": adapter.production._SOURCE_ARTIFACT,
        "issued_at": int(time.time()),
    }
    receipt_body["receipt_sha256"] = adapter.production.canonical_sha256(
        receipt_body,
    )
    source_receipt = tmp_path / "source-receipt"
    source_receipt.write_bytes(
        adapter.production.canonical_json_bytes(receipt_body) + b"\n",
    )
    source_receipt.chmod(0o600)
    source_receipt_sha = hashlib.sha256(source_receipt.read_bytes()).hexdigest()

    bundle = tmp_path / "source-bundle"
    bundle.write_bytes(b"exact attestation bundle")
    bundle.chmod(0o600)
    gh = tmp_path / "gh"
    gh.write_bytes(b"pinned gh executable")
    gh.chmod(0o700)
    monkeypatch.setattr(
        adapter.production, "_GH_SHA256",
        hashlib.sha256(gh.read_bytes()).hexdigest(),
    )
    attestation = _attestation(source_receipt, source_receipt_sha, commit)
    monkeypatch.setattr(
        adapter.production, "_run_gh",
        lambda command: (
            adapter.production._GH_VERSION_OUTPUT.encode("ascii")
            if command[1:] == ["version"]
            else json.dumps(attestation).encode("utf-8")
        ),
    )
    evidence = adapter.production._load_source_receipt(
        type("Args", (), {
            "repository_root": str(repository),
            "source_receipt": str(source_receipt),
            "source_attestation_bundle": str(bundle),
            "gh_path": str(gh),
        })(),
        source,
        manifest,
    )

    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        Encoding.PEM, PublicFormat.SubjectPublicKeyInfo,
    )
    monkeypatch.setattr(
        adapter.production, "_RECEIPT_PUBLIC_KEY_PEM", public.decode("ascii"),
    )
    monkeypatch.setattr(
        adapter.production, "_RECEIPT_PUBLIC_KEY_SHA256",
        hashlib.sha256(public).hexdigest(),
    )
    now = int(time.time())
    freeze = type("Freeze", (), {
        "root": "6" * 64,
        "inventory_root": "7" * 64,
        "expires_at": now + 600,
    })()
    body = {
        "schema": adapter.production._BACKUP_SCHEMA,
        "source_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "source_validation_receipt_sha256": evidence.binding_sha256,
        "source_attestation_bundle_sha256": evidence.bundle_sha256,
        "verified_source_provenance_sha256": evidence.provenance_sha256,
        "target_fingerprint": adapter.production.TARGET_FINGERPRINT,
        "observation_receipt_sha256": "8" * 64,
        "freeze_root": freeze.root,
        "inventory_root": freeze.inventory_root,
        "freeze_expires_at": freeze.expires_at,
        "capture_receipt_sha256": "9" * 64,
        "g035_receipt_sha256": "a" * 64,
        "archive_sha256": "c" * 64,
        "archive_bytes": 4096,
        "issued_at": now,
        "expires_at": now + 600,
    }
    body["receipt_sha256"] = adapter.production.canonical_sha256(body)
    unsigned = adapter.production.canonical_json_bytes({
        "schema": adapter.production.SCHEMA,
        "kind": "production-backup",
        "body": body,
    })
    backup = tmp_path / "backup"
    backup.write_bytes(adapter.production.canonical_json_bytes({
        "schema": adapter.production.SCHEMA,
        "kind": "production-backup",
        "body": body,
        "signature_b64": base64.b64encode(private.sign(unsigned)).decode("ascii"),
    }) + b"\n")
    backup.chmod(0o600)
    capture = tmp_path / "capture"
    capture.write_bytes(b"capture")
    capture.chmod(0o600)
    archive = tmp_path / "archive"
    archive.write_bytes(b"archive")
    archive.chmod(0o600)
    inputs = type("Inputs", (), {
        "source_root": repository,
        "source_receipt": source_receipt,
        "source_attestation_bundle": bundle,
        "gh_path": gh,
        "backup": backup,
        "capture": capture,
        "archive": archive,
    })()
    return inputs, source, manifest, freeze, evidence, body, private


def test_backup_admission_calls_real_controller_with_authenticated_source_evidence(
    monkeypatch, tmp_path,
):
    from unittest.mock import create_autospec

    inputs, source, manifest, freeze, expected_evidence, body, _ = (
        _authenticated_backup_material(monkeypatch, tmp_path)
    )
    real_source_loader = adapter.production._load_source_receipt
    real_backup_loader = adapter.production._load_backup
    source_loader = create_autospec(
        real_source_loader, side_effect=real_source_loader,
    )
    backup_loader = create_autospec(
        real_backup_loader, side_effect=real_backup_loader,
    )
    monkeypatch.setattr(adapter.production, "_load_source_receipt", source_loader)
    monkeypatch.setattr(adapter.production, "_load_backup", backup_loader)
    monkeypatch.setattr(
        adapter.production, "_revalidate_backup_artifacts",
        lambda args, admitted: None,
    )

    admitted, backup_sha, evidence = adapter._admit_backup(
        inputs, source, manifest, freeze,
    )

    assert admitted == body
    assert backup_sha == hashlib.sha256(inputs.backup.read_bytes()).hexdigest()
    assert type(evidence) is adapter.production.SourceEvidence
    assert evidence == expected_evidence
    source_loader.assert_called_once()
    backup_loader.assert_called_once()
    call = backup_loader.call_args
    assert call.args[1:] == (source, evidence, "8" * 64, freeze)
    assert call.kwargs == {}


@pytest.mark.parametrize("field", [
    "source_validation_receipt_sha256",
    "source_attestation_bundle_sha256",
    "verified_source_provenance_sha256",
])
def test_forged_backup_source_evidence_is_rejected_before_clone(
    monkeypatch, tmp_path, field,
):
    inputs, source, manifest, freeze, _, _, private = (
        _authenticated_backup_material(monkeypatch, tmp_path)
    )
    value = json.loads(inputs.backup.read_text("ascii"))
    value["body"][field] = "f" * 64
    unsigned_body = {
        key: item for key, item in value["body"].items()
        if key != "receipt_sha256"
    }
    value["body"]["receipt_sha256"] = adapter.production.canonical_sha256(
        unsigned_body,
    )
    unsigned = adapter.production.canonical_json_bytes({
        "schema": adapter.production.SCHEMA,
        "kind": "production-backup",
        "body": value["body"],
    })
    value["signature_b64"] = base64.b64encode(private.sign(unsigned)).decode(
        "ascii",
    )
    inputs.backup.write_bytes(
        adapter.production.canonical_json_bytes(value) + b"\n",
    )
    with pytest.raises(adapter.production.ControllerError, match="backup_invalid"):
        adapter._admit_backup(inputs, source, manifest, freeze)


@pytest.mark.parametrize("replacement", ["missing-receipt", "receipt", "bundle", "gh"])
def test_replaced_source_custody_is_rejected_before_clone(
    monkeypatch, tmp_path, replacement,
):
    inputs, source, manifest, freeze, _, _, _ = (
        _authenticated_backup_material(monkeypatch, tmp_path)
    )
    path = {
        "missing-receipt": inputs.source_receipt,
        "receipt": inputs.source_receipt,
        "bundle": inputs.source_attestation_bundle,
        "gh": inputs.gh_path,
    }[replacement]
    if replacement == "missing-receipt":
        path.unlink()
    else:
        path.write_bytes(b"cross-run replacement")
        if replacement != "gh":
            path.chmod(0o600)
    with pytest.raises(adapter.production.ControllerError):
        adapter._admit_backup(inputs, source, manifest, freeze)



def test_run_verifies_exact_production_source_before_docker(monkeypatch, tmp_path):
    descriptors = tuple(os.open(os.devnull, os.O_RDONLY) for _ in range(3))
    paths = tuple(tmp_path / name for name in (
        "source-receipt", "source-bundle", "gh", "archive", "capture",
        "backup", "predecessor", "predecessor-final", "predecessor-readback",
        "freeze", "output",
    ))
    for path in paths[:-1]:
        path.write_bytes(b"x")
    inputs = adapter.Inputs(
        tmp_path, tmp_path, *paths[:-1], paths[-1],
        descriptors[:2], descriptors[2], time.monotonic() + 60,
        "/usr/bin/git", "/usr/bin/git", "/usr/bin/git", "/usr/bin/git",
    )
    events = []
    holder = {}

    def factory(value, nonce):
        holder["ops"] = AdmissionOps(value, nonce)
        return holder["ops"]

    monkeypatch.setattr(
        adapter.g038_successor_source,
        "assert_isolated_bootstrap",
        lambda: events.append("capability"),
    )
    monkeypatch.setattr(
        adapter.subprocess,
        "run",
        lambda *args, **kwargs: completed("a" * 40 + "\n"),
    )

    def verify(root, commit, **kwargs):
        events.append(("verify", root, commit, kwargs["production"]))
        return object()

    monkeypatch.setattr(adapter.g038_successor_source, "verify_successor_source", verify)
    with pytest.raises(adapter.LocalCloneError, match="stop"):
        adapter.run(inputs, ops_factory=factory)
    assert events == [
        "capability", ("verify", tmp_path, "a" * 40, True),
    ]
    assert holder["ops"].events[0] == "docker"


def test_source_denial_has_no_docker_effect_and_removes_ephemeral_paths(monkeypatch, tmp_path):
    descriptors = tuple(os.open(os.devnull, os.O_RDONLY) for _ in range(3))
    artifacts = tuple(tmp_path / name for name in (
        "source-receipt", "source-bundle", "gh", "archive", "capture",
        "backup", "predecessor", "predecessor-final", "predecessor-readback",
        "freeze",
    ))
    for path in artifacts:
        path.write_bytes(b"x")
    for name in ("service-1", "service-2", "restore-1.json", "restore-2.json"):
        (tmp_path / name).write_bytes(b"private")
    inputs = adapter.Inputs(
        tmp_path, tmp_path, *artifacts, tmp_path / "output",
        descriptors[:2], descriptors[2], time.monotonic() + 60,
        "/usr/bin/git", "/usr/bin/git", "/usr/bin/git", "/usr/bin/git",
    )
    holder = {}

    def factory(value, nonce):
        holder["ops"] = AdmissionOps(value, nonce)
        return holder["ops"]

    monkeypatch.setattr(
        adapter.g038_successor_source,
        "assert_isolated_bootstrap",
        lambda: (_ for _ in ()).throw(adapter.LocalCloneError("source")),
    )
    with pytest.raises(adapter.LocalCloneError, match="source"):
        adapter.run(inputs, ops_factory=factory)
    assert holder["ops"].events == []
    assert not any((tmp_path / name).exists() for name in (
        "service-1", "service-2", "restore-1.json", "restore-2.json",
    ))
    for descriptor in descriptors:
        with pytest.raises(OSError):
            os.fstat(descriptor)


def test_strict_cleanup_continues_after_failures_and_overrides_original(tmp_path):
    descriptors = tuple(os.open(os.devnull, os.O_RDONLY) for _ in range(3))
    inputs = type("Inputs", (), {
        "run_root": tmp_path,
        "identity_channels": descriptors[:2],
        "signing_channel": descriptors[2],
    })()
    (tmp_path / "service-1").mkdir()
    for name in ("service-2", "restore-1.json", "restore-2.json"):
        (tmp_path / name).write_bytes(b"private")

    class FailingOps:
        def __init__(self):
            self.calls = []

        def cleanup(self):
            self.calls.append("cleanup")
            raise RuntimeError("uncertain")

        def survivors(self):
            self.calls.append("survivors")
            return ()

    ops = FailingOps()
    cleanup = adapter._StrictCleanup(inputs, ops)
    cleanup.admit_external_cleanup()
    with pytest.raises(adapter.LocalCloneError, match="cleanup_survivors"):
        cleanup.run()
    assert ops.calls == ["cleanup", "survivors"]
    assert not any((tmp_path / name).exists() for name in (
        "service-2", "restore-1.json", "restore-2.json",
    ))
    for descriptor in descriptors:
        with pytest.raises(OSError):
            os.fstat(descriptor)

class DockerProbe(adapter.LocalCloneOps):
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.inputs = type("I", (), {"docker": "docker", "deadline_monotonic": time.monotonic() + 60})()
        self.run_nonce = "a" * 32

    def command(self, argv, *, check=True):
        if argv[1:3] == ("context", "show"):
            return completed("default\n")
        if argv[1:3] == ("context", "inspect"):
            return completed(json.dumps([{"Endpoints": {"docker": {"Host": self.endpoint}}}]))
        if argv[1:3] == ("version", "--format"):
            return completed('{"Version":"29.6.2","Os":"linux","Arch":"arm64"}\n')
        if argv[1:3] == ("image", "inspect"):
            return completed(json.dumps([{"Id": adapter.IMAGE_ID, "RepoDigests": [adapter.IMAGE_DIGEST]}]))
        raise AssertionError(argv)


def test_remote_docker_endpoint_is_rejected():
    with pytest.raises(adapter.LocalCloneError, match="remote_docker"):
        DockerProbe("tcp://127.0.0.1:2375").assert_local_docker()
    DockerProbe("unix:///var/run/docker.sock").assert_local_docker()


def test_external_artifact_custody_rejects_group_access_and_repo_location(tmp_path):
    tmp_path = tmp_path.resolve()
    repository = tmp_path / "repo"
    repository.mkdir(mode=0o700)
    outside = tmp_path / "outside"
    outside.write_bytes(b"x")
    outside.chmod(0o640)
    with pytest.raises(adapter.LocalCloneError, match="input_custody"):
        adapter._external_file(str(outside), repository=repository)
    outside.chmod(0o600)
    assert adapter._external_file(str(outside), repository=repository) == outside
    inside = repository / "artifact"
    inside.write_bytes(b"x")
    inside.chmod(0o600)
    with pytest.raises(adapter.LocalCloneError, match="input_location"):
        adapter._external_file(str(inside), repository=repository)


def test_duplicate_or_closed_channels_fail_closed():
    read_fd, write_fd = os.pipe()
    try:
        assert adapter._fd(str(read_fd)) == read_fd
        with pytest.raises(adapter.LocalCloneError, match="channel"):
            adapter._fd("-1")
    finally:
        os.close(read_fd)
        os.close(write_fd)


def test_signing_key_must_match_clone_public_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat
    key = Ed25519PrivateKey.generate()
    raw = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, raw)
        os.close(write_fd)
        write_fd = -1
        with pytest.raises(adapter.LocalCloneError, match="signing_key"):
            adapter._load_signer(read_fd)
    finally:
        try:
            os.close(read_fd)
        except OSError:
            pass
        if write_fd >= 0:
            os.close(write_fd)


def test_deadline_is_absolute_and_expired_deadline_is_denied():
    with pytest.raises(adapter.LocalCloneError, match="deadline"):
        adapter._deadline(time.time() - 1)
    assert adapter._deadline(time.time() + 5) > time.monotonic()


def test_rehearsal_connection_is_autocommit_and_isolation_is_verified_before_queries():
    events = []

    class Ops(adapter.LocalCloneOps):
        def connect(self, service, *, autocommit=False):
            events.append(("connect", service, autocommit))
            return object()

    class Cursor:
        def execute(self, statement, parameters=None):
            events.append(("execute", statement, parameters))

        def fetchone(self):
            events.append(("fetchone",))
            return ("repeatable read",)

    ops = object.__new__(Ops)
    service = Path("/private/service")
    assert ops.rehearsal_connection(service) is not None
    cursor = Cursor()
    ops.begin_rehearsal_transaction(cursor)
    cursor.execute("SELECT observation")

    assert events == [
        ("connect", service, True),
        ("execute", "BEGIN ISOLATION LEVEL REPEATABLE READ", None),
        ("execute", "SHOW transaction_isolation", None),
        ("fetchone",),
        ("execute", "SELECT observation", None),
    ]


def test_isolation_mismatch_is_denied_before_mutation():
    events = []

    class Cursor:
        def execute(self, statement, parameters=None):
            events.append(statement)

        def fetchone(self):
            return ("read committed",)

    with pytest.raises(adapter.LocalCloneError, match="transaction_isolation"):
        adapter.LocalCloneOps.begin_rehearsal_transaction(object(), Cursor())

    assert events == [
        "BEGIN ISOLATION LEVEL REPEATABLE READ",
        "SHOW transaction_isolation",
    ]


def test_readiness_waits_for_final_postgres_pid_after_entrypoint_initialization(monkeypatch):
    ops = object.__new__(adapter.LocalCloneOps)
    ops.inputs = type("Inputs", (), {"docker": "docker", "deadline_monotonic": 100.0})()
    commands = []
    responses = iter((
        completed("bash\n"),
        completed("postgres\n"),
        completed(adapter._FINAL_POSTGRES_COMM),
        completed("accepting connections\n"),
    ))

    def command(argv, **kwargs):
        commands.append((tuple(argv), kwargs))
        return next(responses)

    ops.command = command
    monkeypatch.setattr(adapter.time, "monotonic", lambda: 0.0)
    monkeypatch.setattr(adapter.time, "sleep", lambda value: None)

    ops.wait_ready({"container": "clone-1"})

    assert commands == [
        (("docker", "exec", "clone-1", "cat", "/proc/1/comm"), {"check": False}),
        (("docker", "exec", "clone-1", "cat", "/proc/1/comm"), {"check": False}),
        (("docker", "exec", "clone-1", "cat", "/proc/1/comm"), {"check": False}),
        (("docker", "exec", "clone-1", "pg_isready", "-U", "postgres", "-d", "postgres"),
         {"check": False}),
    ]

def test_generated_service_file_has_exact_g035_application_name_and_is_admitted(monkeypatch, tmp_path):
    ops = object.__new__(adapter.LocalCloneOps)
    ops.inputs = type("Inputs", (), {"docker": "docker", "run_root": tmp_path})()
    commands = []
    monkeypatch.setattr(adapter.secrets, "token_urlsafe", lambda length: "ephemeral-password")

    def command(argv, **kwargs):
        commands.append((tuple(argv), kwargs))
        return completed()

    ops.command = command

    service = ops.service_file({"slot": 1, "container": "clone-1", "port": 55401})
    expected = (
        b"[g035-local]\n"
        b"host=127.0.0.1\n"
        b"port=55401\n"
        b"dbname=g035_local\n"
        b"user=postgres\n"
        b"password=ephemeral-password\n"
        b"application_name=g035-local\n"
        b"sslmode=disable\n"
    )

    assert service.read_bytes() == expected
    assert adapter.g035._parse_local_service(service, adapter.SERVICE) == expected
    assert commands == [
        (("docker", "exec", "clone-1", "createdb", "-U", "postgres", "g035_local"), {}),
        (("docker", "exec", "-i", "clone-1", "psql", "-U", "supabase_admin",
          "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"),
         {"input_text": "ALTER ROLE postgres PASSWORD 'ephemeral-password';\n"}),
    ]


def test_connection_uses_exact_parsed_loopback_parameters_without_servicefile(monkeypatch, tmp_path):
    service = tmp_path / "service"
    service.write_text(
        "[g035-local]\n"
        "host=127.0.0.1\n"
        "port=55401\n"
        "dbname=g035_local\n"
        "user=postgres\n"
        "password=ephemeral-password\n"
        "application_name=g035-local\n"
        "sslmode=disable\n",
        encoding="ascii",
    )
    service.chmod(0o600)
    observed = {}

    def connect(**kwargs):
        observed.update(kwargs)
        return "connection"

    monkeypatch.setitem(
        sys.modules,
        "psycopg",
        type("Psycopg", (), {"connect": staticmethod(connect)}),
    )
    ops = object.__new__(adapter.LocalCloneOps)

    assert ops.connect(service, autocommit=True) == "connection"
    assert observed == {
        "host": "127.0.0.1",
        "port": 55401,
        "dbname": "g035_local",
        "user": "postgres",
        "password": "ephemeral-password",
        "application_name": "g035-local",
        "sslmode": "disable",
        "autocommit": True,
    }
    assert "servicefile" not in observed
    assert "service" not in observed


def test_connection_rejects_extra_service_keys_before_psycopg(monkeypatch, tmp_path):
    service = tmp_path / "service"
    service.write_text(
        "[g035-local]\n"
        "host=127.0.0.1\n"
        "port=55401\n"
        "dbname=g035_local\n"
        "user=postgres\n"
        "password=ephemeral-password\n"
        "connect_timeout=5\n"
        "application_name=g035-local\n"
        "sslmode=disable\n",
        encoding="ascii",
    )
    service.chmod(0o600)
    calls = []
    monkeypatch.setitem(
        sys.modules,
        "psycopg",
        type("Psycopg", (), {"connect": staticmethod(lambda **kwargs: calls.append(kwargs))}),
    )
    ops = object.__new__(adapter.LocalCloneOps)

    with pytest.raises(adapter.LocalCloneError, match="database_connection"):
        ops.connect(service)
    assert calls == []


def _role_catalog(rows=adapter.TRANSIENT_MANAGED_ROWS):
    return {
        "database": "postgres",
        "memberships": [list(row) for row in sorted(rows)],
        "roles": [[name, *adapter.ROLE_FLAGS] for name in sorted(adapter.MANAGED_ROLES)],
        "server_version_num": 170010,
        "session_user": "postgres",
        "user": "postgres",
    }


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["roles"].pop(),
        lambda value: value["roles"].append(["privacy_extra", *adapter.ROLE_FLAGS]),
        lambda value: value["roles"].__setitem__(
            0, [value["roles"][0][0], True, *adapter.ROLE_FLAGS[1:]],
        ),
        lambda value: value["memberships"].__setitem__(
            0, [*value["memberships"][0][:2], "attacker", *value["memberships"][0][3:]],
        ),
        lambda value: value["memberships"].__setitem__(
            0, [*value["memberships"][0][:3], True, False, True],
        ),
        lambda value: value["memberships"].append(
            ["privacy_workflow_owner", "attacker", "postgres", False, True, True],
        ),
    ],
)
def test_role_catalog_rejects_absent_extra_attribute_grantor_and_option_drift(mutate):
    value = _role_catalog()
    mutate(value)
    with pytest.raises(adapter.LocalCloneError, match="role_protocol"):
        adapter.LocalCloneOps._validate_role_catalog(
            json.dumps(value), adapter.TRANSIENT_MANAGED_ROWS,
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("server_version_num", 160010),
        ("session_user", "supabase_admin"),
        ("user", "supabase_admin"),
        ("database", "attacker"),
    ],
)
def test_role_catalog_rejects_version_and_identity_drift(field, value):
    catalog = _role_catalog()
    catalog[field] = value
    with pytest.raises(adapter.LocalCloneError, match="role_protocol"):
        adapter.LocalCloneOps._validate_role_catalog(
            json.dumps(catalog), adapter.TRANSIENT_MANAGED_ROWS,
        )


def test_role_bootstrap_is_source_pinned_explicit_and_keeps_sql_off_argv():
    ops = object.__new__(adapter.LocalCloneOps)
    ops.inputs = type("Inputs", (), {
        "docker": "docker", "deadline_monotonic": time.monotonic() + 60,
    })()
    calls = []

    def command(argv, **kwargs):
        calls.append((tuple(argv), kwargs.get("input_text", "")))
        stdout = json.dumps(_role_catalog()) if "json_build_object" in kwargs.get("input_text", "") else ""
        return completed(stdout)

    ops.command = command
    ops.bootstrap_role_protocol({"container": "clone"})
    assert len(calls) == 3
    admin_sql, self_sql, assertion_sql = (call[1] for call in calls)
    assert admin_sql.index("managed role bootstrap precondition drift") < admin_sql.index("CREATE ROLE")
    assert admin_sql.count("CREATE ROLE ") == 4
    assert admin_sql.count("GRANTED BY supabase_admin") == 4
    assert "IF NOT EXISTS" not in admin_sql
    assert "02500" not in admin_sql and "G026" not in admin_sql
    assert "GRANTED BY postgres" in self_sql
    assert "json_build_object" in assertion_sql
    assert all(sql not in argv for argv, sql in calls)
    assert all("password" not in " ".join(argv).lower() for argv, _ in calls)


def test_terminalization_revokes_only_self_grant_then_verifies_terminal_and_owner():
    ops = object.__new__(adapter.LocalCloneOps)
    ops.inputs = type("Inputs", (), {
        "docker": "docker", "deadline_monotonic": time.monotonic() + 60,
    })()
    calls = []

    def command(argv, **kwargs):
        sql = kwargs.get("input_text", "")
        calls.append(sql)
        catalog = _role_catalog(adapter.TERMINAL_MANAGED_ROWS)
        catalog["database"] = adapter.DATABASE
        return completed(json.dumps(catalog) if "json_build_object" in sql else "")

    ops.command = command
    ops.terminalize_role_protocol({"container": "clone"})
    assert calls[0].strip() == (
        "REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;"
    )
    assert "json_build_object" in calls[1]
    assert "assert_g014_workflow_owner_contract()" in calls[2]


def test_each_clone_bootstraps_before_restore_and_terminalizes_before_observation():
    body = inspect.getsource(adapter.run)
    bootstrap = body.index("ops.bootstrap_role_protocol(clone)")
    restore = body.index("restored = ops.restore(")
    terminal = body.index("ops.terminalize_role_protocol(clone)")
    observation = body.index("def observe(")
    assert bootstrap < restore < terminal < observation
