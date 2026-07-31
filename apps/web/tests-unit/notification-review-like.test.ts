import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrivacyUnsafeValueError, assertPrivacySafe } from '@/lib/privacy/sanitize';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repositorySource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

const routeSource = source('app/api/notifications/review-like/route.ts');
const migrationSource = repositorySource('backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql');
const callsiteSources = [
  source('components/feed/FeedContent.tsx'),
  source('app/stamp/page.tsx'),
  source('components/restaurant/RestaurantDetailPanel.tsx'),
];

const UNSAFE_NOTIFICATION_COPY_FIXTURES = [
  'person@example.com',
  '900101-5234567',
  'Authorization: Bearer notification-secret',
  'Cookie: sid=opaque-session',
  'onboarding_state=opaque-value',
] as const;

function reviewLikeRpcSource() {
  const start = migrationSource.indexOf('CREATE OR REPLACE FUNCTION public.create_review_like_notification(');
  const end = migrationSource.indexOf('-- Data API roles only have the minimal direct readback surface.', start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migrationSource.slice(start, end);
}

describe('review-like notification RPC contracts', () => {
  test('bounds declared and chunked request bodies before exact reviewId-only parsing', () => {
    expect(routeSource).toContain('const MAX_REQUEST_BYTES = 1_024;');
    expect(routeSource).toContain("request.headers.get('content-length')");
    expect(routeSource).toContain('const reader = request.body?.getReader();');
    expect(routeSource).toContain('if (totalBytes > MAX_REQUEST_BYTES)');
    expect(routeSource).toContain('await reader.cancel();');
    expect(routeSource).not.toContain('await request.json()');
    expect(routeSource).toContain("Object.prototype.hasOwnProperty.call(value, 'reviewId')");
    expect(routeSource).toContain("return errorResponse('INVALID_REVIEW_ID', 400);");
  });

  test('keeps session-bound checks for useful errors but creates only through the exact typed RPC and exact receipt/readback', () => {
    const authenticationIndex = routeSource.indexOf('await supabase.auth.getUser()');
    const likeLookupIndex = routeSource.indexOf(".from('review_likes')");
    const rpcIndex = routeSource.indexOf(".rpc('create_review_like_notification', rpcArgs)");

    expect(authenticationIndex).toBeGreaterThan(-1);
    expect(likeLookupIndex).toBeGreaterThan(authenticationIndex);
    expect(rpcIndex).toBeGreaterThan(likeLookupIndex);
    expect(routeSource).toContain('type ReviewLikeNotificationRpcArgs = {');
    expect(routeSource).toContain('type ReviewLikeNotificationReceipt = {');
    expect(routeSource).toContain('.overrideTypes<ReviewLikeNotificationReceipt, { merge: false }>()');
    expect(routeSource).toContain('p_actor_user_id: user.id,');
    expect(routeSource).toContain('p_review_id: review.id,');
    expect(routeSource).toContain('p_like_id: like.id,');
    expect(routeSource).toContain('hasExpectedNotificationReceipt(creationReceipt, notificationPayload)');
    expect(routeSource).toContain('hasExpectedNotificationReadback(notificationReadback, notificationPayload)');
    expect(routeSource).toContain('sourceLikeId: like.id,');
    expect(routeSource).toContain("'created_at',");
    expect(routeSource).not.toContain('.insert(');
    expect(routeSource).not.toContain('.update(');
    expect(routeSource).not.toContain('.delete(');
  });

  test('database rejects forged or stale source relations and derives the fixed source-bound transactional payload', () => {
    const rpc = reviewLikeRpcSource();

    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain("SET search_path = ''");
    expect(rpc).toContain('PERFORM privacy_retention.g014_require_service_role();');
    expect(rpc).toContain("pg_catalog.hashtextextended('g014-review-like:' || p_like_id::text, 0)");
    expect(rpc).toContain('FROM public.review_likes AS review_like');
    expect(rpc).toContain('review_like.id = p_like_id');
    expect(rpc).toContain('review_like.review_id = p_review_id');
    expect(rpc).toContain('review_like.user_id = p_actor_user_id');
    expect(rpc).toContain("'review_like_notification_source_forbidden'");
    expect(rpc).toContain('FROM public.reviews AS review_row');
    expect(rpc).toContain('JOIN auth.users AS recipient');
    expect(rpc).toContain('review_row.id = v_like.review_id');
    expect(rpc).toContain("'review_like_notification_self_forbidden'");
    expect(rpc).toContain("'reviewId', p_review_id::text");
    expect(rpc).toContain("'restaurantId', v_restaurant_id::text");
    expect(rpc).toContain("'sourceLikeId', p_like_id::text");
    expect(rpc).toContain("'review_like'");
    expect(rpc).toContain("'transactional'");
    expect(rpc).toContain("'in_app'");
    expect(rpc).toContain("'notifications_operational'");
  });

  test('replays the same source-like notification idempotently without returning its source identifier to the browser', () => {
    const rpc = reviewLikeRpcSource();
    const responseStart = routeSource.lastIndexOf('return NextResponse.json(');
    const responseEnd = routeSource.indexOf('  } catch {', responseStart);
    const responseSource = routeSource.slice(responseStart, responseEnd);

    expect(rpc).toContain('WHERE notification.user_id = v_recipient_user_id');
    expect(rpc).toContain('notification.data = v_data');
    expect(rpc).toContain("'status', 'replayed'");
    expect(rpc).toContain("'review_like_notification_replay_invalid'");
    expect(responseSource).toContain('id: notificationReadback.id,');
    expect(responseSource).toContain('reviewId: notificationPayload.data.reviewId,');
    expect(responseSource).toContain('restaurantId: notificationPayload.data.restaurantId,');
    expect(responseSource).not.toContain('sourceLikeId');
  });

  test('keeps PII out of notification copy and suppresses raw values from the browser response', () => {
    for (const value of UNSAFE_NOTIFICATION_COPY_FIXTURES) {
      expect(() => assertPrivacySafe(['리뷰 알림', value, {}])).toThrow(PrivacyUnsafeValueError);
    }

    expect(routeSource).toContain("import { assertPrivacySafe } from '@/lib/privacy/sanitize';");
    expect(routeSource).toContain(
      'assertPrivacySafe([notificationPayload.title, notificationPayload.message, notificationPayload.data]);',
    );
    expect(routeSource).toContain('PHONE_LIKE_PATTERN');
    expect(routeSource).toContain("!PHONE_LIKE_PATTERN.test(normalized) ? normalized : '해당 맛집'");
    expect(routeSource).not.toContain('console.');
    expect(routeSource).not.toContain('error.message');
  });

  test('keeps direct notification mutation revoked and the exact RPC catalog-owned by the privacy workflow owner', () => {
    expect(migrationSource).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications,');
    expect(migrationSource).not.toContain('GRANT INSERT ON TABLE public.notifications TO service_role');
    expect(migrationSource).toContain('ALTER FUNCTION public.create_review_like_notification(uuid, uuid, uuid)');
    expect(migrationSource).toContain("('public.create_review_like_notification(uuid,uuid,uuid)', 'service_role'::name)");
    expect(migrationSource).toContain('DO $g014_transactional_notification_catalog_assertion$');
    expect(migrationSource).toContain('G014 transactional notification RPC grant contract failed');
    expect(migrationSource).toContain('G014 transactional notification RPC has PUBLIC EXECUTE');
  });

  test('keeps browser like call sites unprivileged and non-destructive when notification delivery fails', () => {
    for (const callsiteSource of callsiteSources) {
      expect(callsiteSource).not.toContain('createSupabaseServiceRoleClient');
      expect(callsiteSource).not.toContain('create_user_notification');
      expect(callsiteSource).toContain("fetch('/api/notifications/review-like'");
      expect(callsiteSource).toContain('body: JSON.stringify({ reviewId })');
      expect(callsiteSource).toContain('if (!notificationResponse.ok)');
      expect(callsiteSource).toContain('} catch {');
    }
  });
});
