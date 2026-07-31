import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertPrivacySafe, PrivacyUnsafeValueError } from '../lib/privacy/sanitize';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repositorySource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

const routeSource = source('app/api/admin/notifications/route.ts');
const contextSource = source('contexts/NotificationContext.tsx');
const migrationSource = repositorySource('backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql');

const unsafeNotificationFixtures: readonly unknown[] = [
  { title: '900101-5234567' },
  { message: 'person@example.com' },
  { data: { detail: 'Cookie: sid=opaque-session-value' } },
  { data: { detail: 'Authorization: Bearer opaque-credential' } },
  { data: { rawOcr: 'safe-looking OCR text' } },
  { data: { phone: '010-1234-5678' } },
  { data: { latitude: 37.5665, longitude: 126.978 } },
];

function functionSource(signature: string, nextMarker: string) {
  const start = migrationSource.indexOf(signature);
  const end = migrationSource.indexOf(nextMarker, start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migrationSource.slice(start, end);
}

describe('admin transactional notification RPC contracts', () => {
  test('keeps privacy-safe bounded request and readback validation at the route boundary', () => {
    for (const fixture of unsafeNotificationFixtures) {
      expect(() => assertPrivacySafe(fixture)).toThrow();
    }

    expect(routeSource).toContain('const MAX_REQUEST_BYTES = 8_192;');
    expect(routeSource).toContain('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    expect(routeSource).toContain('hasExactKeys(value, ["recipientUserId", "type", "title", "message", "data"])');
    expect(routeSource).toContain('user_ranking: ["ranking", "period"]');
    expect(routeSource).toContain('const MAX_MESSAGE_LENGTH = 500;');
    expect(routeSource).toContain('assertNotificationPrivacy([recipientUserId, value.type, title, message, data]);');
    expect(routeSource).toContain('assertNotificationPrivacy([value.id, value.user_id, value.type, value.title, value.message, value.data, value.classification, value.channel, value.is_read, value.created_at]);');
    expect(routeSource).not.toContain('console.');
    expect(routeSource).not.toContain('error.message');
  });

  test('uses only the exact typed creation RPC, validates its compact receipt, then reads back every invariant', () => {
    expect(routeSource).toContain('type AdminTransactionalNotificationRpcArgs = {');
    expect(routeSource).toContain('type AdminTransactionalNotificationReceipt = {');
    expect(routeSource).toContain('.rpc("create_admin_transactional_notification", rpcArgs)');
    expect(routeSource).toContain('.overrideTypes<AdminTransactionalNotificationReceipt, { merge: false }>()');
    expect(routeSource).toContain('p_actor_user_id: auth.userId,');
    expect(routeSource).toContain('p_recipient_user_id: notificationRequest.recipientUserId,');
    expect(routeSource).toContain('isExpectedCreationReceipt(creationReceipt, notificationRequest, auth.userId)');
    expect(routeSource).toContain('.select(NOTIFICATION_READBACK_SELECT)');
    expect(routeSource).toContain('isExpectedReadback(notification, notificationRequest)');
    expect(routeSource).not.toContain('.insert(');
    expect(routeSource).not.toContain('.update(');
    expect(routeSource).not.toContain('.delete(');
  });

  test('database rechecks the current active admin and preserves the exact minimized payload contract', () => {
    const rpc = functionSource(
      'CREATE OR REPLACE FUNCTION public.create_admin_transactional_notification(',
      'CREATE OR REPLACE FUNCTION public.create_review_like_notification(',
    );

    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain("SET search_path = ''");
    expect(rpc).toContain('PERFORM privacy_retention.g014_require_service_role();');
    expect(rpc).toContain('JOIN public.user_account_status AS status_row');
    expect(rpc).toContain("role_row.role = 'admin'");
    expect(rpc).toContain("status_row.account_status = 'active'");
    expect(rpc).toContain("'admin_transactional_notification_actor_forbidden'");
    expect(rpc).toContain("'submission_approved'");
    expect(rpc).toContain("'user_ranking'");
    expect(rpc).toContain("p_data <> '{}'::jsonb");
    expect(rpc).toContain("p_data ? 'ranking' AND p_data ? 'period'");
    expect(rpc).toContain('public.assert_notification_content_safe(p_title, p_message, p_data);');
    expect(rpc).toContain("'transactional'");
    expect(rpc).toContain("'in_app'");
    expect(rpc).toContain("'notifications_operational'");
  });

  test('locks active admin authority through the durable marketing claim and keeps transport truth separate from app cleanup', () => {
    const preview = functionSource(
      'CREATE OR REPLACE FUNCTION public.preview_marketing_campaign(',
      'CREATE OR REPLACE FUNCTION public.prepare_marketing_campaign_batch(',
    );
    const prepare = functionSource(
      'CREATE OR REPLACE FUNCTION public.prepare_marketing_campaign_batch(',
      'CREATE OR REPLACE FUNCTION public.claim_marketing_campaign_dispatch(',
    );
    const claim = functionSource(
      'CREATE OR REPLACE FUNCTION public.claim_marketing_campaign_dispatch(',
      'CREATE OR REPLACE FUNCTION public.fail_marketing_campaign_batch(',
    );
    const firstFinalize = migrationSource.indexOf(
      'CREATE OR REPLACE FUNCTION public.finalize_marketing_campaign_batch(',
    );
    const finalizeStart = migrationSource.indexOf(
      'CREATE OR REPLACE FUNCTION public.finalize_marketing_campaign_batch(',
      firstFinalize + 1,
    );
    const finalizeEnd = migrationSource.indexOf(
      'CREATE OR REPLACE FUNCTION public.fail_marketing_campaign_provider_attempt(',
      finalizeStart,
    );
    const finalize = migrationSource.slice(finalizeStart, finalizeEnd);

    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION privacy_retention.g014_require_active_admin_actor(');
    expect(migrationSource).toContain('JOIN public.user_account_status AS status_row');
    expect(migrationSource).toContain('FOR UPDATE OF role_row, status_row;');
    expect(migrationSource).toContain("'marketing_admin_actor_forbidden'");
    expect(migrationSource).toContain('REVOKE ALL ON FUNCTION privacy_retention.g014_require_active_admin_actor(uuid)');
    expect(migrationSource).not.toContain('GRANT EXECUTE ON FUNCTION privacy_retention.g014_require_active_admin_actor(uuid)\n  TO service_role;');

    expect(preview).toContain('PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);');
    expect(prepare).toContain('PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);');
    const authorityCheck = claim.lastIndexOf('PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);');
    const payloadDigest = claim.indexOf('v_payload_digest :=');
    const unknownAttempt = claim.indexOf('INSERT INTO privacy_retention.marketing_campaign_provider_attempts');
    expect(authorityCheck).toBeGreaterThan(payloadDigest);
    expect(authorityCheck).toBeLessThan(unknownAttempt);

    expect(migrationSource).toContain('provider_accepted_at timestamptz');
    expect(migrationSource).toContain("notification_eligibility_outcome text NOT NULL DEFAULT 'not_applicable'");
    expect(migrationSource).toContain("'notification_suppressed_after_acceptance'");
    expect(finalize.indexOf("SET status = 'accepted'")).toBeLessThan(finalize.indexOf('FOR v_recipient IN'));
    expect(finalize).toContain("notification_eligibility_outcome = 'notification_suppressed_after_acceptance'");
    expect(migrationSource).toContain("'transportAccepted'");
    expect(migrationSource).toContain("'notificationSuppressedAfterAcceptance'");
  });
  test('allows service-role execution only through the catalog-asserted RPC while direct notification mutation remains revoked', () => {
    expect(migrationSource).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications,');
    expect(migrationSource).not.toContain('GRANT INSERT ON TABLE public.notifications TO service_role');
    expect(migrationSource).toContain('public.create_admin_transactional_notification(uuid, uuid, text, text, text, jsonb)');
    expect(migrationSource).toContain("('public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)', 'service_role'::name)");
    expect(migrationSource).toContain('ALTER FUNCTION public.create_admin_transactional_notification(uuid, uuid, text, text, text, jsonb)');
    expect(migrationSource).toContain('OWNER TO privacy_workflow_owner;');
    expect(migrationSource).toContain('DO $g014_transactional_notification_catalog_assertion$');
    expect(migrationSource).toContain("'G014 service_role retains direct notifications mutation'");
    expect(migrationSource).toContain('G014 transactional notification RPC has an unexpected overload');
  });

  test('keeps marketing separate and does not return raw unsafe values', () => {
    expect(() =>
      assertPrivacySafe({ title: '관리자 알림', message: '안내 메시지입니다.', data: { ranking: 1 } }),
    ).toThrow(PrivacyUnsafeValueError);
    expect(routeSource).toContain('const MARKETING_CAMPAIGN_REQUIRED = "marketing_campaign_required";');
    expect(routeSource).toContain('return marketingCampaignRequiredResponse();');
    expect(routeSource).toContain('return NextResponse.json({ success: true, notification });');
    expect(routeSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');

    expect(contextSource).toContain("export const MARKETING_CAMPAIGN_REQUIRED = 'marketing_campaign_required';");
    expect(contextSource).toContain('function requireConsentGatedMarketingCampaign(): never');
  });
});
