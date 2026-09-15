"""Operation-bound publication client; no implicit approval or apply retry."""
from __future__ import annotations

import os
from pathlib import Path
import re
import uuid

import local_catalog_workspace as catalog
import local_catalog_publish_plan as planner
from catalog_publish_transport import APPLY, PREPARE, READBACK, PublishRpcError

APPROVAL_ENV = 'TZUDONG_CATALOG_PUBLISH_APPROVED_SHA256'
CONFIRMATION = '운영 변경 적용'


def is_hash(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def checked_uuid(value):
    try:
        if isinstance(value, str) and str(uuid.UUID(value)) == value:
            return value
    except (ValueError, AttributeError):
        pass
    raise catalog.CatalogError('publish_identity_invalid')


def validate_preview(envelope, value):
    keys = {'before', 'after', 'before_sha256', 'preview_sha256', 'core_preview_sha256',
            'envelope_sha256', 'review_sha256', 'operation_id', 'selection', 'derived_fields'}
    if not isinstance(value, dict) or set(value) != keys:
        raise catalog.CatalogError('publish_preview_invalid')
    derived = ['updated_by_admin_id', 'updated_at']
    if 'lat' in envelope['patch']:
        derived += ['geocoding_success', 'geocoding_false_stage']
    if (any(not is_hash(value[key]) for key in ('before_sha256', 'preview_sha256', 'core_preview_sha256', 'envelope_sha256'))
            or value['operation_id'] != envelope['operation_id']
            or value['review_sha256'] != envelope['review_sha256']
            or value['selection'] != envelope['selection']
            or not isinstance(value['derived_fields'], list)
            or any(not isinstance(field, str) for field in value['derived_fields'])
            or sorted(value['derived_fields']) != sorted(derived)
            or not isinstance(value['before'], dict) or not isinstance(value['after'], dict)
            or not value['after'] or set(value['before']) != set(value['after'])
            or not set(value['after']) <= set(envelope['patch'])):
        raise catalog.CatalogError('publish_preview_invalid')
    if any(not planner.valid_value(field, after) or after != envelope['patch'][field]
           for field, after in value['after'].items()):
        raise catalog.CatalogError('publish_preview_invalid')
    # Before values are expected hosted values; do not retain unbounded arbitrary
    # provider response fields or substitute a different preview for the review.
    if any(before != envelope['expected_hosted_review_values'][field]
           for field, before in value['before'].items()):
        raise catalog.CatalogError('publish_preview_invalid')
    return value


def validate_readback(prepared, value):
    required = {'operation_id', 'restaurant_id', 'after_sha256', 'current_sha256', 'matches',
                'changed_fields', 'values', 'envelope_sha256', 'review_sha256', 'preview_sha256', 'link_matches'}
    if not isinstance(value, dict) or set(value) not in (required, required | {'replayed'}):
        return False
    envelope, preview = prepared['envelope'], prepared['preview']
    if (value['operation_id'] != envelope['operation_id'] or value['restaurant_id'] != envelope['restaurant_id']
            or value['review_sha256'] != envelope['review_sha256']
            or value['envelope_sha256'] != preview['envelope_sha256']
            or value['preview_sha256'] != preview['preview_sha256']
            or value['link_matches'] is not True or value['matches'] is not True
            or not is_hash(value['after_sha256']) or value['current_sha256'] != value['after_sha256']
            or not isinstance(value['changed_fields'], list)
            or any(not isinstance(field, str) for field in value['changed_fields'])
            or sorted(value['changed_fields']) != sorted(preview['after'])
            or not isinstance(value['values'], dict)
            or any(field not in planner.FIELDS or not planner.valid_value(field, item) for field, item in value['values'].items())
            or value['values'] != preview['after']):
        return False
    return True


class PublishOperator:
    def __init__(self, directory, project, rpc, *, local_digest):
        self.directory, self.project, self.rpc = Path(directory), project, rpc
        self.local_digest = local_digest
        if (self.directory.is_symlink() or not self.directory.is_dir()
                or self.directory.stat().st_mode & 0o077):
            raise catalog.CatalogError('workspace_permissions_invalid')

    def _read(self, digest, suffix):
        if not is_hash(digest):
            raise catalog.CatalogError('publish_hash_invalid')
        value = catalog.read_private_json(self.directory / (digest + suffix))
        if catalog.sha(value) != digest or value.get('project') != self.project or value.get('source') != catalog.HOSTED_PROJECT_REF:
            raise catalog.CatalogError('publish_artifact_binding_invalid')
        return value

    def _write(self, value, suffix):
        digest = catalog.sha(value)
        path = self.directory / (digest + suffix)
        if path.exists():
            if catalog.read_private_json(path) != value:
                raise catalog.CatalogError('publish_artifact_conflict')
        else:
            catalog.private_write(path, value)
        self._sync_directory()
        return digest

    def _sync_directory(self):
        descriptor = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _pending_path(self, identifier):
        return self.directory / (checked_uuid(identifier) + '.publish-pending.json')

    def prepare(self, review_sha256, restaurant_id, actor_user_id):
        checked_uuid(restaurant_id)
        checked_uuid(actor_user_id)
        if self._pending_path(restaurant_id).exists():
            raise catalog.CatalogError('publish_readback_required')
        review = self._read(review_sha256, '.publish-review.json')
        if review.get('schema') != 'local-catalog-publish-review-v1' or review.get('safe_to_apply') is not False:
            raise catalog.CatalogError('publish_review_invalid')
        if review.get('local_digest') != self.local_digest():
            raise catalog.CatalogError('publish_local_review_stale')
        rows = [row for row in review['records'] if row['id'] == restaurant_id]
        if len(rows) != 1 or rows[0]['state'] != 'candidate':
            raise catalog.CatalogError('publish_selected_candidate_required')
        row = rows[0]
        selected = planner.selection_rows([{'id': restaurant_id, 'fields': row['selected_fields']}])[0]['fields']
        if (not isinstance(row['patch'], dict) or not row['patch'] or not set(row['patch']) <= set(selected)
                or any(not planner.valid_value(field, value) for field, value in row['patch'].items())
                or set(row['expected_hosted_review_values']) != set(catalog.REVIEW_FIELDS)):
            raise catalog.CatalogError('publish_review_invalid')
        envelope = {'actor_user_id': actor_user_id, 'restaurant_id': restaurant_id,
                    'operation_id': str(uuid.uuid4()), 'review_sha256': review_sha256,
                    'selection': selected, 'patch': row['patch'],
                    'expected_hosted_review_values': row['expected_hosted_review_values']}
        preview = validate_preview(envelope, self.rpc.call(PREPARE, {'p_envelope': envelope}))
        prepared = {'schema': 'catalog-publish-prepared-v1', 'project': self.project,
                    'source': catalog.HOSTED_PROJECT_REF, 'local_digest': review['local_digest'],
                    'envelope': envelope, 'preview': preview}
        digest = self._write(prepared, '.publish-prepared.json')
        return {'prepared_sha256': digest, 'operation_id': envelope['operation_id'],
                'changed_fields': sorted(preview['after']), 'derived_fields': preview['derived_fields']}

    def _prepared(self, digest):
        prepared = self._read(digest, '.publish-prepared.json')
        if prepared.get('schema') != 'catalog-publish-prepared-v1':
            raise catalog.CatalogError('publish_prepared_invalid')
        validate_preview(prepared['envelope'], prepared['preview'])
        checked_uuid(prepared['envelope']['operation_id'])
        checked_uuid(prepared['envelope']['restaurant_id'])
        checked_uuid(prepared['envelope']['actor_user_id'])
        return prepared

    def apply(self, digest, *, confirmation, approval_file, environment):
        prepared = self._prepared(digest)
        envelope = prepared['envelope']
        if confirmation != CONFIRMATION or environment.get(APPROVAL_ENV) != digest:
            raise catalog.CatalogError('publish_operation_approval_required')
        if environment.get('G037_WRITE_FREEZE') != 'cleared':
            raise catalog.CatalogError('hosted_write_freeze_not_cleared')
        approval = catalog.read_private_json(Path(approval_file))
        # This binds an operator-supplied approval record, not a claim that this
        # client has independently certified its external release/legal evidence.
        expected = {'schema': 'catalog-publish-approval-v1', 'source': catalog.HOSTED_PROJECT_REF,
                    'operation_id': envelope['operation_id'], 'prepared_sha256': digest,
                    'actor_user_id': envelope['actor_user_id'], 'approved': True}
        if (not isinstance(approval, dict) or set(approval) != {*expected, 'release_evidence_sha256'}
                or approval.get('approved') is not True
                or any(approval[key] != value for key, value in expected.items())
                or not is_hash(approval['release_evidence_sha256'])):
            raise catalog.CatalogError('publish_approval_binding_invalid')
        if prepared['local_digest'] != self.local_digest():
            raise catalog.CatalogError('publish_local_review_stale')
        attempt = self.directory / (envelope['operation_id'] + '.publish-attempt.json')
        pending = self._pending_path(envelope['restaurant_id'])
        marker = {'prepared_sha256': digest, 'operation_id': envelope['operation_id'],
                  'actor_user_id': envelope['actor_user_id'], 'source': catalog.HOSTED_PROJECT_REF,
                  'approval_sha256': catalog.sha(approval)}
        if attempt.exists() or pending.exists():
            raise catalog.CatalogError('publish_readback_required')
        # Exclusive per-restaurant marker prevents a second prepared operation
        # racing an uncertain first operation, even from another local process.
        try:
            catalog.private_write(pending, marker)
            catalog.private_write(attempt, marker)
            self._sync_directory()
        except FileExistsError:
            raise catalog.CatalogError('publish_readback_required') from None
        try:
            result = self.rpc.call(APPLY, {'p_envelope': envelope, 'p_preview_sha256': prepared['preview']['preview_sha256']})
        except PublishRpcError as error:
            if not error.outcome_unknown:
                self._clear_pending(pending, marker)
                self._write({'schema': 'catalog-publish-rejected-v1', 'project': self.project,
                             'source': catalog.HOSTED_PROJECT_REF, **marker, 'code': error.code}, '.publish-rejected.json')
                return {'state': 'rejected', 'operation_id': envelope['operation_id'], 'code': error.code}
            return {'state': 'pending', 'operation_id': envelope['operation_id'], 'readback_required': True}
        if not validate_readback(prepared, result):
            return {'state': 'pending', 'operation_id': envelope['operation_id'], 'readback_required': True}
        # Independent RPC readback is required even when apply returned a receipt.
        return self.readback(digest)

    def _clear_pending(self, pending, marker):
        if pending.exists() and catalog.read_private_json(pending) == marker:
            pending.unlink()
            self._sync_directory()

    def readback(self, digest):
        prepared = self._prepared(digest)
        envelope = prepared['envelope']
        try:
            value = self.rpc.call(READBACK, {'p_actor': envelope['actor_user_id'], 'p_operation': envelope['operation_id']})
        except PublishRpcError:
            return {'state': 'pending', 'operation_id': envelope['operation_id'], 'readback_required': True}
        if not validate_readback(prepared, value):
            return {'state': 'pending', 'operation_id': envelope['operation_id'], 'readback_required': True}
        receipt = {'schema': 'catalog-publish-readback-v1', 'project': self.project, 'source': catalog.HOSTED_PROJECT_REF,
                   'prepared_sha256': digest, 'operation_id': envelope['operation_id'],
                   'review_sha256': envelope['review_sha256'], 'after_sha256': value['after_sha256'],
                   'envelope_sha256': value['envelope_sha256'], 'changed_fields': value['changed_fields'],
                   'result': 'applied_and_read_back'}
        receipt_sha = self._write(receipt, '.publish-readback.json')
        pending = self._pending_path(envelope['restaurant_id'])
        if pending.exists():
            marker = catalog.read_private_json(pending)
            if marker.get('prepared_sha256') == digest and marker.get('operation_id') == envelope['operation_id']:
                self._clear_pending(pending, marker)
        return {'state': 'verified', 'operation_id': envelope['operation_id'], 'receipt_sha256': receipt_sha}
