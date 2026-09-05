"""Synthetic receipt fixtures test admission, never establish live readiness."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from backend.pipeline_control.manifest import record_parity_attempt
from backend.pipeline_control.tests.test_manifest_parity import _ok_payload
from backend.pipeline_control import rust_parity as rp, impl_selector as selector
from backend.pipeline_control.rust_promotion_evidence import digest

SLICE = 'R1-validators'
ARTIFACT = 'tzudong-validators@sha256:' + 'f' * 64


class PromotionEvidenceTests(unittest.TestCase):
    def setUp(self):
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

    def proof(self):
        binding = {'sliceId': SLICE, 'rustArtifactId': ARTIFACT,
                   'liveLedgerSha256': digest(self.ledger), 'parityResultsSha256': digest(self.results)}
        self.approval_ref = self.retain(self.approval('rust_default_switch', binding))
        self.readback_ref = self.retain({'kind': 'rust_promotion_readback_v1', 'binding': binding,
            'approvalRef': self.approval_ref,
            'jobIds': [a['jobId'] for a in self.ledger['attempts'][-3:]],
            'receiptSha256s': [a['evidenceReceiptSha256'] for a in self.ledger['attempts'][-3:]]})
        return self.retain({'kind': 'rust_promotion_evidence_v1', 'sliceId': SLICE,
            'rustArtifactId': ARTIFACT, 'parityResults': self.results, 'liveLedger': self.ledger,
            'approvalRef': self.approval_ref, 'readbackRef': self.readback_ref})

    def decision(self, ref):
        return rp.evaluate_default_switch(SLICE, self.results, ARTIFACT,
                                         evidence_ref=ref, evidence_loader=self.blobs.__getitem__)

    def test_complete_retained_evidence_is_admitted_by_gate_and_selector(self):
        ref = self.proof()
        self.assertTrue(self.decision(ref)['allowed'])
        entry = {'sliceId': SLICE, 'rustArtifactId': ARTIFACT, 'activeImplementation': 'rust',
                 'consecutiveMatchedCount': 3, 'promotionEvidenceRef': ref}
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
            self.assertFalse(self.decision(ref)['allowed'])
        ref = self.proof()
        receipt = json.loads(self.blobs[ref])
        approval = json.loads(self.blobs[self.approval_ref])
        approval['status'] = 'unresolved'
        receipt['approvalRef'] = self.retain(approval)
        self.assertFalse(self.decision(self.retain(receipt))['allowed'])

    def test_python_removal_requires_both_verified_live_evidence_and_exact_separate_approval(self):
        ref = self.proof()
        candidate = {'separateExplicitCandidate': True, 'candidateCommitSha': 'a' * 40,
                     'sliceId': SLICE, 'rustArtifactId': ARTIFACT, 'ledgerParityRef': ref}
        binding = {k: v for k, v in candidate.items() if k != 'separateExplicitCandidate'}
        candidate['operatorApprovalRef'] = self.retain(self.approval('python_removal', binding))
        check = lambda c: rp.check_python_removal_candidate(c, evidence_loader=self.blobs.__getitem__)['admitted']
        self.assertTrue(check(candidate))
        for missing in ('ledgerParityRef', 'operatorApprovalRef'):
            self.assertFalse(check({k: v for k, v in candidate.items() if k != missing}))
        self.assertFalse(check({**candidate, 'candidateCommitSha': 'b' * 40}))
        self.assertFalse(check({**candidate, 'operatorApprovalRef': self.approval_ref}))


if __name__ == '__main__':
    unittest.main()
