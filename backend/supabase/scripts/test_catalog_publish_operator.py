import copy
from pathlib import Path
import tempfile
import unittest

import local_catalog_workspace as catalog
import local_catalog_publish_plan as planner
from catalog_publish_operator import APPROVAL_ENV, CONFIRMATION, PublishOperator
from catalog_publish_transport import APPLY, PREPARE, READBACK, PublishRpcError
from test_local_catalog_workspace import row

ACTOR = '22222222-2222-4222-8222-222222222222'


class Rpc:
    def __init__(self):
        self.calls = []
        self.envelope = None
        self.fail_apply = None
        self.drift = False
        self.invalid_preview = False

    def call(self, name, args):
        self.calls.append(name)
        if name == PREPARE:
            self.envelope = copy.deepcopy(args['p_envelope'])
            e = self.envelope
            return {'before': {field: e['expected_hosted_review_values'][field] for field in e['patch']},
                    'after': copy.deepcopy(e['patch']), 'before_sha256': 'a' * 64,
                    'preview_sha256': 'b' * 64, 'core_preview_sha256': 'c' * 64,
                    'envelope_sha256': 'd' * 64, 'review_sha256': e['review_sha256'],
                    'operation_id': ACTOR if self.invalid_preview else e['operation_id'],
                    'selection': e['selection'], 'derived_fields': ['updated_by_admin_id', 'updated_at']}
        if name == APPLY and self.fail_apply:
            raise self.fail_apply
        e = self.envelope
        return {'operation_id': e['operation_id'], 'restaurant_id': e['restaurant_id'],
                'after_sha256': 'e' * 64, 'current_sha256': 'f' * 64 if self.drift and name == READBACK else 'e' * 64,
                'matches': not (self.drift and name == READBACK), 'changed_fields': sorted(e['patch']),
                'values': copy.deepcopy(e['patch']), 'envelope_sha256': 'd' * 64,
                'review_sha256': e['review_sha256'], 'preview_sha256': 'b' * 64, 'link_matches': True}


class PublishOperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        baseline = [row()]
        self.identifier = baseline[0]['id']
        local = copy.deepcopy(baseline)
        local[0]['approved_name'] = '검토한 변경'
        review = {'schema': 'local-catalog-publish-review-v1', 'project': 'fixture',
                  'source': catalog.HOSTED_PROJECT_REF, 'local_digest': 'same',
                  **planner.build_plan(baseline, local, baseline, [{'id': self.identifier, 'fields': ['approved_name']}])}
        self.review_sha = catalog.sha(review)
        catalog.private_write(self.directory / (self.review_sha + '.publish-review.json'), review)
        self.rpc = Rpc()
        self.operator = PublishOperator(self.directory, 'fixture', self.rpc, local_digest=lambda: 'same')

    def prepared(self):
        return self.operator.prepare(self.review_sha, self.identifier, ACTOR)

    def approved(self, result):
        approval = {'schema': 'catalog-publish-approval-v1', 'source': catalog.HOSTED_PROJECT_REF,
                    'operation_id': result['operation_id'], 'prepared_sha256': result['prepared_sha256'],
                    'actor_user_id': ACTOR, 'approved': True, 'release_evidence_sha256': '9' * 64}
        path = self.directory / 'operator-approval.json'
        catalog.private_write(path, approval)
        return {'confirmation': CONFIRMATION, 'approval_file': path,
                'environment': {APPROVAL_ENV: result['prepared_sha256'], 'G037_WRITE_FREEZE': 'cleared'}}

    def test_prepare_retains_exact_selected_preview_privately_without_apply(self):
        result = self.prepared()
        path = self.directory / (result['prepared_sha256'] + '.publish-prepared.json')
        value = catalog.read_private_json(path)
        self.assertEqual(catalog.sha(value), result['prepared_sha256'])
        self.assertEqual(value['envelope']['selection'], ['approved_name'])
        self.assertEqual(value['envelope']['review_sha256'], self.review_sha)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.rpc.calls, [PREPARE])

    def test_confirmation_approval_and_freeze_are_required_before_apply(self):
        result = self.prepared()
        approval = self.approved(result)
        bads = [dict(approval, confirmation='yes'), dict(approval, environment={}),
                dict(approval, environment={APPROVAL_ENV: result['prepared_sha256'], 'G037_WRITE_FREEZE': 'active'})]
        for args in bads:
            with self.assertRaises(catalog.CatalogError):
                self.operator.apply(result['prepared_sha256'], **args)
        self.assertEqual(self.rpc.calls, [PREPARE])
        self.assertEqual(list(self.directory.glob('*.publish-attempt.json')), [])

    def test_success_requires_separate_readback_and_retains_minimized_receipt(self):
        result = self.prepared()
        outcome = self.operator.apply(result['prepared_sha256'], **self.approved(result))
        self.assertEqual(outcome['state'], 'verified')
        self.assertEqual(self.rpc.calls, [PREPARE, APPLY, READBACK])
        receipt = catalog.read_private_json(self.directory / (outcome['receipt_sha256'] + '.publish-readback.json'))
        self.assertNotIn('검토한 변경', catalog.canonical(receipt).decode())
        self.assertEqual(list(self.directory.glob('*.publish-pending.json')), [])
        self.assertEqual(len(list(self.directory.glob('*.publish-attempt.json'))), 1)

    def test_unknown_delivery_blocks_reapply_and_new_operation_across_restart(self):
        result = self.prepared()
        approval = self.approved(result)
        self.rpc.fail_apply = PublishRpcError('publish_outcome_unknown', outcome_unknown=True)
        self.assertEqual(self.operator.apply(result['prepared_sha256'], **approval)['state'], 'pending')
        restarted = PublishOperator(self.directory, 'fixture', self.rpc, local_digest=lambda: 'same')
        with self.assertRaisesRegex(catalog.CatalogError, 'readback_required'):
            restarted.apply(result['prepared_sha256'], **approval)
        with self.assertRaisesRegex(catalog.CatalogError, 'readback_required'):
            restarted.prepare(self.review_sha, self.identifier, ACTOR)
        self.assertEqual(self.rpc.calls.count(APPLY), 1)
        self.assertEqual(restarted.readback(result['prepared_sha256'])['state'], 'verified')
        with self.assertRaisesRegex(catalog.CatalogError, 'readback_required'):
            restarted.apply(result['prepared_sha256'], **approval)
        self.assertEqual(self.rpc.calls.count(APPLY), 1)

    def test_definite_rejection_clears_pending_but_never_retries_same_attempt(self):
        result = self.prepared()
        approval = self.approved(result)
        self.rpc.fail_apply = PublishRpcError('publish_conflict')
        self.assertEqual(self.operator.apply(result['prepared_sha256'], **approval)['state'], 'rejected')
        self.assertEqual(list(self.directory.glob('*.publish-pending.json')), [])
        with self.assertRaisesRegex(catalog.CatalogError, 'readback_required'):
            self.operator.apply(result['prepared_sha256'], **approval)
        self.assertEqual(self.rpc.calls.count(APPLY), 1)

    def test_changed_readback_never_claims_verified_or_releases_pending(self):
        result = self.prepared()
        self.rpc.drift = True
        self.assertEqual(self.operator.apply(result['prepared_sha256'], **self.approved(result))['state'], 'pending')
        self.assertEqual(len(list(self.directory.glob('*.publish-pending.json'))), 1)
        self.assertEqual(list(self.directory.glob('*.publish-readback.json')), [])

    def test_stale_local_or_mismatched_preview_is_rejected(self):
        self.operator.local_digest = lambda: 'changed'
        with self.assertRaisesRegex(catalog.CatalogError, 'local_review_stale'): self.prepared()
        self.assertEqual(self.rpc.calls, [])
        self.operator.local_digest = lambda: 'same'
        self.rpc.invalid_preview = True
        with self.assertRaisesRegex(catalog.CatalogError, 'preview_invalid'): self.prepared()
        self.assertEqual(list(self.directory.glob('*.publish-prepared.json')), [])

    def test_tampered_prepared_file_fails_before_readback(self):
        result = self.prepared()
        path = self.directory / (result['prepared_sha256'] + '.publish-prepared.json')
        value = catalog.read_private_json(path)
        value['project'] = 'other'
        path.write_bytes(catalog.canonical(value))
        with self.assertRaisesRegex(catalog.CatalogError, 'artifact_binding_invalid'):
            self.operator.readback(result['prepared_sha256'])
        self.assertEqual(self.rpc.calls, [PREPARE])


if __name__ == '__main__':
    unittest.main()
