"""Synthetic receipt fixtures test admission, never establish live readiness."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.pipeline_control.manifest import record_parity_attempt
from backend.pipeline_control.tests.test_manifest_parity import _ok_payload
from backend.pipeline_control import rust_parity as rp, impl_selector as selector
from backend.pipeline_control.rust_promotion_evidence import digest
from backend.pipeline_control import rust_promotion_evidence as proof_module

SLICE = 'R1-validators'
ARTIFACT = 'tzudong-validators@sha256:' + 'f' * 64
PERFORMANCE_REF = {'path': 'apps/web/performance/fixture-admission.json', 'sha256': 'e' * 64}


class PromotionEvidenceTests(unittest.TestCase):
    def setUp(self):
        # These tests isolate live/approval/readback binding. The separate
        # performance adapter suite tests real retained files and validator calls.
        admission = patch.object(proof_module, 'verified_performance',
                                 side_effect=lambda ref, *_: ref == PERFORMANCE_REF)
        admission.start()
        self.addCleanup(admission.stop)
        self.applied_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.applied_directory.cleanup)
        self.applied_path = Path(self.applied_directory.name) / 'migration-ledger.json'
        applied_path_patch = patch.object(proof_module, '_LEDGER_PATH', self.applied_path)
        applied_path_patch.start()
        self.addCleanup(applied_path_patch.stop)
        self.blobs = {}
        self.results = []
        with tempfile.TemporaryDirectory() as tmp:
            for i in range(3):
                live = _ok_payload(job_id=f'fixture-live-{i}')
                self.ledger = record_parity_attempt(Path(tmp) / 'ledger.json', matched=True, candidate=live)
                self.results.append({'slice_id': SLICE, 'input_id': f'input-{i}',
                    'rust_artifact_id': ARTIFACT, 'matched': True, 'compared_fields': ['a'],
                    'normalization_rule_id': 'v1', 'mismatch_fields': [], 'mismatch_field_count': 0,
                    'result_code': None, 'liveJobId': live['jobId'],
                    'liveReceiptSha256': live['evidenceReceiptSha256']})

    def retain(self, value):
        raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
        ref = 'sha256:' + hashlib.sha256(raw).hexdigest()
        self.blobs[ref] = raw
        return ref

    def approval(self, purpose, binding):
        return {'kind': 'rust_operator_approval_v1', 'purpose': purpose, 'status': 'approved',
                'approverName': 'Fixture operator', 'approvedAt': '2026-09-05T00:00:00Z', 'binding': binding}

    def write_applied(self, entry):
        self.applied_path.write_text(json.dumps({'schemaVersion': 1, 'slices': [entry]}))

    def applied_gate(self):
        return selector.ledger_permits_rust_default(self.applied_entry,
                                                   evidence_loader=self.blobs.__getitem__)

    def proof(self, *, apply=True):
        binding = {'sliceId': SLICE, 'rustArtifactId': ARTIFACT,
                   'liveLedgerSha256': digest(self.ledger), 'parityResultsSha256': digest(self.results),
                   'performanceEvidenceRef': PERFORMANCE_REF}
        self.approval_ref = self.retain(self.approval('rust_default_switch', binding))
        reference = self.retain({'kind': 'rust_promotion_evidence_v2', 'sliceId': SLICE,
            'rustArtifactId': ARTIFACT, 'parityResults': self.results, 'liveLedger': self.ledger,
            'approvalRef': self.approval_ref, 'performanceEvidenceRef': PERFORMANCE_REF})
        entry = {'sliceId': SLICE, 'rustArtifactId': ARTIFACT, 'activeImplementation': 'rust',
                 'consecutiveMatchedCount': 3, 'promotionEvidenceRef': reference}
        state = {'schemaVersion': 1, 'slices': [entry]}
        self.readback_ref = self.retain({'kind': 'rust_promotion_readback_v2', 'binding': binding,
            'approvalRef': self.approval_ref, 'promotionEvidenceRef': reference,
            'observedAt': '2026-09-05T00:01:00Z',
            'appliedLedgerStateSha256': proof_module.applied_ledger_state_digest(state),
            'jobIds': [a['jobId'] for a in self.ledger['attempts'][-3:]],
            'receiptSha256s': [a['evidenceReceiptSha256'] for a in self.ledger['attempts'][-3:]]})
        self.applied_entry = {**entry, 'promotionReadbackRef': self.readback_ref}
        self.write_applied(self.applied_entry if apply else {**entry, 'activeImplementation': 'python'})
        return reference

    def test_precomputed_readback_cannot_enable_rust_before_apply(self):
        reference = self.proof(apply=False)
        proposal = self.decision(reference)
        self.assertTrue(proposal['allowed'])
        self.assertTrue(proposal['requiresReadback'])
        self.assertEqual(proposal['defaultImplementation'], 'python')
        self.assertEqual(proposal['proposedLedgerUpdate']['activeImplementation'], 'rust')
        self.assertFalse(self.applied_gate())
        self.write_applied(proposal['proposedLedgerUpdate'])
        self.assertFalse(self.applied_gate())  # no post-apply receipt attached
        self.write_applied(self.applied_entry)
        self.assertTrue(self.applied_gate())
        self.applied_path.unlink()
        self.assertFalse(self.applied_gate())

    def test_changed_actual_state_cannot_be_overridden_by_proposed_or_retained_objects(self):
        self.proof()
        for key, value in [('activeImplementation', 'python'), ('rustArtifactId', 'other'),
                           ('consecutiveMatchedCount', 4), ('promotionEvidenceRef', 'other'),
                           ('promotionReadbackRef', 'other'), ('replacementScope', 'changed')]:
            self.write_applied({**self.applied_entry, key: value})
            self.assertFalse(self.applied_gate(), key)
        self.write_applied(self.applied_entry)
        self.assertFalse(selector.ledger_permits_rust_default(
            {**self.applied_entry, 'replacementScope': 'changed'}, evidence_loader=self.blobs.__getitem__))
        self.assertTrue(self.applied_gate())

    def test_unreadable_aliased_or_duplicate_applied_state_fails_closed(self):
        self.proof()
        original = self.applied_path.read_bytes()
        self.applied_path.write_bytes(b'{"schemaVersion":1,"schemaVersion":1,"slices":[]}')
        self.assertFalse(self.applied_gate())
        self.applied_path.write_text(json.dumps({'schemaVersion': 1,
                                   'slices': [self.applied_entry, self.applied_entry]}))
        self.assertFalse(self.applied_gate())
        target = self.applied_path.with_name('other.json')
        target.write_bytes(original)
        self.applied_path.unlink()
        self.applied_path.symlink_to(target)
        self.assertFalse(self.applied_gate())

    def test_post_apply_readback_helper_reads_the_actual_ledger(self):
        reference = self.proof()
        evidence = self.decision(reference)['evidence']
        readback = {**evidence, 'promotionReadbackRef': self.readback_ref}
        self.assertTrue(rp.verify_switch_readback(evidence, readback,
                            evidence_loader=self.blobs.__getitem__)['verified'])
        substituted = {**evidence, 'inputIds': ['different']}
        self.assertFalse(rp.verify_switch_readback(substituted, {**readback, 'inputIds': ['different']},
                            evidence_loader=self.blobs.__getitem__)['verified'])
        self.write_applied({**self.applied_entry, 'activeImplementation': 'python'})
        self.assertFalse(rp.verify_switch_readback(evidence, readback,
                            evidence_loader=self.blobs.__getitem__)['verified'])

    def test_applied_readback_requires_post_approval_time_and_exact_state_binding(self):
        for key, value in [('observedAt', None), ('observedAt', '2026-09-04T23:59:59Z'),
                           ('observedAt', '2999-01-01T00:00:00Z'),
                           ('appliedLedgerStateSha256', '0' * 64),
                           ('promotionEvidenceRef', 'sha256:' + '0' * 64),
                           ('kind', 'rust_promotion_readback_v1')]:
            self.proof()
            changed = {**json.loads(self.blobs[self.readback_ref]), key: value}
            ref = self.retain(changed)
            self.applied_entry['promotionReadbackRef'] = ref
            self.write_applied(self.applied_entry)
            self.assertFalse(self.applied_gate(), key)

    def test_parity_without_valid_performance_cannot_switch_or_remove_python(self):
        ref = self.proof()
        with patch.object(proof_module, 'verified_performance', return_value=False):
            self.assertFalse(self.decision(ref)['allowed'])
            entry = dict(self.applied_entry)
            self.assertFalse(selector.ledger_permits_rust_default(entry, evidence_loader=self.blobs.__getitem__))
        proof = json.loads(self.blobs[ref])
        del proof['performanceEvidenceRef']
        self.assertFalse(self.decision(self.retain(proof))['allowed'])

    def decision(self, ref):
        return rp.evaluate_default_switch(SLICE, self.results, ARTIFACT,
                                         evidence_ref=ref, evidence_loader=self.blobs.__getitem__)

    def test_complete_retained_evidence_is_admitted_by_gate_and_selector(self):
        ref = self.proof()
        self.assertTrue(self.decision(ref)['allowed'])
        entry = dict(self.applied_entry)
        self.assertTrue(selector.ledger_permits_rust_default(entry, evidence_loader=self.blobs.__getitem__))
        self.assertFalse(selector.ledger_permits_rust_default(entry))  # no retained source receipt
        self.assertFalse(rp.evaluate_default_switch(SLICE, self.results, ARTIFACT)['allowed'])

    def test_live_receipts_are_recomputed_even_with_matching_approval_and_readback(self):
        original = deepcopy(self.ledger)
        for field, value in (('executionMode', 'dry_run'), ('sameRunIdVerified', False),
                             ('readbackSha256', 'e' * 64), ('gitSha', '0' * 40)):
            self.ledger = deepcopy(original)
            self.ledger['attempts'][-1]['evidence'][field] = value
            self.assertFalse(self.decision(self.proof())['allowed'], field)
        self.ledger = deepcopy(original)
        self.ledger['attempts'][-1] = deepcopy(self.ledger['attempts'][-2])
        self.assertFalse(self.decision(self.proof())['allowed'])

    def test_result_job_slice_and_receipt_binding_cannot_be_substituted(self):
        original = deepcopy(self.results)
        for field, value in (('slice_id', 'R2-normalize'), ('liveJobId', 'different'),
                             ('liveReceiptSha256', 'd' * 64), ('result_code', 'incomplete'),
                             ('matched', 'true'), ('mismatch_field_count', 1)):
            self.results = deepcopy(original)
            self.results[-1][field] = value
            self.assertFalse(self.decision(self.proof())['allowed'], field)

    def test_missing_tampered_or_unapproved_receipts_fail_closed(self):
        for target in ('approval', 'readback', 'evidence'):
            ref = self.proof()
            key = {'approval': self.approval_ref, 'readback': self.readback_ref, 'evidence': ref}[target]
            self.blobs[key] = b'{}'
            if target == 'readback':
                self.assertFalse(self.applied_gate())
            else:
                self.assertFalse(self.decision(ref)['allowed'])
        ref = self.proof()
        receipt = json.loads(self.blobs[ref])
        approval = json.loads(self.blobs[self.approval_ref])
        approval['status'] = 'unresolved'
        receipt['approvalRef'] = self.retain(approval)
        self.assertFalse(self.decision(self.retain(receipt))['allowed'])

    def test_approval_requires_a_real_utc_instant_for_both_purposes(self):
        for purpose in ('rust_default_switch', 'python_removal'):
            approval = self.approval(purpose, {'exact': 'binding'})
            for invalid in ('2026-99-99T99:99:99Z', '2026-02-29T00:00:00Z',
                            '0000-01-01T00:00:00Z', '2026-09-05T24:00:00Z',
                            '2026-09-05T00:00:60Z', '2026-09-05T00:00:00',
                            '2026-09-05T00:00:00-00:00', '2026-09-05T00:00:00+09:00'):
                self.assertFalse(proof_module.approved({**approval, 'approvedAt': invalid},
                    purpose=purpose, binding={'exact': 'binding'}), invalid)
            for valid in ('2024-02-29T00:00:00Z', '2026-09-05T00:00:00.123456+00:00'):
                self.assertTrue(proof_module.approved({**approval, 'approvedAt': valid},
                    purpose=purpose, binding={'exact': 'binding'}), valid)

    def test_duplicate_receipt_keys_and_nonfinite_json_fail_before_authorization(self):
        approval = self.approval('rust_default_switch', {'exact': 'binding'})
        canonical = json.dumps(approval, separators=(',', ':')).encode()
        for prefix in (b'"purpose":"python_removal",', b'"status":"denied",',
                       b'"binding":{},', b'"sta\\u0074us":"denied",'):
            raw = b'{' + prefix + canonical[1:]
            reference = 'sha256:' + hashlib.sha256(raw).hexdigest()
            self.blobs[reference] = raw
            self.assertIsNone(proof_module.read_receipt(reference, self.blobs.__getitem__))
        for raw in (b'{"binding":{"id":1,"id":2}}', b'{"kind":"a","kind":"b"}',
                    b'{"value":NaN}', b'{"value":Infinity}', b'{"value":1e999}',
                    '{}'.encode('utf-16')):
            reference = 'sha256:' + hashlib.sha256(raw).hexdigest()
            self.blobs[reference] = raw
            self.assertIsNone(proof_module.read_receipt(reference, self.blobs.__getitem__))

    def test_python_removal_requires_both_verified_live_evidence_and_exact_separate_approval(self):
        ref = self.proof()
        candidate = {'separateExplicitCandidate': True, 'candidateCommitSha': 'a' * 40,
                     'sliceId': SLICE, 'rustArtifactId': ARTIFACT, 'ledgerParityRef': ref,
                     'promotionReadbackRef': self.readback_ref}
        binding = {k: v for k, v in candidate.items() if k != 'separateExplicitCandidate'}
        candidate['operatorApprovalRef'] = self.retain(self.approval('python_removal', binding))
        check = lambda c: rp.check_python_removal_candidate(c, evidence_loader=self.blobs.__getitem__)['admitted']
        self.assertTrue(check(candidate))
        for missing in ('ledgerParityRef', 'operatorApprovalRef', 'promotionReadbackRef'):
            self.assertFalse(check({k: v for k, v in candidate.items() if k != missing}))
        self.assertFalse(check({**candidate, 'candidateCommitSha': 'b' * 40}))
        self.assertFalse(check({**candidate, 'operatorApprovalRef': self.approval_ref}))
        self.write_applied({**self.applied_entry, 'activeImplementation': 'python'})
        self.assertFalse(check(candidate))


if __name__ == '__main__':
    unittest.main()
