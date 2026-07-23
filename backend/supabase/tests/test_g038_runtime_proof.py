from __future__ import annotations

import hashlib
import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_runtime_proof as proof

NOW = 1_800_000_000
SOURCE_COMMIT = "1" * 40
H = "a" * 64
SUBJECT = "subject-secret-opaque-0001"
CLASS_CODE = "disposable_test_class"
AUTH_RECEIPT = "auth-receipt-secret-0001"
AUDIT_ID = "audit-id-secret-0001"


def canonical_hash(value):
    raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("ascii")).hexdigest()


def subject_binding(**changes):
    value = proof.VerifiedSubjectBinding(
        schema=proof.BINDING_SCHEMA,
        predecessor_report_sha256=proof.PREDECESSOR_REPORT_SHA256,
        predecessor_commit=proof.PREDECESSOR_COMMIT,
        source_commit=SOURCE_COMMIT,
        target_fingerprint=proof.TARGET_FINGERPRINT,
        terminal_readback_sha256="2" * 64,
        freeze_assertion_sha256="3" * 64,
        subject_handle=SUBJECT,
        test_subject_binding_sha256="4" * 64,
        retention_class_code=CLASS_CODE,
        retention_class_code_sha256=canonical_hash({"class_code": CLASS_CODE}),
        retention_cutoff="2026-07-23T00:00:00Z",
        retention_operation_binding_sha256="5" * 64,
        issued_at=NOW - 10,
        expires_at=NOW + 300,
        disposable=True,
        self_owned=True,
        non_admin=True,
        storage_object_count=0,
        no_non_test_subject_selected=True,
        scheduled_workers_remained_stopped=True,
    )
    return replace(value, **changes)


class Verifier:
    def __init__(self, binding=None):
        self.binding = binding or subject_binding()
        self.seen = []

    def verify_subject_binding(self, opaque):
        self.seen.append(opaque)
        return self.binding


class Deletion:
    def __init__(self):
        self.binding = subject_binding()
        self.calls = []
        self.denial_cases = []
        self.object_count = 0
        self.queue_claimed = False
        self.final_readback = (True, True, True, True)
        self.same_replay = True
        self.different_key_denied = True
        self.preview_subject_hash = self.binding.test_subject_binding_sha256
        self.lifecycle_state = "pre_auth_db_cleanup_complete"
    def fresh_password_session(self, subject_handle, *, deadline_unix):
        self.calls.append(("fresh", subject_handle, deadline_unix))
        return proof.FreshPasswordSession(
            "session-secret-0001", self.binding.test_subject_binding_sha256,
            "6" * 64, True, NOW, NOW + 120,
        )

    def preview_self_delete(self, subject_handle, session, *, deadline_unix):
        self.calls.append(("preview", subject_handle, deadline_unix))
        return proof.DeletionPreview(
            "request-secret-0001", "preview-secret-0001", "manifest-secret-0001",
            "7" * 64, self.preview_subject_hash, NOW + 120,
        )

    def issue_reauth_proof(self, subject_handle, session, *, deadline_unix):
        self.calls.append(("issue", subject_handle, deadline_unix))
        return proof.ReauthProof(
            "reauth-proof-secret-0001", self.binding.test_subject_binding_sha256,
            session.session_binding_sha256, NOW + 100,
        )

    def prove_reauth_denial(self, subject_handle, case, *, deadline_unix):
        self.denial_cases.append(case)
        return proof.ReauthDenialReceipt(
            case, True, proof.REAUTH_DENIALS[case], self.binding.test_subject_binding_sha256,
        )

    def delete_self(self, session, request, *, deadline_unix):
        self.calls.append(("delete", request, deadline_unix))
        delete_number = sum(call[0] == "delete" for call in self.calls)
        if delete_number in (1, 2):
            if delete_number == 2 and not self.same_replay:
                return proof.ReplayDenialReceipt(
                    "7" * 64, self.binding.test_subject_binding_sha256, True,
                    "REPLAY_DENIED", self.lifecycle_state, True, True,
                )
            return proof.DeletionStartReceipt(
                "7" * 64, self.binding.test_subject_binding_sha256,
                "in_progress", "DB_READBACK_PASSED", (3, 2, 1, 0),
                self.lifecycle_state, True, True, delete_number == 2,
            )
        if self.different_key_denied:
            return proof.ReplayDenialReceipt(
                "7" * 64, self.binding.test_subject_binding_sha256, True,
                "IDEMPOTENCY_KEY_MISMATCH", self.lifecycle_state, True, True,
            )
        return proof.DeletionStartReceipt(
            "7" * 64, self.binding.test_subject_binding_sha256,
            "in_progress", "DB_READBACK_PASSED", (3, 2, 1, 0),
            self.lifecycle_state, True, True, True,
        )

    def list_bound_storage(self, session, request, *, deadline_unix):
        self.calls.append(("list_bound_storage", request.requestId, deadline_unix))
        return proof.StorageInventory(
            "7" * 64, self.binding.test_subject_binding_sha256, self.object_count,
        )

    def drive_bound_phase(self, session, request, phase, *, deadline_unix):
        self.calls.append(("drive_bound_phase", phase, request.requestId, deadline_unix))
        return proof.BoundPhaseReceipt(
            phase, "7" * 64, self.binding.test_subject_binding_sha256,
            True, self.queue_claimed,
        )

    def read_bound_status(self, session, request, *, deadline_unix):
        self.calls.append(("read_bound_status", request.requestId, deadline_unix))
        return self.final(replayed=False)

    def final(self, *, replayed):
        return proof.DeletionFinalReceipt(
            "7" * 64, self.binding.test_subject_binding_sha256, "APPLIED", "APPLIED",
            (3, 2, 1, 0), self.final_readback, (), AUTH_RECEIPT, replayed,
        )


class Retention:
    def __init__(self):
        self.binding = subject_binding()
        self.counts = (0, 0, 0)
        self.readback = {key: True for key in proof.RETENTION_READBACK_KEYS}
        self.calls = []
        self.confirmation_changes = {}
        self.confirmation = None

    def preview_bound(self, class_code, cutoff, operation_binding_sha256, *, deadline_unix):
        self.calls.append(("preview", class_code, cutoff, operation_binding_sha256, deadline_unix))
        return proof.RetentionPreview(
            "operation-secret-0001", "retention-preview-secret-0001",
            "retention-key-secret-0001", "8" * 64, "9" * 64,
            self.binding.retention_class_code_sha256,
            self.binding.retention_operation_binding_sha256,
            self.binding.retention_cutoff,
            *self.counts,
        )

    def confirm_bound(self, preview, *, deadline_unix):
        self.calls.append(("confirm", preview.operation_id, deadline_unix))
        values = {
            "operation_id": preview.operation_id,
            "preview_hash": preview.preview_hash,
            "operation_binding_sha256": preview.operation_binding_sha256,
            "status": "confirmed",
            "confirmed_at": NOW,
            "expires_at": NOW + 120,
            "replayed": False,
        }
        confirmation_binding_override = self.confirmation_changes.get("confirmation_binding_sha256")
        values.update({
            key: value
            for key, value in self.confirmation_changes.items()
            if key != "confirmation_binding_sha256"
        })
        self.confirmation = proof.RetentionConfirmation(
            confirmation_binding_sha256=confirmation_binding_override or canonical_hash(values),
            **values,
        )
        return self.confirmation

    def finalize_bound(self, preview, confirmation, *, deadline_unix):
        if confirmation is not self.confirmation:
            raise RuntimeError("exact confirmation required")
        self.calls.append(("finalize", preview.operation_id, confirmation, deadline_unix))
        return proof.RetentionFinalReceipt(
            preview.operation_binding_sha256, "APPLIED", "APPLIED", self.readback, AUDIT_ID,
        )


class Continuity:
    def __init__(self, events):
        self.events = events
        self.observed_at = NOW + 250
        self.expires_at = NOW + 280
        self.freeze_continuous = True
        self.scheduled_workers_stopped = True
        self.no_in_flight_work = True
        self.evidence_digest_valid = True
        self.calls = []

    def confirm_fresh_continuity(self, *, expected_freeze_assertion_sha256, deadline_unix):
        self.events.append("continuity")
        self.calls.append((expected_freeze_assertion_sha256, deadline_unix))
        evidence = {
            "freeze_assertion_sha256": expected_freeze_assertion_sha256,
            "worker_state_sha256": "b" * 64,
            "observed_at": self.observed_at,
            "expires_at": self.expires_at,
            "freeze_continuous": self.freeze_continuous,
            "scheduled_workers_stopped": self.scheduled_workers_stopped,
            "no_in_flight_work": self.no_in_flight_work,
        }
        digest = canonical_hash(evidence) if self.evidence_digest_valid else "c" * 64
        return proof.ControllerContinuityReceipt(
            evidence["freeze_assertion_sha256"], evidence["worker_state_sha256"], digest,
            evidence["observed_at"], evidence["expires_at"], evidence["freeze_continuous"],
            evidence["scheduled_workers_stopped"], evidence["no_in_flight_work"],
        )


class Signer:
    def __init__(self, events):
        self.events = events
        self.payload = None
        self.deadline = None
        self.durable = True
        self.published_at = NOW + 260
        self.digest_override = None

    def sign_and_store(self, canonical_payload, *, deadline_unix):
        self.events.append("sign")
        self.payload = canonical_payload
        self.deadline = deadline_unix
        digest = hashlib.sha256(canonical_payload).hexdigest()
        return proof.SigningReceipt(
            self.digest_override or digest, self.published_at, self.durable,
        )

class G038RuntimeProofTests(unittest.TestCase):
    def execute(self, *, binding=None, deletion=None, retention=None, continuity=None, signer=None):
        events = []
        verifier = Verifier(binding)
        deletion = deletion or Deletion()
        retention = retention or Retention()
        continuity = continuity or Continuity(events)
        signer = signer or Signer(events)
        result = proof.build_runtime_proof(
            signed_opaque_binding=b"detached-signed-binding",
            expected_source_commit=SOURCE_COMMIT,
            now=NOW,
            verifier=verifier,
            continuity=continuity,
            account_deletion=deletion,
            retention=retention,
            signer=signer,
        )
        return result, verifier, deletion, retention, continuity, signer

    def assert_denied(self, reason, **kwargs):
        with self.assertRaises(proof.RuntimeProofDenied) as caught:
            self.execute(**kwargs)
        self.assertEqual(caught.exception.reason_code, reason)

    def test_success_uses_exact_self_delete_and_only_bound_phases(self):
        result, verifier, deletion, retention, continuity, signer = self.execute()
        self.assertEqual(verifier.seen, [b"detached-signed-binding"])
        delete_requests = [call[1] for call in deletion.calls if call[0] == "delete"]
        self.assertEqual(len(delete_requests), 3)
        self.assertEqual(
            tuple(delete_requests[0].__dataclass_fields__),
            ("userId", "proofId", "requestId", "previewHash", "confirmationText", "idempotencyKey", "sourceManifestHash"),
        )
        self.assertEqual(delete_requests[0].userId, SUBJECT)
        self.assertEqual(delete_requests[0].idempotencyKey, delete_requests[1].idempotencyKey)
        self.assertNotEqual(delete_requests[0].idempotencyKey, delete_requests[2].idempotencyKey)
        self.assertEqual(
            [call[1] for call in deletion.calls if call[0] == "drive_bound_phase"],
            ["session", "storage", "auth"],
        )
        self.assertFalse(any(call[0] in {"claim", "claim_next", "claim-next"} for call in deletion.calls))
        call_names = [call[0] for call in deletion.calls]
        self.assertLess(
            max(index for index, name in enumerate(call_names) if name == "delete"),
            min(index for index, name in enumerate(call_names) if name == "drive_bound_phase"),
        )
        self.assertLess(
            max(index for index, name in enumerate(call_names) if name == "drive_bound_phase"),
            call_names.index("read_bound_status"),
        )
        self.assertEqual(deletion.denial_cases, ["wrong_session", "wrong_user", "expired", "replayed"])
        self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm", "finalize"])
        self.assertEqual(continuity.events, ["continuity", "sign"])
        self.assertEqual(signer.payload, proof.canonical_runtime_payload(result))
        self.assertEqual(signer.deadline, result["publication_deadline"])
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual(result["account_deletion"]["storage_receipt_count"], 0)
        self.assertTrue(all(result["account_deletion"]["readback"].values()))
        self.assertEqual(result["retention"]["preview"], {"eligible": 0, "held": 0, "scanned": 0})
        self.assertTrue(all(result["retention"]["readback"].values()))

    def test_arbitrary_subject_is_denied_before_effects(self):
        deletion = Deletion()
        deletion.preview_subject_hash = "f" * 64
        self.assert_denied("ACCOUNT_DELETION_PREVIEW_INVALID", deletion=deletion)
        self.assertFalse(any(call[0] == "delete" for call in deletion.calls))

    def test_binding_cannot_authorize_admin_or_non_disposable_subject(self):
        for changes in ({"non_admin": False}, {"self_owned": False}, {"disposable": False}):
            with self.subTest(changes=changes):
                self.assert_denied("BINDING_INVALID", binding=subject_binding(**changes))

    def test_queue_selection_signal_is_denied(self):
        deletion = Deletion()
        deletion.queue_claimed = True
        self.assert_denied("BOUND_PHASE_INVALID", deletion=deletion)

    def test_positive_storage_is_denied_in_binding_and_readback(self):
        self.assert_denied("BINDING_INVALID", binding=subject_binding(storage_object_count=1))
        deletion = Deletion()
        deletion.object_count = 1
        self.assert_denied("STORAGE_OBJECTS_NOT_ZERO", deletion=deletion)

    def test_positive_retention_counts_stop_before_confirm(self):
        for counts in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
            with self.subTest(counts=counts):
                retention = Retention()
                retention.counts = counts
                self.assert_denied("RETENTION_PREVIEW_NOT_EMPTY", retention=retention)
                self.assertEqual([call[0] for call in retention.calls], ["preview"])

    def test_retention_exact_confirmation_is_required_for_finalization(self):
        retention = Retention()
        self.execute(retention=retention)
        finalization = retention.calls[-1]
        self.assertEqual(finalization[0], "finalize")
        self.assertIs(finalization[2], retention.confirmation)

        preview = retention.preview_bound(
            CLASS_CODE,
            retention.binding.retention_cutoff,
            retention.binding.retention_operation_binding_sha256,
            deadline_unix=NOW + 300,
        )
        with self.assertRaises(TypeError):
            retention.finalize_bound(preview, deadline_unix=NOW + 300)
        with self.assertRaises(RuntimeError):
            retention.finalize_bound(
                preview,
                replace(retention.confirmation, preview_hash="other-preview-hash"),
                deadline_unix=NOW + 300,
            )

    def test_retention_confirmation_must_match_exact_preview(self):
        retention = Retention()
        retention.confirmation_changes = {"preview_hash": "other-preview-hash"}
        self.assert_denied("RETENTION_CONFIRMATION_INVALID", retention=retention)
        self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm"])

    def test_retention_confirmation_must_match_exact_operation(self):
        retention = Retention()
        retention.confirmation_changes = {"operation_id": "other-operation-id"}
        self.assert_denied("RETENTION_CONFIRMATION_INVALID", retention=retention)
        self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm"])

        retention = Retention()
        retention.confirmation_changes = {"operation_binding_sha256": "6" * 64}
        self.assert_denied("RETENTION_CONFIRMATION_INVALID", retention=retention)
        self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm"])

        retention = Retention()
        retention.confirmation_changes = {"confirmation_binding_sha256": "6" * 64}
        self.assert_denied("RETENTION_CONFIRMATION_INVALID", retention=retention)
        self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm"])

    def test_retention_stale_or_replayed_confirmation_is_denied(self):
        for changes in (
            {"confirmed_at": NOW - 1},
            {"expires_at": NOW},
            {"replayed": True},
        ):
            retention = Retention()
            retention.confirmation_changes = changes
            with self.subTest(changes=changes):
                self.assert_denied("RETENTION_CONFIRMATION_INVALID", retention=retention)
                self.assertEqual([call[0] for call in retention.calls], ["preview", "confirm"])

    def test_same_key_replay_must_succeed(self):
        deletion = Deletion()
        deletion.same_replay = False
        self.assert_denied("SAME_KEY_REPLAY_INVALID", deletion=deletion)

    def test_different_key_replay_must_be_denied(self):
        deletion = Deletion()
        deletion.different_key_denied = False
        self.assert_denied("DIFFERENT_KEY_REPLAY_NOT_DENIED", deletion=deletion)

    def test_replay_requires_authenticated_pre_auth_lifecycle_state(self):
        deletion = Deletion()
        deletion.lifecycle_state = "post_auth_deleted"
        self.assert_denied("ACCOUNT_DELETION_START_INVALID", deletion=deletion)
        self.assertFalse(any(call[0] == "drive_bound_phase" for call in deletion.calls))

    def test_authoritative_route_and_worker_support_proved_lifecycle(self):
        repository = Path(__file__).resolve().parents[3]
        route = (repository / "apps/web/app/api/account/delete/route.ts").read_text()
        worker = (repository / "apps/web/lib/privacy/account-deletion-worker.ts").read_text()
        delete_route = route[route.index("const deleteAccount = async"):]
        authenticate = delete_route.index("supabaseAdmin.auth.getUser(bearerToken)")
        replay_readback = delete_route.index("const replayReadbackResult")
        begin_apply = delete_route.index("begin_account_deletion_apply_with_reauth")
        cleanup = delete_route.index("apply_account_deletion_database_cleanup")
        accepted = delete_route.rindex("return noStoreJson({ status: 'accepted'")
        self.assertLess(authenticate, replay_readback)
        self.assertLess(replay_readback, begin_apply)
        self.assertLess(begin_apply, cleanup)
        self.assertLess(cleanup, accepted)
        self.assertIn("if (replayReadback)", delete_route)
        self.assertIn("idempotencyKeyBindingSha256(body.idempotencyKey)", delete_route)
        self.assertIn("if (input.phase === 'session')", worker)
        self.assertIn("return input.phase === 'storage' ? storage(context) : auth(context)", worker)
        self.assertIn("await context.dependencies.auth.deleteUser", worker)

    def test_partial_account_readback_is_denied(self):
        for index in range(4):
            deletion = Deletion()
            values = [True, True, True, True]
            values[index] = False
            deletion.final_readback = tuple(values)
            with self.subTest(index=index):
                self.assert_denied("ACCOUNT_DELETION_READBACK_INCOMPLETE", deletion=deletion)

    def test_partial_retention_readback_is_denied(self):
        for key in proof.RETENTION_READBACK_KEYS:
            retention = Retention()
            retention.readback[key] = False
            with self.subTest(key=key):
                self.assert_denied("RETENTION_READBACK_INCOMPLETE", retention=retention)

    def test_result_contains_only_sanitized_hashes_counts_and_codes(self):
        result, _, deletion, retention, _, _ = self.execute()
        encoded = json.dumps(result, sort_keys=True)
        secrets = (
            SUBJECT, CLASS_CODE, "session-secret-0001", "reauth-proof-secret-0001",
            "request-secret-0001", "preview-secret-0001", "manifest-secret-0001",
            "operation-secret-0001", "retention-preview-secret-0001",
            "retention-key-secret-0001", AUTH_RECEIPT, AUDIT_ID,
            "detached-signed-binding",
        )
        for secret in secrets:
            self.assertNotIn(secret, encoded)
        self.assertNotIn("signature", encoded.lower())
        self.assertEqual(
            set(result),
            {
                "schema", "status", "source_commit", "target_fingerprint",
                "terminal_readback_sha256", "freeze_assertion_sha256",
                "controller_continuity_sha256", "continuity_observed_at",
                "continuity_expires_at", "publication_deadline",
                "test_subject_binding_sha256", "account_deletion", "retention",
                "no_non_test_subject_selected", "scheduled_workers_remained_stopped",
                "issued_at",
            },
        )

    def test_sanitized_receipt_verifier_rejects_missing_additional_and_partial_fields(self):
        result, *_ = self.execute()
        for mutation in ("missing", "additional", "partial"):
            candidate = json.loads(json.dumps(result))
            if mutation == "missing":
                candidate.pop("freeze_assertion_sha256")
            elif mutation == "additional":
                candidate["raw_user_id"] = "must-not-be-admitted"
            else:
                candidate["account_deletion"]["readback"]["auth"] = False
            with self.subTest(mutation=mutation), self.assertRaises(proof.RuntimeProofDenied) as caught:
                proof.verify_sanitized_runtime_receipt(candidate)
            self.assertEqual(caught.exception.reason_code, "SANITIZED_RECEIPT_INVALID")

    def test_source_custody_and_signature_are_fail_closed(self):
        self.assert_denied("BINDING_INVALID", binding=subject_binding(source_commit="2" * 40))
        signer = Signer([])
        signer.durable = False
        self.assert_denied("RESULT_SIGNATURE_NOT_DURABLE", signer=signer)
        signer = Signer([])
        signer.digest_override = "d" * 64
        self.assert_denied("RESULT_SIGNATURE_NOT_DURABLE", signer=signer)

    def test_fresh_controller_continuity_and_publication_deadline_are_fail_closed(self):
        mutations = (
            ("freeze_continuous", False),
            ("scheduled_workers_stopped", False),
            ("no_in_flight_work", False),
            ("evidence_digest_valid", False),
        )
        for attribute, value in mutations:
            continuity = Continuity([])
            setattr(continuity, attribute, value)
            with self.subTest(attribute=attribute):
                self.assert_denied("CONTROLLER_CONTINUITY_INVALID", continuity=continuity)

        continuity = Continuity([])
        continuity.expires_at = continuity.observed_at + proof.MAX_CONTINUITY_AGE_SECONDS + 1
        self.assert_denied("CONTROLLER_CONTINUITY_INVALID", continuity=continuity)

        signer = Signer([])
        signer.published_at = NOW + 280
        self.assert_denied("RESULT_SIGNATURE_NOT_DURABLE", signer=signer)

    def test_signer_receives_only_exact_canonical_bytes(self):
        result, _, _, _, _, signer = self.execute()
        self.assertIs(type(signer.payload), bytes)
        self.assertEqual(json.loads(signer.payload.decode("ascii")), result)
        self.assertEqual(
            hashlib.sha256(proof.canonical_runtime_payload(result)).hexdigest(),
            hashlib.sha256(signer.payload).hexdigest(),
        )

    def test_invalid_signed_binding_never_reaches_adapters(self):
        deletion = Deletion()
        with self.assertRaises(proof.RuntimeProofDenied) as caught:
            proof.build_runtime_proof(
                signed_opaque_binding=b"",
                expected_source_commit=SOURCE_COMMIT,
                now=NOW,
                verifier=Verifier(),
                continuity=Continuity([]),
                account_deletion=deletion,
                retention=Retention(),
                signer=Signer([]),
            )
        self.assertEqual(caught.exception.reason_code, "BINDING_INVALID")
        self.assertEqual(deletion.calls, [])


if __name__ == "__main__":
    unittest.main()
