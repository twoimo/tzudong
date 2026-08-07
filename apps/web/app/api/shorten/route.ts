import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createHmac, randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import {
    BOUNDED_JSON_REQUEST_ERROR,
    readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type { Database } from '@/integrations/supabase/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const DEFAULT_SITE_ORIGIN = 'https://www.tzudong.app';
const MAX_SHORTEN_BODY_BYTES = 4 * 1024;
const MAX_TARGET_URL_LENGTH = 2_048;
const SHORT_CODE_CANDIDATE_COUNT = 5;
const SHORT_CODE_LENGTH = 6;
const SHORT_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const SHORTEN_ERRORS = {
    unsupportedMediaType: 'JSON 형식의 요청만 허용됩니다.',
    bodyTooLarge: '요청 본문이 너무 큽니다.',
    invalidBody: '요청 본문이 올바르지 않습니다.',
    targetRequired: '대상 URL이 필요합니다.',
    invalidTarget: '허용되지 않는 단축 URL 대상입니다.',
    storageUnavailable: '단축 URL 저장소가 설정되지 않았습니다.',
    reviewNotFound: '존재하지 않는 리뷰입니다.',
    rateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    codeGenerationFailed: '단축 코드 생성에 실패했습니다. 다시 시도해주세요.',
    storageFailed: '단축 URL 저장에 실패했습니다.',
    serverError: '서버 오류가 발생했습니다.',
} as const;
export const runtime = 'nodejs';

function noStoreJson(body: object, status = 200, headers?: Record<string, string>) {
    return NextResponse.json(body, {
        status,
        headers: {
            ...NO_STORE_HEADERS,
            ...headers,
        },
    });
}

function shortenError(error: string, status: number, headers?: Record<string, string>) {
    return noStoreJson({ error }, status, headers);
}

function getRequesterBucket(request: NextRequest) {
    const privacyHashKey = process.env.PRIVACY_AUDIT_HASH_KEY?.trim();
    if (
        process.env.VERCEL !== '1'
        || !privacyHashKey
        || Buffer.byteLength(privacyHashKey, 'utf8') < 32
    ) {
        return 'unknown';
    }

    const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for')?.trim();
    if (
        !vercelForwardedFor
        || vercelForwardedFor.includes(',')
        || isIP(vercelForwardedFor) === 0
    ) {
        return 'unknown';
    }

    return `ip:${createHmac('sha256', privacyHashKey).update(vercelForwardedFor).digest('hex')}`;
}

function parseTrustedSiteOrigin(value: string, allowLoopbackHttp: boolean) {
    try {
        const parsed = new URL(value);
        const isLoopback = parsed.hostname === 'localhost'
            || parsed.hostname === '127.0.0.1'
            || parsed.hostname === '[::1]';
        if (
            parsed.username
            || parsed.password
            || parsed.pathname !== '/'
            || parsed.search
            || parsed.hash
            || (parsed.protocol !== 'https:' && !(allowLoopbackHttp && parsed.protocol === 'http:' && isLoopback))
        ) {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}

function getShortUrlOrigin(request: NextRequest) {
    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredSiteUrl) {
        return parseTrustedSiteOrigin(configuredSiteUrl, process.env.NODE_ENV !== 'production')
            ?? DEFAULT_SITE_ORIGIN;
    }

    if (process.env.NODE_ENV !== 'production') {
        return parseTrustedSiteOrigin(request.nextUrl.origin, true) ?? DEFAULT_SITE_ORIGIN;
    }

    return DEFAULT_SITE_ORIGIN;
}

function getAllowedShortUrlTarget(targetUrl: string, request: NextRequest) {
    try {
        const origin = getShortUrlOrigin(request);
        const trimmedTargetUrl = targetUrl.trim();
        if (trimmedTargetUrl.startsWith('//')) return null;

        const target = new URL(trimmedTargetUrl, origin);
        const reviewId = target.searchParams.get('review');
        if (target.origin !== new URL(origin).origin || target.pathname !== '/' || !isValidReviewId(reviewId)) {
            return null;
        }

        const canonicalReviewId = reviewId.toLowerCase();
        return {
            canonicalTargetUrl: `/?review=${canonicalReviewId}`,
            reviewId: canonicalReviewId,
        };
    } catch {
        return null;
    }
}

function isValidReviewId(reviewId: string | null): reviewId is string {
    return !!reviewId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId);
}

function createSupabasePublicClient() {
    if (!supabaseUrl || !supabaseAnonKey) {
        return null;
    }

    return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

function createSupabaseAdminClient() {
    try {
        return createSupabaseServiceRoleClient();
    } catch {
        return null;
    }
}

function generateShortCode(): string {
    let code = '';
    for (let index = 0; index < SHORT_CODE_LENGTH; index += 1) {
        code += SHORT_CODE_ALPHABET.charAt(randomInt(SHORT_CODE_ALPHABET.length));
    }
    return code;
}

function generateShortCodeCandidates() {
    return Array.from({ length: SHORT_CODE_CANDIDATE_COUNT }, generateShortCode);
}

export async function POST(request: NextRequest) {
    try {
        const bodyResult = await readBoundedJsonRequest(request, MAX_SHORTEN_BODY_BYTES);
        if (!bodyResult.ok) {
            if (bodyResult.code === BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType) {
                return shortenError(SHORTEN_ERRORS.unsupportedMediaType, 415);
            }
            if (bodyResult.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge) {
                return shortenError(SHORTEN_ERRORS.bodyTooLarge, 413);
            }
            return shortenError(SHORTEN_ERRORS.invalidBody, 400);
        }

        const body = bodyResult.value;
        if (
            typeof body !== 'object'
            || body === null
            || Array.isArray(body)
            || Object.getPrototypeOf(body) !== Object.prototype
        ) {
            return shortenError(SHORTEN_ERRORS.invalidBody, 400);
        }

        const payload = body as Record<string, unknown>;
        const keys = Object.keys(payload);
        if (
            keys.length !== 1
            || keys[0] !== 'targetUrl'
            || typeof payload.targetUrl !== 'string'
            || payload.targetUrl.length > MAX_TARGET_URL_LENGTH
        ) {
            return shortenError(SHORTEN_ERRORS.invalidBody, 400);
        }

        const targetUrl = payload.targetUrl;
        if (!targetUrl.trim()) {
            return shortenError(SHORTEN_ERRORS.targetRequired, 400);
        }

        const allowedTarget = getAllowedShortUrlTarget(targetUrl, request);
        if (!allowedTarget) {
            return shortenError(SHORTEN_ERRORS.invalidTarget, 400);
        }

        const supabasePublic = createSupabasePublicClient();
        if (!supabasePublic) {
            return shortenError(SHORTEN_ERRORS.storageUnavailable, 500);
        }

        // 공개 리뷰 검증은 anon/RLS 경로로 먼저 수행한다. service-role은 검증된
        // 대상의 원자적 할당 RPC에만 사용해 공개 API의 데이터 노출면을 줄인다.
        const { data: review, error: reviewError } = await supabasePublic
            .from('reviews')
            .select('id, restaurant_id, is_verified')
            .eq('id', allowedTarget.reviewId)
            .eq('is_verified', true)
            .maybeSingle();

        if (reviewError || !review) {
            return shortenError(SHORTEN_ERRORS.reviewNotFound, 404);
        }

        const supabaseAdmin = createSupabaseAdminClient();
        if (!supabaseAdmin) {
            return shortenError(SHORTEN_ERRORS.storageUnavailable, 500);
        }

        const { data: allocation, error: allocationError } = await supabaseAdmin
            .rpc('allocate_short_url', {
                p_target_url: allowedTarget.canonicalTargetUrl,
                p_restaurant_id: review.restaurant_id,
                p_review_id: allowedTarget.reviewId,
                p_client_bucket: getRequesterBucket(request),
                p_candidate_codes: generateShortCodeCandidates(),
            })
            .maybeSingle();

        if (allocationError || !allocation) {
            return shortenError(SHORTEN_ERRORS.storageFailed, 500);
        }

        if (allocation.rate_limited) {
            return shortenError(
                SHORTEN_ERRORS.rateLimited,
                429,
                { 'Retry-After': String(Math.max(1, allocation.retry_after_seconds)) }
            );
        }

        if (allocation.allocation_failed || !allocation.code) {
            return shortenError(SHORTEN_ERRORS.codeGenerationFailed, 500);
        }

        const origin = getShortUrlOrigin(request);
        return noStoreJson({
            shortUrl: `${origin}/s/${allocation.code}`,
            code: allocation.code,
            isExisting: allocation.is_existing,
        });
    } catch {
        return shortenError(SHORTEN_ERRORS.serverError, 500);
    }
}
