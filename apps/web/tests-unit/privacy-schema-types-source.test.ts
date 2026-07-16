import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Database } from '../integrations/supabase/types';

const webRoot = join(import.meta.dir, '..');
const typesSource = () => readFileSync(join(webRoot, 'integrations/supabase/types.ts'), 'utf8');
const repositoryRoot = join(webRoot, '..', '..');
const catalogSource = () =>
    readFileSync(
        join(repositoryRoot, 'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql'),
        'utf8',
    );
const deletionMigrationSource = () =>
    readFileSync(
        join(repositoryRoot, 'backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql'),
        'utf8',
    );

type Equal<Actual, Expected> = (<Value>() => Value extends Actual ? 1 : 2) extends (
    <Value>() => Value extends Expected ? 1 : 2
)
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type Functions = Database['public']['Functions'];
type FunctionNames = keyof Functions;
type Tables = Database['public']['Tables'];
type AccountDeletionRequestRow = Tables['account_deletion_requests']['Row'];
type AccountDeletionRequestInsert = Tables['account_deletion_requests']['Insert'];
type RequiredKey<Object, Key extends keyof Object> = {} extends Pick<Object, Key> ? false : true;
type ExactSourceManifestHashRow = Assert<Equal<AccountDeletionRequestRow['source_manifest_hash'], string>>;
type ExactSourceManifestHashInsert = Assert<Equal<AccountDeletionRequestInsert['source_manifest_hash'], string>>;
type RequiredSourceManifestHashInsert = Assert<
    Equal<RequiredKey<AccountDeletionRequestInsert, 'source_manifest_hash'>, true>
>;

type NoPrivateRetentionSchema = Assert<Equal<Extract<keyof Database, 'privacy_retention'>, never>>;
type NoMovedPrivacyTables = Assert<
    Equal<
        Extract<
            keyof Tables,
            | 'privacy_policy_versions'
            | 'privacy_onboarding_challenges'
            | 'privacy_guardian_verifications'
            | 'privacy_age_profiles'
            | 'privacy_consent_events'
            | 'privacy_audit_events'
        >,
        never
    >
>;
type NoBooleanStorageAcknowledgement = Assert<
    Equal<Extract<FunctionNames, 'ack_privacy_retention_storage_items'>, never>
>;
type FinalRetentionProviderLifecycle = Assert<
    Equal<
        Extract<
            FunctionNames,
            | 'resolve_privacy_retention_provider_effect'
            | 'get_privacy_retention_provider_reconciliation_work'
            | 'record_privacy_retention_storage_provider_receipts'
            | 'fail_privacy_retention_storage_claims'
        >,
        | 'resolve_privacy_retention_provider_effect'
        | 'get_privacy_retention_provider_reconciliation_work'
        | 'record_privacy_retention_storage_provider_receipts'
        | 'fail_privacy_retention_storage_claims'
    >
>;
type ExactDeletionWorkMode = Assert<
    Equal<
        Database['public']['Functions']['get_account_deletion_storage_work']['Returns'][number],
        {
            bucket_id: string;
            object_name: string;
            object_id: string;
            object_version: string;
            object_locator_hash: string;
            object_version_hash: string;
            provider_idempotency_key: string;
            work_state: string;
            work_mode: string;
            source_manifest_hash: string;
        }
    >
>;
type ExactDeletionClaimNext = Assert<
    Equal<
        Database['public']['Functions']['claim_next_account_deletion_external_job']['Args'],
        Record<string, never>
    >
>;
type ExactDeletionClaimAttemptToken = Assert<
    Equal<
        Database['public']['Functions']['claim_account_deletion_external_job']['Args'],
        {
            p_actor_user_id: string;
            p_target_user_id: string;
            p_request_id: string;
            p_preview_hash: string;
            p_idempotency_key: string;
            p_source_manifest_hash: string;
            p_phase: 'session' | 'storage' | 'auth';
            p_attempt_token: string | null;
        }
    >
>;
type ExactDeletionStatusArgs = Assert<
    Equal<
        Database['public']['Functions']['read_current_account_deletion_status']['Args'],
        { p_request_id: string; p_preview_hash: string; p_source_manifest_hash: string }
    >
>;
type ExactRetentionResolverArgs = Assert<
    Equal<
        Database['public']['Functions']['resolve_privacy_retention_provider_effect']['Args'],
        {
            p_run_id: string;
            p_preview_hash: string;
            p_idempotency_key: string;
            p_work_item_id: string;
            p_claim_token: string;
            p_claim_hash: string;
            p_object_locator_hash: string;
            p_object_version_hash: string;
            p_adapter_version: string;
            p_source_mapping_version: string;
            p_provider_verifier_ref: string;
        }
    >
>;
type ExactMarketingFinalizeArgs = Assert<
    Equal<
        Database['public']['Functions']['finalize_marketing_campaign_batch']['Args'],
        {
            p_operation_id: string;
            p_batch_id: string;
            p_actor_user_id: string;
            p_preview_hash: string;
            p_claim_token: string;
            p_provider_attempt_id: string;
            p_provider_receipt_id: string;
            p_provider_receipt_hash: string;
            p_provider_payload_digest: string;
            p_accepted_user_ids: string[];
            p_timezone?: 'Asia/Seoul';
        }
    >
>;
type ExactAdminTransactionalNotificationReceipt = Assert<
    Equal<
        Database['public']['Functions']['create_admin_transactional_notification']['Returns'],
        {
            schemaVersion: 1;
            status: 'created';
            notificationId: string;
            actorUserId: string;
            recipientUserId: string;
            type: string;
        }
    >
>;
type ExactReviewLikeNotificationReceipt = Assert<
    Equal<
        Database['public']['Functions']['create_review_like_notification']['Returns'],
        {
            schemaVersion: 1;
            status: 'created' | 'replayed';
            notificationId: string;
            reviewId: string;
            recipientUserId: string;
        }
    >
>;
const exactTypeContract: [
    NoPrivateRetentionSchema,
    NoMovedPrivacyTables,
    NoBooleanStorageAcknowledgement,
    FinalRetentionProviderLifecycle,
    ExactDeletionWorkMode,
    ExactDeletionClaimNext,
    ExactDeletionStatusArgs,
    ExactDeletionClaimAttemptToken,
    ExactRetentionResolverArgs,
    ExactMarketingFinalizeArgs,
    ExactAdminTransactionalNotificationReceipt,
    ExactReviewLikeNotificationReceipt,
    ExactSourceManifestHashRow,
    ExactSourceManifestHashInsert,
    RequiredSourceManifestHashInsert,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void exactTypeContract;

describe('post-G014 browser Database source contract', () => {
    test('excludes private retained state and replaced boolean acknowledgement RPCs', () => {
        const source = typesSource();

        expect(source).not.toContain('privacy_retention: {');
        expect(source).not.toMatch(/^\s+(privacy_policy_versions|privacy_onboarding_challenges|privacy_guardian_verifications|privacy_age_profiles|privacy_consent_events|privacy_audit_events): \{/m);
        expect(source).not.toContain('ack_privacy_retention_storage_items:');
        expect(source).not.toMatch(/\bas\s+(any|never)\b/);
        expect(source).not.toContain('Record<string, DatabaseUntyped');
        expect(source).not.toContain('type DatabaseUntyped');
        expect(source).not.toMatch(/\bany\b/);
        expect(source).toContain('type MissingDatabaseExactTableName = Exclude<');
        expect(source).toContain("keyof DatabaseSource['public']['Tables']");
        expect(source).toContain('privacy_consent_state: {');
    });

    test('pins the final notification, deletion, and retention RPC identities', () => {
        const source = typesSource();

        for (const identity of [
            'create_admin_transactional_notification: {',
            'create_review_like_notification: {',
            'claim_marketing_campaign_dispatch: {',
            'finalize_marketing_campaign_batch: {',
            'claim_next_account_deletion_external_job: {',
            'claim_account_deletion_external_job: {',
            'p_attempt_token: string | null',
            'read_current_account_deletion_status: {',
            'get_account_deletion_storage_work: {',
            'work_mode: string',
            'object_id: string',
            'object_version: string',
            'actor_user_id: string | null',
            'actor_ref_hash: string',
            'resolve_privacy_retention_provider_effect: {',
            'get_privacy_retention_provider_reconciliation_work: {',
            'record_privacy_retention_storage_provider_receipts: {',
            'fail_privacy_retention_storage_claims: {',
        ]) {
            expect(source).toContain(identity);
        }
    });
    test('keeps the final catalog promotion gate fail closed', () => {
        const source = catalogSource();

        for (const contract of [
            'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract()',
            "SET search_path = ''",
            'privacy_retention.g014_catalog_contract_manifest',
            'g014_catalog_protected_relations',
            'g014_catalog_manifest_rows',
            'assert_g014_catalog_manifest',
            "'column'",
            "'column_grant'",
            'attribute.attacl',
            'G014 protected column ACL baseline drifted',
            "'policy'",
            "WHEN policy_role.role_oid = 0 THEN 'PUBLIC'",
            "'grant'",
            "'foreign_key'",
            "'index'",
            "'trigger'",
            'G014 exact catalog manifest drifted',
            'G014 applied account deletion receipt/readback invariant drifted',
            "request_row.auth_receipt_ref !~ '^auth:[0-9a-f]{64}$'",
            "NOTIFY pgrst, 'reload schema'",
        ]) {
            expect(source).toContain(contract);
        }
        expect(source).not.toContain('pg_catalog.regexp_replace');
        expect(source).not.toContain('[[:space:]]+');
        expect(source).toContain('pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, false)');
        expect(source).toContain('pg_catalog.pg_get_constraintdef(constraint_row.oid, false)');
        expect(source).toContain('pg_catalog.pg_get_triggerdef(trigger_row.oid, false)');

        expect(source.indexOf('SELECT privacy_retention.assert_g014_catalog_contract();')).toBeLessThan(
            source.indexOf("NOTIFY pgrst, 'reload schema'"),
        );
        expect(source).not.toContain('RAISE NOTICE');
    });
    test('makes the applied deletion receipt a named database invariant and leaves schema reload to the final gate', () => {
        const deletionSource = deletionMigrationSource();
        const catalog = catalogSource();

        expect(deletionSource).toContain('g014_account_deletion_applied_receipt_check');
        expect(deletionSource).toContain("auth_receipt_ref ~ '^auth:[0-9a-f]{64}$'");
        expect(deletionSource).toContain('auth_receipt_ref IS NOT NULL');
        expect(deletionSource).toContain('db_readback_passed IS TRUE');
        expect(deletionSource).toContain('session_readback_passed IS TRUE');
        expect(deletionSource).toContain('storage_readback_passed IS TRUE');
        expect(deletionSource).toContain('auth_readback_passed IS TRUE');
        expect(deletionSource).toContain('applied_at IS NOT NULL');
        expect(deletionSource.match(/NOTIFY pgrst, 'reload schema';/g) ?? []).toHaveLength(0);
        expect(catalog.match(/NOTIFY pgrst, 'reload schema';/g) ?? []).toHaveLength(1);
    });
});
