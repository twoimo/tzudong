import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');

describe('public API security source contracts', () => {
  test('shorten verifies public review visibility through anon/RLS before service-role allocation', () => {
    const shortenSource = source('app/api/shorten/route.ts');

    expect(shortenSource).toContain('function createSupabasePublicClient()');
    expect(shortenSource).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(shortenSource).toContain('const supabasePublic = createSupabasePublicClient()');
    expect(shortenSource).toContain('const supabaseAdmin = createSupabaseAdminClient()');
    expect(shortenSource.indexOf('const { data: review, error: reviewError } = await supabasePublic')).toBeLessThan(
      shortenSource.indexOf('const supabaseAdmin = createSupabaseAdminClient()'),
    );
    expect(shortenSource.indexOf('const supabaseAdmin = createSupabaseAdminClient()')).toBeLessThan(
      shortenSource.indexOf(".rpc('allocate_short_url'"),
    );
    expect(shortenSource).toContain(".select('id, restaurant_id, is_verified')");
    expect(shortenSource).toContain(".eq('is_verified', true)");
    expect(shortenSource).toContain('p_target_url: allowedTarget.canonicalTargetUrl');
    expect(shortenSource).not.toContain(".from('short_urls')");
    expect(shortenSource).not.toContain('new Map<');
  });

  test('shorten bounds actual request bytes and trusts only a Vercel-owned forwarded identity', () => {
    const shortenSource = source('app/api/shorten/route.ts');

    expect(shortenSource).toContain("const MAX_SHORTEN_BODY_BYTES = 4 * 1024");
    expect(shortenSource).toContain("request.body.getReader()");
    expect(shortenSource).toContain('totalBytes += value.byteLength');
    expect(shortenSource).toContain('if (totalBytes > MAX_SHORTEN_BODY_BYTES)');
    expect(shortenSource).not.toContain('request.text()');
    expect(shortenSource).not.toContain('request.json()');
    expect(shortenSource).toContain("mediaType !== 'application/json'");
    expect(shortenSource).toContain("keys[0] !== 'targetUrl'");
    expect(shortenSource).toContain("process.env.VERCEL !== '1'");
    expect(shortenSource).toContain("request.headers.get('x-vercel-forwarded-for')");
    expect(shortenSource).not.toContain("request.headers.get('x-forwarded-for')");
    expect(shortenSource).not.toContain("request.headers.get('x-real-ip')");
    expect(shortenSource).toContain('PRIVACY_AUDIT_HASH_KEY');
    expect(shortenSource).toContain("Buffer.byteLength(privacyHashKey, 'utf8') < 32");
    expect(shortenSource).toContain("createHmac('sha256', privacyHashKey)");
    expect(shortenSource).toContain("return 'unknown'");
    expect(shortenSource).toContain("const SHORT_CODE_CANDIDATE_COUNT = 5");
    expect(shortenSource).toContain('randomInt(SHORT_CODE_ALPHABET.length)');
    expect(shortenSource).toContain('p_candidate_codes: generateShortCodeCandidates()');
    expect(shortenSource).toContain("'Retry-After': String(Math.max(1, allocation.retry_after_seconds))");
    expect(shortenSource).toContain("'Cache-Control': 'no-store'");
  });

  test('shorten migration keeps rate ceilings shared, private, atomic, and fail-closed', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260713000100_g013_short_url_security.sql')
      .replace(/\r\n/g, '\n');
    const supabaseTypes = source('integrations/supabase/types.ts');

    expect(migrationSource).toContain('CREATE SCHEMA IF NOT EXISTS shortener_private');
    expect(migrationSource).toContain("('ip', 20, 60)");
    expect(migrationSource).toContain("('global', 200, 60)");
    expect(migrationSource).toContain("('review', 10, 60)");
    expect(migrationSource).toContain('ON CONFLICT (policy_scope, bucket_key) DO UPDATE');
    expect(migrationSource).toContain('LIMIT 100');
    expect(migrationSource).toContain("p_now - interval '1 hour'");
    expect(migrationSource).toContain('SET search_path = \'\'');
    expect(migrationSource).toContain("auth.role() <> 'service_role'");
    expect(migrationSource).toContain('short_urls contains duplicate code rows; repair before applying G013');
    expect(migrationSource).toContain('short_urls contains duplicate target_url rows; repair before applying G013');
    expect(migrationSource).toContain('ADD CONSTRAINT short_urls_code_unique UNIQUE (code)');
    expect(migrationSource).toContain('ADD CONSTRAINT short_urls_target_url_unique UNIQUE (target_url)');
    expect(migrationSource).toContain('ON CONFLICT DO NOTHING');
    expect(migrationSource).toContain('COALESCE(array_length(p_candidate_codes, 1), 0) <> 5');
    expect(migrationSource).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.short_urls');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.allocate_short_url(text, uuid, uuid, text, text[])');
    expect(supabaseTypes).toContain('allocate_short_url: {');
    expect(supabaseTypes).toContain('p_candidate_codes: string[]');
    expect(supabaseTypes).toContain('allocation_failed: boolean');
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

  test('self account deletion atomically starts G014 after verified bearer reauthentication', () => {
    const accountDeleteSource = source('app/api/account/delete/route.ts');
    const revocationSource = source('lib/auth/session-revocation.ts');

    expect(accountDeleteSource).toContain("begin_account_deletion_apply_with_reauth");
    expect(accountDeleteSource).toContain("supabaseAdmin.auth.getUser(bearerToken)");
    expect(accountDeleteSource).not.toContain("consume_account_deletion_reauth_proof");
    expect(accountDeleteSource).not.toContain("revokeCurrentUserSessions");
    expect(accountDeleteSource).not.toContain("deleteUser(");
    expect(revocationSource).toContain("verifiedBearerToken?: string;");
    expect(revocationSource).toContain("auth.admin.signOut(accessToken, 'global')");
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
