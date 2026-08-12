import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '../lib/security/bounded-json-request';
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
    expect(shortenSource).toContain('createSupabaseServiceRoleClient()');
    expect(shortenSource).not.toContain(".from('short_urls')");
    expect(shortenSource).not.toContain('new Map<');
    expect(shortenSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(shortenSource).not.toContain('console.');
  });
  test('health 503 diagnostics report only the bounded missing required environment names', () => {
    const healthSource = source('app/api/health/route.ts');
    const requiredEnvironmentVariables = healthSource.match(
      /const REQUIRED_ENVIRONMENT_VARIABLES = \[([\s\S]*?)\] as const;/,
    )?.[1].match(/'[^']+'/g);

    expect(requiredEnvironmentVariables).toEqual([
      "'TS7_RELEASE_ID'",
      "'VERCEL_GIT_COMMIT_SHA'",
      "'VERCEL_DEPLOYMENT_ID'",
      "'VERCEL_PROJECT_ID'",
    ]);

    const failureBlock = healthSource.match(
      /if \(missingRequiredEnvironmentVariables\.length > 0\) \{([\s\S]*?)\n    \}/,
    )?.[1];

    expect(failureBlock).toContain(
      "console.error('Health check missing required environment variables', missingRequiredEnvironmentVariables);",
    );
    expect(failureBlock).not.toContain('process.env');
    expect(failureBlock).not.toContain('releaseId');
    expect(failureBlock).not.toContain('gitSha');
    expect(failureBlock).not.toContain('deploymentId');
    expect(failureBlock).not.toContain('projectId');
    expect(failureBlock).toContain('return unavailable();');
    expect(healthSource).toContain("const unavailable = () => NextResponse.json(");
    expect(healthSource).toContain("process.env.TZUDONG_LOCAL_SUPABASE_DEV === '1'");
    expect(healthSource).toContain("process.env.NODE_ENV === 'development'");
    expect(healthSource).toContain("LOOPBACK_HOSTS.has(host)");
    expect(healthSource).toContain("mode: 'local-development'");
  });

  test('uses one bounded JSON reader for request bodies and keeps shorten request identity fail-closed', async () => {
    const shortenSource = source('app/api/shorten/route.ts');
    const onboardingSource = source('app/api/privacy/onboarding/route.ts');
    const youtubeMetaSource = source('app/api/youtube-meta/route.ts');
    const encoder = new TextEncoder();
    const requestFromChunks = (chunks: Uint8Array[], headers: HeadersInit = {}) => {
      const requestHeaders = new Headers(headers);
      if (!requestHeaders.has('content-type')) {
        requestHeaders.set('content-type', 'application/json');
      }

      return {
        headers: requestHeaders,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      } as unknown as Request;
    };

    for (const routeSource of [shortenSource, onboardingSource, youtubeMetaSource]) {
      expect(routeSource).toContain("from '@/lib/security/bounded-json-request'");
      expect(routeSource).toContain('readBoundedJsonRequest(request,');
      expect(routeSource).not.toContain('request.text()');
      expect(routeSource).not.toContain('request.json()');
    }

    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{"targetUrl":"/?review=ok"}')]),
      128,
    )).toEqual({ ok: true, value: { targetUrl: '/?review=ok' } });

    let cancelled = false;
    const overflowRequest = {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"targetUrl":"'));
          controller.enqueue(encoder.encode('x'.repeat(32)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    } as unknown as Request;
    expect(await readBoundedJsonRequest(overflowRequest, 16)).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge,
    });
    expect(cancelled).toBe(true);

    for (const request of [
      requestFromChunks([encoder.encode('{}')], { 'content-length': 'not-a-length' }),
      requestFromChunks([encoder.encode('{}')], { 'content-length': '1' }),
      requestFromChunks([encoder.encode('{}')], { 'content-length': '3' }),
      {
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'application/json';
            return name === 'content-length' ? '2, 2' : null;
          },
        } as unknown as Headers,
        body: requestFromChunks([encoder.encode('{}')]).body,
      } as unknown as Request,
    ]) {
      expect(await readBoundedJsonRequest(request, 128)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidContentLength,
      });
    }

    for (const request of [
      requestFromChunks([new Uint8Array([0xc3, 0x28])]),
      requestFromChunks([encoder.encode('{"targetUrl":')]),
    ]) {
      expect(await readBoundedJsonRequest(request, 128)).toEqual({
        ok: false,
        code: BOUNDED_JSON_REQUEST_ERROR.invalidJson,
      });
    }

    expect(await readBoundedJsonRequest(
      requestFromChunks([encoder.encode('{}')], { 'content-type': 'text/plain' }),
      128,
    )).toEqual({
      ok: false,
      code: BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType,
    });

    expect(shortenSource).toContain("const MAX_SHORTEN_BODY_BYTES = 4 * 1024");
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
    expect(shortenSource).toContain("parsed.protocol !== 'https:'");
    expect(shortenSource).not.toContain("request.headers.get('origin')");
  });

  test('shorten migration keeps rate ceilings shared, private, atomic, and fail-closed', () => {
    const migrationSource = repoSource('backend/supabase/migrations/20260713000100_g013_short_url_security.sql')
      .replace(/\r\n/g, '\n');
    const supabaseTypes = source('integrations/supabase/types.ts');

    expect(migrationSource).toContain('CREATE SCHEMA shortener_private;');
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
    expect(migrationSource).toContain('reviews.is_verified IS TRUE');
    expect(migrationSource).toContain("RAISE EXCEPTION 'short_url_review_not_verified'");
    expect(migrationSource).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.short_urls');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.allocate_short_url(text, uuid, uuid, text, text[])');
    expect(supabaseTypes).toContain('allocate_short_url: {');
    expect(supabaseTypes).toContain('p_candidate_codes: string[]');
    expect(supabaseTypes).toContain('allocation_failed: boolean');
  });

  test('reserves shared admin provider budgets before every credentialed dispatch', () => {
    const naverSearch = source('app/api/naver-search/route.ts');
    const naverGeocode = source('app/api/naver-geocode/route.ts');
    const youtubeMeta = source('app/api/youtube-meta/route.ts');
    const helperSource = source('lib/security/admin-provider-budget.ts');
    const typeSource = source('integrations/supabase/types.ts');
    const migrationSource = repoSource('backend/supabase/migrations/20260713000300_g013_admin_provider_budgets.sql');

    for (const [routeSource, provider] of [
      [naverSearch, 'naver_local_search'],
      [naverGeocode, 'naver_geocode'],
      [youtubeMeta, 'youtube_metadata'],
    ] as const) {
      expect(routeSource).toContain('await reserveAdminProviderBudget({');
      expect(routeSource).toContain(`provider: '${provider}'`);
      expect(routeSource.indexOf('await reserveAdminProviderBudget({')).toBeLessThan(routeSource.indexOf('await fetch('));
      expect(routeSource).toContain("'Retry-After': String(budget.retryAfterSeconds)");
      expect(routeSource).toContain("error: 'Provider budget unavailable'");
    }

    expect(helperSource).toContain("createSupabaseServiceRoleClient()");
    expect(helperSource).toContain(".rpc('reserve_admin_provider_budget'");
    expect(helperSource).not.toContain('error.message');
    expect(migrationSource).toContain('CREATE SCHEMA provider_budget_private;');
    expect(migrationSource).toContain('pg_advisory_xact_lock');
    expect(migrationSource).toContain("auth.role() <> 'service_role'");
    expect(migrationSource).toContain("account_status.account_status = 'active'");
    expect(migrationSource).toContain("scope IN ('actor_minute', 'global_minute', 'global_day')");
    expect(migrationSource).toContain("v_now - interval '2 days'");
    expect(migrationSource).toContain('REVOKE ALL ON TABLE provider_budget_private.admin_provider_budget_policies');
    expect(typeSource).toContain('reserve_admin_provider_budget: {');
  });
  test('keeps credentialed Naver quota mutations on bounded same-origin POST routes', () => {
    const naverSearch = source('app/api/naver-search/route.ts');
    const naverGeocode = source('app/api/naver-geocode/route.ts');
    const editRestaurantModal = source('components/admin/EditRestaurantModal.tsx');
    const missingRestaurantForm = source('components/admin/MissingRestaurantForm.tsx');
    const submissionListView = source('components/admin/SubmissionListView.tsx');

    for (const routeSource of [naverSearch, naverGeocode]) {
      expect(routeSource).toMatch(/export async function POST\(request: (?:Next)?Request\)/);
      expect(routeSource).not.toContain('export async function GET(');
      expect(routeSource).toContain('isTrustedSameOriginMutation(request)');
      expect(routeSource).toContain('readBoundedJsonRequest(request,');
      expect(routeSource.indexOf('isTrustedSameOriginMutation(request)')).toBeLessThan(
        routeSource.indexOf('await reserveAdminProviderBudget({'),
      );
      expect(routeSource.indexOf('readBoundedJsonRequest(request,')).toBeLessThan(
        routeSource.indexOf('await reserveAdminProviderBudget({'),
      );
    }

    for (const callerSource of [editRestaurantModal, submissionListView]) {
      expect(callerSource).toContain("fetch('/api/naver-search', {");
      expect(callerSource).toContain("method: 'POST'");
      expect(callerSource).toContain("'Content-Type': 'application/json'");
      expect(callerSource).not.toContain('/api/naver-search?');
    }
    expect(missingRestaurantForm).toContain("fetch('/api/naver-geocode', {");
    expect(missingRestaurantForm).toContain("method: 'POST'");
    expect(missingRestaurantForm).toContain("'Content-Type': 'application/json'");
    expect(missingRestaurantForm).not.toContain('/api/naver-geocode?');
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

  test('self account deletion delegates durable session-family cleanup before auth deletion', () => {
    const accountDeleteSource = source('app/api/account/delete/route.ts');
    const workerSource = source('lib/privacy/account-deletion-worker.ts');
    const deletionMigrationSource = repoSource(
      'backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql',
    );

    expect(accountDeleteSource).not.toContain('revokeCurrentUserSessions');
    expect(accountDeleteSource).not.toContain('auth.admin.deleteUser');
    expect(accountDeleteSource).toContain("rpc('begin_account_deletion_apply_with_reauth'");
    expect(accountDeleteSource).not.toContain('consume_account_deletion_reauth_proof');
    expect(accountDeleteSource).toContain('const cleanupResult = await supabaseAdmin.rpc(\'apply_account_deletion_database_cleanup\'');
    expect(accountDeleteSource).toContain('const readbackResult = await supabase.rpc(\'read_current_account_deletion_status\'');
    expect(accountDeleteSource).toContain('isAccountDeletionDatabaseCleanupRow(cleanup, body)');
    expect(accountDeleteSource).toContain('!readback.db_readback_passed');
    expect(accountDeleteSource).toContain('const replayReadbackResult = await supabase.rpc(\'read_current_account_deletion_status\'');
    expect(accountDeleteSource).toContain('const idempotencyKeyBinding = idempotencyKeyBindingSha256(body.idempotencyKey);');
    expect(accountDeleteSource).toContain('row.idempotency_key_binding_sha256 !== idempotencyKeyBinding');
    expect(accountDeleteSource).toContain('replayReadback.db_readback_passed === true');
    expect(accountDeleteSource).toContain('replayReadback.storage_readback_passed === false');
    expect(accountDeleteSource).not.toContain('storage.from(');
    expect(accountDeleteSource).toContain("rpc('preview_account_deletion'");
    expect(accountDeleteSource).toContain("hasOnlyKeys(value, ['targetUserId'])");
    expect(accountDeleteSource).toContain('p_reauthenticated_at: user.last_sign_in_at');
    expect(accountDeleteSource).toContain('Array.isArray(value) && value.length === 1');
    expect(accountDeleteSource).not.toContain('begin_account_deletion_apply\', {');
    expect(accountDeleteSource).not.toContain('requireAdmin');
    expect(workerSource).toContain("if (input.phase === 'session') return session(context);");
    expect(workerSource.indexOf("input.phase === 'session'")).toBeLessThan(
      workerSource.indexOf('context.dependencies.auth.deleteUser'),
    );
    expect(deletionMigrationSource).toContain(
      'CREATE OR REPLACE FUNCTION public.run_account_deletion_session_family_cleanup(',
    );
    expect(deletionMigrationSource).toContain(
      'DELETE FROM auth.refresh_tokens WHERE user_id = p_target_user_id;',
    );
    expect(deletionMigrationSource).toContain(
      'DELETE FROM auth.sessions WHERE user_id = p_target_user_id;',
    );
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
    const naverGeocodeSource = source('app/api/naver-geocode/route.ts');
    const youtubeMetaSource = source('app/api/youtube-meta/route.ts');
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
    expect(naverSearchSource).toContain("MAX_QUERY_LENGTH = 100");
    expect(naverSearchSource).toContain("/^[1-5]$/");
    expect(naverSearchSource).toContain("apiUrl.searchParams.set('display', String(display))");
    expect(naverSearchSource).toContain("AbortSignal.timeout(NAVER_SEARCH_TIMEOUT_MS)");
    expect(naverSearchSource).toContain("MAX_PROVIDER_RESPONSE_BYTES");
    expect(naverSearchSource).toContain("redirect: 'error'");
    expect(naverSearchSource).toContain("'Cache-Control': 'no-store'");
    expect(naverSearchSource).not.toContain("debugLog(");
    expect(naverSearchSource).not.toContain("response.text()");
    expect(naverGeocodeSource).toContain('MAX_QUERY_LENGTH = 200');
    expect(naverGeocodeSource).toContain('MAX_PROVIDER_RESPONSE_BYTES');
    expect(naverGeocodeSource).toContain('AbortSignal.timeout(NAVER_GEOCODE_TIMEOUT_MS)');
    expect(naverGeocodeSource).toContain("redirect: 'error'");
    expect(naverGeocodeSource).toContain("url.hostname.endsWith('.supabase.co')");
    expect(naverGeocodeSource).toContain("'Cache-Control': 'no-store'");
    expect(naverGeocodeSource).not.toContain('response.json()');
    expect(naverGeocodeSource).not.toContain('console.error');
    expect(youtubeMetaSource).toContain("'X-Goog-Api-Key': youtubeApiKey");
    expect(youtubeMetaSource).not.toContain("searchParams.set('key'");
    expect(youtubeMetaSource).toContain("MAX_REQUEST_BYTES = 2 * 1024");
    expect(youtubeMetaSource).toContain("MAX_PROVIDER_BYTES = 512 * 1024");
    expect(youtubeMetaSource).toContain("response_format: {");
    expect(youtubeMetaSource).toContain("type: 'json_schema'");
    expect(youtubeMetaSource).toContain("max_completion_tokens: 256");
    expect(youtubeMetaSource).toContain("maxItems: MAX_SPONSOR_COUNT");
    expect(youtubeMetaSource).toContain("hasPositiveFirstPartySponsorEvidence");
    expect(youtubeMetaSource).toContain("redirect: 'error'");
    expect(youtubeMetaSource).toContain("'Cache-Control': 'no-store'");
    expect(youtubeMetaSource).not.toContain("request.json()");
    expect(youtubeMetaSource).not.toContain("console.error");

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

    expect(adminUsersSource).toContain("code: 'ADMIN_USER_CREATION_ONBOARDING_REQUIRED'");
    expect(adminUsersSource).toContain("error: '새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.'");
    expect(adminUsersSource).not.toContain('auth.admin.createUser');
    expect(adminUserUpdateSource).toContain("step: 'auth-rollback-after-db-audit'");
    expect(directionsSource).toContain('diagnostics: { errorType: errorName }');
  });
});
