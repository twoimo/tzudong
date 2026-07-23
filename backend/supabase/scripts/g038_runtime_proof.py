#!/usr/bin/env python3
"""Fail-closed G038 account-deletion and retention runtime proof orchestration.

The module owns no credentials and performs no discovery.  Every effect is made
through an injected adapter with the opaque, human-authorized binding supplied
by a detached-signature verifier.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Protocol

SCHEMA = "g038-runtime-proof-v1"
BINDING_SCHEMA = "g038-runtime-subject-binding-v1"
PREDECESSOR_REPORT_SHA256 = "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114"
PREDECESSOR_COMMIT = "664cee04a4f239d6cf8fe2eebab8de9c8404b316"
TARGET_FINGERPRINT = "defdf3cc65753b4b4dcaa321b16b4347278239ae08e41f19a2d98fec9f3a0331"
MAX_RUNTIME_SECONDS = 300
MAX_BINDING_SECONDS = 900
MAX_CONTINUITY_AGE_SECONDS = 30
MAX_COUNT = 2_147_483_647
PHASES = ("session", "storage", "auth")
RETENTION_READBACK_KEYS = (
    "expectedCountMatched",
    "databaseSourceAbsent",
    "storageProviderAbsent",
    "noActiveHoldMutated",
)
REAUTH_DENIALS = {
    "wrong_session": "REAUTH_WRONG_SESSION_DENIED",
    "wrong_user": "REAUTH_WRONG_USER_DENIED",
    "expired": "REAUTH_EXPIRED_DENIED",
    "replayed": "REAUTH_REPLAYED_DENIED",
}
_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_CUTOFF = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_OPAQUE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$")


class RuntimeProofDenied(RuntimeError):
    """A fixed-code denial that carries no provider or subject detail."""

    def __init__(self, reason_code: str):
        super().__init__(reason_code)
        self.reason_code = reason_code


@dataclass(frozen=True)
class VerifiedSubjectBinding:
    schema: str
    predecessor_report_sha256: str
    predecessor_commit: str
    source_commit: str
    target_fingerprint: str
    terminal_readback_sha256: str
    freeze_assertion_sha256: str
    subject_handle: str
    test_subject_binding_sha256: str
    retention_class_code: str
    retention_class_code_sha256: str
    retention_cutoff: str
    retention_operation_binding_sha256: str
    issued_at: int
    expires_at: int
    disposable: bool
    self_owned: bool
    non_admin: bool
    storage_object_count: int
    no_non_test_subject_selected: bool
    scheduled_workers_remained_stopped: bool


@dataclass(frozen=True)
class FreshPasswordSession:
    handle: str
    subject_binding_sha256: str
    session_binding_sha256: str
    password_amr: bool
    issued_at: int
    expires_at: int


@dataclass(frozen=True)
class DeletionPreview:
    request_id: str
    preview_hash: str
    source_manifest_hash: str
    request_binding_sha256: str
    subject_binding_sha256: str
    expires_at: int


@dataclass(frozen=True)
class ReauthProof:
    proof_id: str
    subject_binding_sha256: str
    session_binding_sha256: str
    expires_at: int


@dataclass(frozen=True)
class SelfDeleteRequest:
    """The exact seven fields accepted by the normal self-DELETE endpoint."""

    userId: str
    proofId: str
    requestId: str
    previewHash: str
    confirmationText: str
    idempotencyKey: str
    sourceManifestHash: str


@dataclass(frozen=True)
class ReauthDenialReceipt:
    case: str
    denied: bool
    reason_code: str
    subject_binding_sha256: str


@dataclass(frozen=True)
class DeletionStartReceipt:
    request_binding_sha256: str
    subject_binding_sha256: str
    status: str
    reason_code: str
    counts: tuple[int, int, int, int]
    lifecycle_state: str
    route_authenticated: bool
    auth_subject_present: bool
    replayed: bool


@dataclass(frozen=True)
class StorageInventory:
    request_binding_sha256: str
    subject_binding_sha256: str
    object_count: int


@dataclass(frozen=True)
class BoundPhaseReceipt:
    phase: str
    request_binding_sha256: str
    subject_binding_sha256: str
    complete: bool
    queue_claimed: bool


@dataclass(frozen=True)
class DeletionFinalReceipt:
    request_binding_sha256: str
    subject_binding_sha256: str
    status: str
    reason_code: str
    counts: tuple[int, int, int, int]
    readback: tuple[bool, bool, bool, bool]
    storage_receipt_refs: tuple[str, ...]
    auth_receipt_ref: str
    replayed: bool


@dataclass(frozen=True)
class ReplayDenialReceipt:
    request_binding_sha256: str
    subject_binding_sha256: str
    denied: bool
    reason_code: str
    lifecycle_state: str
    route_authenticated: bool
    auth_subject_present: bool


@dataclass(frozen=True)
class RetentionPreview:
    operation_id: str
    preview_hash: str
    idempotency_key: str
    adapter_version: str
    source_mapping_version: str
    class_code_sha256: str
    operation_binding_sha256: str
    cutoff: str
    eligible_count: int
    held_count: int
    scanned_count: int


@dataclass(frozen=True)
class RetentionConfirmation:
    operation_id: str
    preview_hash: str
    operation_binding_sha256: str
    confirmation_binding_sha256: str
    status: str
    confirmed_at: int
    expires_at: int
    replayed: bool


@dataclass(frozen=True)
class RetentionFinalReceipt:
    operation_binding_sha256: str
    status: str
    reason_code: str
    readback: Mapping[str, bool]
    audit_id: str


@dataclass(frozen=True)
class ControllerContinuityReceipt:
    freeze_assertion_sha256: str
    worker_state_sha256: str
    evidence_sha256: str
    observed_at: int
    expires_at: int
    freeze_continuous: bool
    scheduled_workers_stopped: bool
    no_in_flight_work: bool


@dataclass(frozen=True)
class SigningReceipt:
    payload_sha256: str
    published_at: int
    durable: bool


class BindingVerifier(Protocol):
    def verify_subject_binding(self, signed_opaque_binding: bytes) -> VerifiedSubjectBinding: ...


class ControllerContinuityVerifier(Protocol):
    def confirm_fresh_continuity(
        self,
        *,
        expected_freeze_assertion_sha256: str,
        deadline_unix: int,
    ) -> ControllerContinuityReceipt: ...


class AccountDeletionAdapter(Protocol):
    def fresh_password_session(self, subject_handle: str, *, deadline_unix: int) -> FreshPasswordSession: ...
    def preview_self_delete(self, subject_handle: str, session: FreshPasswordSession, *, deadline_unix: int) -> DeletionPreview: ...
    def issue_reauth_proof(self, subject_handle: str, session: FreshPasswordSession, *, deadline_unix: int) -> ReauthProof: ...
    def prove_reauth_denial(self, subject_handle: str, case: str, *, deadline_unix: int) -> ReauthDenialReceipt: ...
    def delete_self(self, session: FreshPasswordSession, request: SelfDeleteRequest, *, deadline_unix: int) -> DeletionStartReceipt | DeletionFinalReceipt | ReplayDenialReceipt: ...
    def list_bound_storage(self, session: FreshPasswordSession, request: SelfDeleteRequest, *, deadline_unix: int) -> StorageInventory: ...
    def drive_bound_phase(self, session: FreshPasswordSession, request: SelfDeleteRequest, phase: str, *, deadline_unix: int) -> BoundPhaseReceipt: ...
    def read_bound_status(self, session: FreshPasswordSession, request: SelfDeleteRequest, *, deadline_unix: int) -> DeletionFinalReceipt: ...


class RetentionAdapter(Protocol):
    def preview_bound(self, class_code: str, cutoff: str, operation_binding_sha256: str, *, deadline_unix: int) -> RetentionPreview: ...
    def confirm_bound(self, preview: RetentionPreview, *, deadline_unix: int) -> RetentionConfirmation: ...
    def finalize_bound(self, preview: RetentionPreview, confirmation: RetentionConfirmation, *, deadline_unix: int) -> RetentionFinalReceipt: ...


class ResultSigner(Protocol):
    def sign_and_store(self, canonical_payload: bytes, *, deadline_unix: int) -> SigningReceipt: ...

def _deny(code: str) -> None:
    raise RuntimeProofDenied(code)


def canonical_runtime_payload(value: Mapping[str, Any]) -> bytes:
    """Return the one representation admitted for hashing and detached signing."""

    raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return raw.encode("ascii")


def _hash(value: Any) -> str:
    return hashlib.sha256(canonical_runtime_payload(value)).hexdigest()


def _opaque(value: object) -> bool:
    return type(value) is str and bool(_OPAQUE.fullmatch(value))


def _safe_count(value: object) -> bool:
    return type(value) is int and 0 <= value <= MAX_COUNT


def _call(function: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return function(*args, **kwargs)
    except RuntimeProofDenied:
        raise
    except Exception:
        _deny("ADAPTER_FAILURE")


def _validate_binding(binding: object, expected_source_commit: str, now: int) -> VerifiedSubjectBinding:
    if type(binding) is not VerifiedSubjectBinding:
        _deny("BINDING_INVALID")
    assert isinstance(binding, VerifiedSubjectBinding)
    if (
        binding.schema != BINDING_SCHEMA
        or binding.predecessor_report_sha256 != PREDECESSOR_REPORT_SHA256
        or binding.predecessor_commit != PREDECESSOR_COMMIT
        or binding.source_commit != expected_source_commit
        or binding.target_fingerprint != TARGET_FINGERPRINT
        or not all(_HEX64.fullmatch(value) for value in (
            binding.terminal_readback_sha256,
            binding.freeze_assertion_sha256,
            binding.test_subject_binding_sha256,
            binding.retention_class_code_sha256,
            binding.retention_operation_binding_sha256,
        ))
        or not _opaque(binding.subject_handle)
        or not _opaque(binding.retention_class_code)
        or _hash({"class_code": binding.retention_class_code}) != binding.retention_class_code_sha256
        or not _CUTOFF.fullmatch(binding.retention_cutoff)
        or type(binding.issued_at) is not int
        or type(binding.expires_at) is not int
        or binding.issued_at > now
        or binding.expires_at <= now
        or binding.expires_at > binding.issued_at + MAX_BINDING_SECONDS
        or binding.disposable is not True
        or binding.self_owned is not True
        or binding.non_admin is not True
        or binding.storage_object_count != 0
        or binding.no_non_test_subject_selected is not True
        or binding.scheduled_workers_remained_stopped is not True
    ):
        _deny("BINDING_INVALID")
    return binding

def validate_disposable_subject(binding: VerifiedSubjectBinding) -> VerifiedSubjectBinding:
    """Recheck the no-discovery subject and current zero-storage admission."""

    if (
        type(binding) is not VerifiedSubjectBinding
        or binding.disposable is not True
        or binding.self_owned is not True
        or binding.non_admin is not True
        or binding.storage_object_count != 0
        or binding.no_non_test_subject_selected is not True
        or binding.scheduled_workers_remained_stopped is not True
    ):
        _deny("DISPOSABLE_SUBJECT_INVALID")
    return binding


def verify_opaque_runtime_binding(
    signed_opaque_binding: bytes,
    expected_source_commit: str,
    now: int,
    verifier: BindingVerifier,
) -> VerifiedSubjectBinding:
    """Verify detached authority without accepting a raw subject selector."""

    if type(signed_opaque_binding) is not bytes or not signed_opaque_binding or len(signed_opaque_binding) > 16_384:
        _deny("BINDING_INVALID")
    if type(expected_source_commit) is not str or not _HEX40.fullmatch(expected_source_commit):
        _deny("SOURCE_COMMIT_INVALID")
    if type(now) is not int:
        _deny("TIME_INVALID")
    binding = _validate_binding(
        _call(verifier.verify_subject_binding, signed_opaque_binding),
        expected_source_commit,
        now,
    )
    return validate_disposable_subject(binding)


def _validate_session(session: object, binding: VerifiedSubjectBinding, now: int) -> FreshPasswordSession:
    if (
        type(session) is not FreshPasswordSession
        or not _opaque(session.handle)
        or session.subject_binding_sha256 != binding.test_subject_binding_sha256
        or not _HEX64.fullmatch(session.session_binding_sha256)
        or session.password_amr is not True
        or type(session.issued_at) is not int
        or type(session.expires_at) is not int
        or session.issued_at > now
        or session.expires_at <= now
        or session.expires_at > now + MAX_RUNTIME_SECONDS
    ):
        _deny("FRESH_PASSWORD_AMR_REQUIRED")
    return session


def _validate_counts(counts: object) -> tuple[int, int, int, int]:
    if type(counts) is not tuple or len(counts) != 4 or not all(_safe_count(value) for value in counts):
        _deny("RECEIPT_INVALID")
    return counts


def _validate_final(receipt: object, binding: VerifiedSubjectBinding, request_hash: str) -> DeletionFinalReceipt:
    if (
        type(receipt) is not DeletionFinalReceipt
        or receipt.request_binding_sha256 != request_hash
        or receipt.subject_binding_sha256 != binding.test_subject_binding_sha256
        or receipt.status != "APPLIED"
        or receipt.reason_code != "APPLIED"
        or receipt.readback != (True, True, True, True)
        or type(receipt.storage_receipt_refs) is not tuple
        or len(receipt.storage_receipt_refs) != 0
        or not _opaque(receipt.auth_receipt_ref)
        or receipt.replayed is not False
    ):
        _deny("ACCOUNT_DELETION_READBACK_INCOMPLETE")
    _validate_counts(receipt.counts)
    return receipt


_RESULT_KEYS = frozenset({
    "schema", "status", "source_commit", "target_fingerprint",
    "terminal_readback_sha256", "freeze_assertion_sha256",
    "controller_continuity_sha256", "continuity_observed_at", "continuity_expires_at",
    "publication_deadline", "test_subject_binding_sha256", "account_deletion", "retention",
    "no_non_test_subject_selected", "scheduled_workers_remained_stopped",
    "issued_at",
})
_DELETION_RESULT_KEYS = frozenset({
    "request_binding_sha256", "status", "reason_code", "counts", "readback",
    "storage_receipt_count", "storage_receipt_root_sha256",
    "auth_receipt_reference_sha256",
})
_RETENTION_RESULT_KEYS = frozenset({
    "class_code_sha256", "cutoff", "preview", "operation_binding_sha256",
    "status", "reason_code", "readback", "audit_id_sha256",
})


def verify_sanitized_runtime_receipt(payload: object) -> dict[str, Any]:
    """Reject missing/additional fields, unbounded counts, and partial readback."""

    if type(payload) is not dict or frozenset(payload) != _RESULT_KEYS:
        _deny("SANITIZED_RECEIPT_INVALID")
    assert isinstance(payload, dict)
    deletion = payload.get("account_deletion")
    retention = payload.get("retention")
    if (
        payload.get("schema") != SCHEMA
        or payload.get("status") != "APPLIED"
        or type(payload.get("source_commit")) is not str
        or not _HEX40.fullmatch(payload["source_commit"])
        or payload.get("target_fingerprint") != TARGET_FINGERPRINT
        or not all(type(payload.get(key)) is str and _HEX64.fullmatch(payload[key])
                   for key in ("terminal_readback_sha256", "freeze_assertion_sha256",
                               "controller_continuity_sha256", "test_subject_binding_sha256"))
        or payload.get("no_non_test_subject_selected") is not True
        or payload.get("scheduled_workers_remained_stopped") is not True
        or type(payload.get("issued_at")) is not int
        or type(payload.get("continuity_observed_at")) is not int
        or type(payload.get("continuity_expires_at")) is not int
        or type(payload.get("publication_deadline")) is not int
        or payload["issued_at"] > payload["continuity_observed_at"]
        or payload["continuity_observed_at"] >= payload["continuity_expires_at"]
        or payload["continuity_expires_at"] > payload["publication_deadline"]
        or type(deletion) is not dict
        or frozenset(deletion) != _DELETION_RESULT_KEYS
        or deletion.get("status") != "APPLIED"
        or deletion.get("reason_code") != "APPLIED"
        or deletion.get("storage_receipt_count") != 0
        or not all(type(deletion.get(key)) is str and _HEX64.fullmatch(deletion[key])
                   for key in ("request_binding_sha256", "storage_receipt_root_sha256",
                               "auth_receipt_reference_sha256"))
        or type(deletion.get("counts")) is not dict
        or tuple(deletion["counts"]) != ("delete", "anonymize", "separate", "retain")
        or not all(_safe_count(value) for value in deletion["counts"].values())
        or deletion.get("readback") != {
            "database": True, "storage": True, "sessions": True, "auth": True,
        }
        or type(retention) is not dict
        or frozenset(retention) != _RETENTION_RESULT_KEYS
        or retention.get("status") != "APPLIED"
        or retention.get("reason_code") != "APPLIED"
        or not all(type(retention.get(key)) is str and _HEX64.fullmatch(retention[key])
                   for key in ("class_code_sha256", "operation_binding_sha256", "audit_id_sha256"))
        or type(retention.get("cutoff")) is not str
        or not _CUTOFF.fullmatch(retention["cutoff"])
        or retention.get("preview") != {"eligible": 0, "held": 0, "scanned": 0}
        or retention.get("readback") != {key: True for key in RETENTION_READBACK_KEYS}
    ):
        _deny("SANITIZED_RECEIPT_INVALID")
    return payload

def build_runtime_proof(
    *,
    signed_opaque_binding: bytes,
    expected_source_commit: str,
    now: int,
    verifier: BindingVerifier,
    continuity: ControllerContinuityVerifier,
    account_deletion: AccountDeletionAdapter,
    retention: RetentionAdapter,
    signer: ResultSigner,
) -> dict[str, Any]:
    """Execute only the signed subject/run bindings and persist a sanitized proof."""

    binding = verify_opaque_runtime_binding(
        signed_opaque_binding,
        expected_source_commit,
        now,
        verifier,
    )
    deadline = min(binding.expires_at, now + MAX_RUNTIME_SECONDS)

    session = _validate_session(
        _call(account_deletion.fresh_password_session, binding.subject_handle, deadline_unix=deadline),
        binding,
        now,
    )
    preview = _call(
        account_deletion.preview_self_delete,
        binding.subject_handle,
        session,
        deadline_unix=deadline,
    )
    if (
        type(preview) is not DeletionPreview
        or not all(_opaque(value) for value in (preview.request_id, preview.preview_hash, preview.source_manifest_hash))
        or not _HEX64.fullmatch(preview.request_binding_sha256)
        or preview.subject_binding_sha256 != binding.test_subject_binding_sha256
        or type(preview.expires_at) is not int
        or preview.expires_at <= now
        or preview.expires_at > deadline
    ):
        _deny("ACCOUNT_DELETION_PREVIEW_INVALID")

    proof = _call(
        account_deletion.issue_reauth_proof,
        binding.subject_handle,
        session,
        deadline_unix=deadline,
    )
    if (
        type(proof) is not ReauthProof
        or not _opaque(proof.proof_id)
        or proof.subject_binding_sha256 != binding.test_subject_binding_sha256
        or proof.session_binding_sha256 != session.session_binding_sha256
        or type(proof.expires_at) is not int
        or proof.expires_at <= now
        or proof.expires_at > min(deadline, session.expires_at)
    ):
        _deny("REAUTH_PROOF_INVALID")

    for case, reason_code in REAUTH_DENIALS.items():
        denial = _call(
            account_deletion.prove_reauth_denial,
            binding.subject_handle,
            case,
            deadline_unix=deadline,
        )
        if (
            type(denial) is not ReauthDenialReceipt
            or denial.case != case
            or denial.denied is not True
            or denial.reason_code != reason_code
            or denial.subject_binding_sha256 != binding.test_subject_binding_sha256
        ):
            _deny("REAUTH_NEGATIVE_PROOF_INCOMPLETE")

    idempotency_key = "g038-" + _hash({
        "request_binding_sha256": preview.request_binding_sha256,
        "subject_binding_sha256": binding.test_subject_binding_sha256,
    })
    delete_request = SelfDeleteRequest(
        userId=binding.subject_handle,
        proofId=proof.proof_id,
        requestId=preview.request_id,
        previewHash=preview.preview_hash,
        confirmationText="계정 삭제",
        idempotencyKey=idempotency_key,
        sourceManifestHash=preview.source_manifest_hash,
    )
    started = _call(account_deletion.delete_self, session, delete_request, deadline_unix=deadline)
    if (
        type(started) is not DeletionStartReceipt
        or started.request_binding_sha256 != preview.request_binding_sha256
        or started.subject_binding_sha256 != binding.test_subject_binding_sha256
        or started.status != "in_progress"
        or started.reason_code != "DB_READBACK_PASSED"
        or started.lifecycle_state != "pre_auth_db_cleanup_complete"
        or started.route_authenticated is not True
        or started.auth_subject_present is not True
        or started.replayed is not False
    ):
        _deny("ACCOUNT_DELETION_START_INVALID")
    start_counts = _validate_counts(started.counts)

    same_replay = _call(account_deletion.delete_self, session, delete_request, deadline_unix=deadline)
    if (
        type(same_replay) is not DeletionStartReceipt
        or same_replay.request_binding_sha256 != preview.request_binding_sha256
        or same_replay.subject_binding_sha256 != binding.test_subject_binding_sha256
        or same_replay.status != started.status
        or same_replay.reason_code != started.reason_code
        or same_replay.counts != start_counts
        or same_replay.lifecycle_state != "pre_auth_db_cleanup_complete"
        or same_replay.route_authenticated is not True
        or same_replay.auth_subject_present is not True
        or same_replay.replayed is not True
    ):
        _deny("SAME_KEY_REPLAY_INVALID")

    different_request = dataclasses.replace(delete_request, idempotencyKey=idempotency_key + "-different")
    different_replay = _call(account_deletion.delete_self, session, different_request, deadline_unix=deadline)
    if (
        type(different_replay) is not ReplayDenialReceipt
        or different_replay.request_binding_sha256 != preview.request_binding_sha256
        or different_replay.subject_binding_sha256 != binding.test_subject_binding_sha256
        or different_replay.denied is not True
        or different_replay.reason_code != "IDEMPOTENCY_KEY_MISMATCH"
        or different_replay.lifecycle_state != "pre_auth_db_cleanup_complete"
        or different_replay.route_authenticated is not True
        or different_replay.auth_subject_present is not True
    ):
        _deny("DIFFERENT_KEY_REPLAY_NOT_DENIED")

    inventory = _call(account_deletion.list_bound_storage, session, delete_request, deadline_unix=deadline)
    if (
        type(inventory) is not StorageInventory
        or inventory.request_binding_sha256 != preview.request_binding_sha256
        or inventory.subject_binding_sha256 != binding.test_subject_binding_sha256
        or inventory.object_count != 0
    ):
        _deny("STORAGE_OBJECTS_NOT_ZERO")

    for phase in PHASES:
        phase_receipt = _call(
            account_deletion.drive_bound_phase,
            session,
            delete_request,
            phase,
            deadline_unix=deadline,
        )
        if (
            type(phase_receipt) is not BoundPhaseReceipt
            or phase_receipt.phase != phase
            or phase_receipt.request_binding_sha256 != preview.request_binding_sha256
            or phase_receipt.subject_binding_sha256 != binding.test_subject_binding_sha256
            or phase_receipt.complete is not True
            or phase_receipt.queue_claimed is not False
        ):
            _deny("BOUND_PHASE_INVALID")

    final = _validate_final(
        _call(account_deletion.read_bound_status, session, delete_request, deadline_unix=deadline),
        binding,
        preview.request_binding_sha256,
    )
    if final.counts != start_counts:
        _deny("ACCOUNT_DELETION_COUNT_DRIFT")


    retention_preview = _call(
        retention.preview_bound,
        binding.retention_class_code,
        binding.retention_cutoff,
        binding.retention_operation_binding_sha256,
        deadline_unix=deadline,
    )
    if (
        type(retention_preview) is not RetentionPreview
        or not all(_opaque(value) for value in (
            retention_preview.operation_id,
            retention_preview.preview_hash,
            retention_preview.idempotency_key,
            retention_preview.adapter_version,
            retention_preview.source_mapping_version,
        ))
        or retention_preview.class_code_sha256 != binding.retention_class_code_sha256
        or retention_preview.operation_binding_sha256 != binding.retention_operation_binding_sha256
        or retention_preview.cutoff != binding.retention_cutoff
        or not all(_safe_count(value) for value in (
            retention_preview.eligible_count,
            retention_preview.held_count,
            retention_preview.scanned_count,
        ))
        or (retention_preview.eligible_count, retention_preview.held_count, retention_preview.scanned_count) != (0, 0, 0)
    ):
        _deny("RETENTION_PREVIEW_NOT_EMPTY")

    confirmation = _call(retention.confirm_bound, retention_preview, deadline_unix=deadline)
    if (
        type(confirmation) is not RetentionConfirmation
        or confirmation.operation_id != retention_preview.operation_id
        or confirmation.preview_hash != retention_preview.preview_hash
        or confirmation.operation_binding_sha256 != retention_preview.operation_binding_sha256
        or confirmation.status != "confirmed"
        or type(confirmation.confirmed_at) is not int
        or type(confirmation.expires_at) is not int
        or confirmation.confirmed_at < now
        or confirmation.confirmed_at >= deadline
        or confirmation.expires_at <= confirmation.confirmed_at
        or confirmation.expires_at > deadline
        or confirmation.replayed is not False
        or type(confirmation.confirmation_binding_sha256) is not str
        or not _HEX64.fullmatch(confirmation.confirmation_binding_sha256)
        or confirmation.confirmation_binding_sha256 != _hash({
            "operation_id": confirmation.operation_id,
            "preview_hash": confirmation.preview_hash,
            "operation_binding_sha256": confirmation.operation_binding_sha256,
            "status": confirmation.status,
            "confirmed_at": confirmation.confirmed_at,
            "expires_at": confirmation.expires_at,
            "replayed": confirmation.replayed,
        })
    ):
        _deny("RETENTION_CONFIRMATION_INVALID")
    retention_final = _call(
        retention.finalize_bound,
        retention_preview,
        confirmation,
        deadline_unix=deadline,
    )
    if (
        type(retention_final) is not RetentionFinalReceipt
        or retention_final.operation_binding_sha256 != binding.retention_operation_binding_sha256
        or retention_final.status != "APPLIED"
        or retention_final.reason_code != "APPLIED"
        or type(retention_final.readback) is not dict
        or tuple(retention_final.readback) != RETENTION_READBACK_KEYS
        or any(retention_final.readback[key] is not True for key in RETENTION_READBACK_KEYS)
        or not _opaque(retention_final.audit_id)
    ):
        _deny("RETENTION_READBACK_INCOMPLETE")

    continuity_receipt = _call(
        continuity.confirm_fresh_continuity,
        expected_freeze_assertion_sha256=binding.freeze_assertion_sha256,
        deadline_unix=deadline,
    )
    if type(continuity_receipt) is not ControllerContinuityReceipt:
        _deny("CONTROLLER_CONTINUITY_INVALID")
    assert isinstance(continuity_receipt, ControllerContinuityReceipt)
    continuity_evidence = {
        "freeze_assertion_sha256": continuity_receipt.freeze_assertion_sha256,
        "worker_state_sha256": continuity_receipt.worker_state_sha256,
        "observed_at": continuity_receipt.observed_at,
        "expires_at": continuity_receipt.expires_at,
        "freeze_continuous": continuity_receipt.freeze_continuous,
        "scheduled_workers_stopped": continuity_receipt.scheduled_workers_stopped,
        "no_in_flight_work": continuity_receipt.no_in_flight_work,
    }
    if (
        continuity_receipt.freeze_assertion_sha256 != binding.freeze_assertion_sha256
        or type(continuity_receipt.worker_state_sha256) is not str
        or not _HEX64.fullmatch(continuity_receipt.worker_state_sha256)
        or continuity_receipt.evidence_sha256 != _hash(continuity_evidence)
        or type(continuity_receipt.observed_at) is not int
        or type(continuity_receipt.expires_at) is not int
        or continuity_receipt.observed_at < now
        or continuity_receipt.observed_at >= deadline
        or continuity_receipt.observed_at > now + MAX_RUNTIME_SECONDS
        or continuity_receipt.expires_at <= continuity_receipt.observed_at
        or continuity_receipt.expires_at > deadline
        or continuity_receipt.expires_at - continuity_receipt.observed_at > MAX_CONTINUITY_AGE_SECONDS
        or continuity_receipt.freeze_continuous is not True
        or continuity_receipt.scheduled_workers_stopped is not True
        or continuity_receipt.no_in_flight_work is not True
    ):
        _deny("CONTROLLER_CONTINUITY_INVALID")
    publication_deadline = min(deadline, continuity_receipt.expires_at)

    payload: dict[str, Any] = {
        "schema": SCHEMA,
        "status": "APPLIED",
        "source_commit": expected_source_commit,
        "target_fingerprint": TARGET_FINGERPRINT,
        "terminal_readback_sha256": binding.terminal_readback_sha256,
        "freeze_assertion_sha256": binding.freeze_assertion_sha256,
        "controller_continuity_sha256": continuity_receipt.evidence_sha256,
        "continuity_observed_at": continuity_receipt.observed_at,
        "continuity_expires_at": continuity_receipt.expires_at,
        "publication_deadline": publication_deadline,
        "test_subject_binding_sha256": binding.test_subject_binding_sha256,
        "account_deletion": {
            "request_binding_sha256": preview.request_binding_sha256,
            "status": final.status,
            "reason_code": final.reason_code,
            "counts": {
                "delete": final.counts[0],
                "anonymize": final.counts[1],
                "separate": final.counts[2],
                "retain": final.counts[3],
            },
            "readback": {
                "database": final.readback[0],
                "storage": final.readback[1],
                "sessions": final.readback[2],
                "auth": final.readback[3],
            },
            "storage_receipt_count": 0,
            "storage_receipt_root_sha256": _hash([]),
            "auth_receipt_reference_sha256": hashlib.sha256(final.auth_receipt_ref.encode("ascii")).hexdigest(),
        },
        "retention": {
            "class_code_sha256": binding.retention_class_code_sha256,
            "cutoff": binding.retention_cutoff,
            "preview": {"eligible": 0, "held": 0, "scanned": 0},
            "operation_binding_sha256": binding.retention_operation_binding_sha256,
            "status": retention_final.status,
            "reason_code": retention_final.reason_code,
            "readback": dict(retention_final.readback),
            "audit_id_sha256": hashlib.sha256(retention_final.audit_id.encode("ascii")).hexdigest(),
        },
        "no_non_test_subject_selected": True,
        "scheduled_workers_remained_stopped": True,
        "issued_at": now,
    }
    verify_sanitized_runtime_receipt(payload)
    canonical_payload = canonical_runtime_payload(payload)
    canonical_payload_sha256 = hashlib.sha256(canonical_payload).hexdigest()
    signing = _call(signer.sign_and_store, canonical_payload, deadline_unix=publication_deadline)
    if (
        type(signing) is not SigningReceipt
        or signing.payload_sha256 != canonical_payload_sha256
        or type(signing.published_at) is not int
        or signing.published_at < continuity_receipt.observed_at
        or signing.published_at >= continuity_receipt.expires_at
        or signing.published_at > publication_deadline
        or signing.durable is not True
    ):
        _deny("RESULT_SIGNATURE_NOT_DURABLE")
    return payload


build_sanitized_runtime_receipt = build_runtime_proof


__all__ = [
    "AccountDeletionAdapter", "BINDING_SCHEMA", "BindingVerifier", "BoundPhaseReceipt",
    "ControllerContinuityReceipt", "ControllerContinuityVerifier", "DeletionFinalReceipt",
    "DeletionPreview", "DeletionStartReceipt", "FreshPasswordSession",
    "PREDECESSOR_COMMIT", "PREDECESSOR_REPORT_SHA256", "ReauthDenialReceipt", "ReauthProof",
    "ReplayDenialReceipt", "ResultSigner", "RetentionAdapter", "RetentionConfirmation",
    "RetentionFinalReceipt", "RetentionPreview", "RuntimeProofDenied", "SCHEMA", "SelfDeleteRequest",
    "SigningReceipt", "StorageInventory", "TARGET_FINGERPRINT", "VerifiedSubjectBinding",
    "build_runtime_proof", "build_sanitized_runtime_receipt", "canonical_runtime_payload",
    "validate_disposable_subject", "verify_opaque_runtime_binding", "verify_sanitized_runtime_receipt",
]
