import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

describe('public API security source contracts', () => {
  test('shorten verifies public review visibility through anon/RLS before service-role writes', () => {
    const shortenSource = source('app/api/shorten/route.ts');

    expect(shortenSource).toContain('function createSupabasePublicClient()');
    expect(shortenSource).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(shortenSource).toContain('const supabasePublic = createSupabasePublicClient()');
    expect(shortenSource).toContain('const supabaseAdmin = createSupabaseAdminClient()');
    expect(shortenSource.indexOf('const { data: review, error: reviewError } = await supabasePublic')).toBeLessThan(
      shortenSource.indexOf("const { data: existing } = await supabaseAdmin"),
    );
    expect(shortenSource).toContain(".select('id, restaurant_id, is_verified')");
    expect(shortenSource).toContain(".eq('is_verified', true)");
    expect(shortenSource).toContain("target_url: allowedTarget.canonicalTargetUrl");
  });

  test('keeps auth required feed redirects truthful and safe', () => {
    const authRequiredSource = source('app/auth/required/page.tsx');
    const authRedirectSource = source('lib/auth/auth-redirect.ts');

    expect(authRequiredSource).toContain("params.reason === 'review'");
    expect(authRequiredSource).toContain("리뷰 작성과 피드 활동은 로그인한 뒤 사용할 수 있습니다.");
    expect(authRequiredSource).toContain("buildHomeAuthLoginPath({ reason: loginReason, next: nextPath })");
    expect(authRedirectSource).toContain("export type AuthRedirectReason = 'admin' | 'mypage' | 'review'");
    expect(authRedirectSource).toContain("|feed|");
    expect(authRedirectSource).toContain("next.startsWith('//')");
  });

  test('self account deletion revokes current sessions before deleting the auth user', () => {
    const accountDeleteSource = source('app/api/account/delete/route.ts');
    const revocationSource = source('lib/auth/session-revocation.ts');

    expect(accountDeleteSource).toContain("import { revokeCurrentUserSessions } from '@/lib/auth/session-revocation'");
    expect(accountDeleteSource.indexOf('await revokeCurrentUserSessions({ supabase, supabaseAdmin, request })')).toBeLessThan(
      accountDeleteSource.indexOf('await supabaseAdmin.auth.admin.deleteUser(targetUserId)'),
    );
    expect(revocationSource).toContain("auth.admin.signOut(accessToken, 'global')");
    expect(revocationSource).toContain("input.request.headers.get('Authorization')");
  });

  test('hardens Supabase public API default grants and browser-callable admin RPCs', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260531084217_harden_public_api_grants_and_rpcs.sql')
      .replace(/\r\n/g, '\n');

    for (const owner of ['postgres', 'supabase_admin']) {
      expect(migrationSource).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public`);
    }

    for (const objectType of ['TABLES', 'FUNCTIONS', 'SEQUENCES']) {
      expect(migrationSource).toContain(`REVOKE ALL PRIVILEGES ON ${objectType} FROM anon, authenticated`);
    }

    expect(migrationSource).toContain('to_regprocedure(target.signature)');
    expect(migrationSource).toContain("RAISE NOTICE 'Skipped missing RPC grant hardening target: %', target.signature");
    expect(migrationSource).toContain("EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s'");
    expect(migrationSource).toContain("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s'");

    for (const exposedAdminFunction of [
      'make_user_admin(text)',
      'batch_insert_restaurants_from_jsonl(jsonb[])',
      'insert_restaurant_from_jsonl(jsonb)',
      'refresh_materialized_views()',
      'cleanup_old_notifications(integer)',
      'approve_restaurant(uuid, uuid)',
      'reject_restaurant(uuid, uuid, text)',
      'approve_restaurant_submission(uuid, uuid)',
      'reject_restaurant_submission(uuid, uuid, text)',
      'approve_new_restaurant_submission(uuid, uuid, jsonb)',
      'approve_edit_restaurant_submission(uuid, uuid, uuid[])',
      'reject_submission(uuid, uuid, text)',
      'reject_submission_item(uuid, uuid, text)',
    ]) {
      expect(migrationSource).toContain(`('public.${exposedAdminFunction}', 'PUBLIC, anon, authenticated', 'service_role')`);
      expect(migrationSource).not.toContain(`('public.${exposedAdminFunction}', 'PUBLIC, anon, authenticated', 'authenticated`);
      expect(migrationSource).not.toContain(`('public.${exposedAdminFunction}', 'PUBLIC, anon, authenticated', 'anon`);
    }

    for (const authenticatedAdminFunction of [
      'approve_submission_item(uuid, uuid, jsonb)',
      'approve_edit_submission_item(uuid, uuid, jsonb)',
    ]) {
      expect(migrationSource).toContain(`('public.${authenticatedAdminFunction}', 'PUBLIC, anon', 'authenticated, service_role')`);
    }
  });

  test('keeps public table grants aligned to intentional read and authenticated mutation surfaces', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql')
      .replace(/\r\n/g, '\n');

    for (const publicReadTable of [
      'ad_banners',
      'announcements',
      'profiles',
      'restaurant_popular_rank_snapshots',
      'restaurants',
      'reviews',
      'review_likes',
      'short_urls',
      'transcript_embeddings_bge',
      'user_bookmarks',
      'user_stats',
      'video_frame_captions',
      'videos',
    ]) {
      expect(migrationSource).toContain(`REVOKE ALL ON public.${publicReadTable} FROM anon, authenticated`);
      expect(migrationSource).toContain(`GRANT SELECT ON public.${publicReadTable} TO anon, authenticated`);
      expect(migrationSource).not.toContain(`GRANT INSERT, UPDATE, DELETE ON public.${publicReadTable} TO anon`);
      expect(migrationSource).not.toContain(`GRANT ALL ON public.${publicReadTable} TO anon`);
    }

    for (const authenticatedOnlyTable of [
      'notifications',
      'ocr_logs',
      'restaurant_requests',
      'restaurant_submissions',
      'restaurant_submission_items',
      'admin_workflow_runs',
      'admin_workflow_signals',
      'admin_workflow_steps',
    ]) {
      expect(migrationSource).toContain(`REVOKE ALL ON public.${authenticatedOnlyTable} FROM anon, authenticated`);
      expect(migrationSource).not.toContain(`GRANT SELECT ON public.${authenticatedOnlyTable} TO anon`);
      expect(migrationSource).not.toContain(`GRANT INSERT ON public.${authenticatedOnlyTable} TO anon`);
      expect(migrationSource).not.toContain(`GRANT UPDATE ON public.${authenticatedOnlyTable} TO anon`);
      expect(migrationSource).not.toContain(`GRANT DELETE ON public.${authenticatedOnlyTable} TO anon`);
    }

    expect(migrationSource).toContain('GRANT INSERT ON public.search_logs TO anon, authenticated');
    expect(migrationSource).toContain('GRANT SELECT ON public.search_logs TO authenticated');
    expect(migrationSource).not.toContain('GRANT SELECT ON public.search_logs TO anon');

    for (const privateTable of ['document_embeddings', 'restaurants_duplicate']) {
      expect(migrationSource).toContain(`REVOKE ALL ON public.${privateTable} FROM anon, authenticated`);
      expect(migrationSource).not.toContain(`GRANT SELECT ON public.${privateTable} TO anon`);
      expect(migrationSource).not.toContain(`GRANT SELECT ON public.${privateTable} TO authenticated`);
    }
  });

  test('does not echo provider or database error details that could contain secrets', () => {
    const naverSearchSource = source('app/api/naver-search/route.ts');
    const ocrReceiptsSource = source('app/api/admin/ocr-receipts/route.ts');
    const ocrRerunSource = source('app/api/admin/ocr-receipts/rerun/route.ts');
    const ocrResetAllSource = source('app/api/admin/ocr-receipts/reset-all/route.ts');
    const ocrProcessSource = source('app/api/admin/ocr-receipts/process/route.ts');
    const adminUsersSource = source('app/api/admin/users/route.ts');
    const adminUserUpdateSource = source('app/api/admin/users/[userId]/route.ts');
    const restaurantRequestReviewSource = source('app/api/admin/restaurant-requests/[requestId]/review/route.ts');
    const directionsSource = source('app/api/admin/routes/directions/route.ts');
    const thumbnailRouteSources = [
      source('app/api/admin/youtube-thumbnail-generator/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/chat/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/history/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/reference-image/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/release-candidates/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/release-candidates/promote/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/releases/assets/[releaseId]/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/releases/current/route.ts'),
      source('app/api/admin/youtube-thumbnail-generator/releases/publish/route.ts'),
    ];

    expect(naverSearchSource).not.toContain('NextResponse.json(errorData');
    expect(naverSearchSource).not.toContain("console.error('[API] Naver API Error Response:', errorData)");
    expect(naverSearchSource).toContain("{ error: 'Naver API request failed' }");

    for (const routeSource of [ocrReceiptsSource, ocrRerunSource, ocrResetAllSource, ocrProcessSource]) {
      expect(routeSource).not.toContain("err instanceof Error ? err.message : 'Unknown error'");
      expect(routeSource).not.toContain('errorText);');
      expect(routeSource).not.toContain('${updateError.message}');
      expect(routeSource).not.toContain('${resetError.message}');
      expect(routeSource).toContain('errorName: getGuardedMutationErrorName');
    }

    for (const routeSource of [ocrReceiptsSource, ocrRerunSource, ocrResetAllSource]) {
      expect(routeSource).toContain('await response.text().catch(() => null)');
    }

    for (const routeSource of [
      adminUsersSource,
      adminUserUpdateSource,
      restaurantRequestReviewSource,
      directionsSource,
      ...thumbnailRouteSources,
    ]) {
      expect(routeSource).not.toContain("error?.message ??");
      expect(routeSource).not.toContain("unexpected failure:', error");
      expect(routeSource).not.toContain('failed:", error');
      expect(routeSource).not.toContain('failed:\', error');
      expect(routeSource).not.toContain('rollbackError);');
      expect(routeSource).toContain('getAdminSafeErrorName');
      expect(routeSource).toContain('errorName');
    }

    expect(adminUsersSource).toContain("error: '사용자를 만들지 못했습니다.'");
    expect(adminUserUpdateSource).toContain("step: 'auth-rollback-after-db-audit'");
    expect(directionsSource).toContain('diagnostics: { errorType: errorName }');
  });
});
