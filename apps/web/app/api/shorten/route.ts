import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';

// 환경변수에서 Supabase URL과 Service Role Key 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_SITE_ORIGIN = 'https://www.tzudong.app';
const SHORTEN_RATE_LIMIT_WINDOW_MS = 60_000;
const SHORTEN_RATE_LIMIT_MAX_REQUESTS = 20;
const shortenRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export const runtime = 'nodejs';

function getRequesterKey(request: NextRequest) {
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const realIp = request.headers.get('x-real-ip')?.trim();
    return forwardedFor || realIp || 'unknown';
}

function isRateLimited(request: NextRequest) {
    const now = Date.now();
    const key = getRequesterKey(request);
    const bucket = shortenRateLimitBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
        shortenRateLimitBuckets.set(key, { count: 1, resetAt: now + SHORTEN_RATE_LIMIT_WINDOW_MS });
        return false;
    }

    bucket.count += 1;
    if (bucket.count > SHORTEN_RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }

    return false;
}

function getShortUrlOrigin(request: NextRequest) {
    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredSiteUrl) {
        try {
            return new URL(configuredSiteUrl).origin;
        } catch {
            return DEFAULT_SITE_ORIGIN;
        }
    }

    if (process.env.NODE_ENV !== 'production') {
        const developmentOrigin = request.headers.get('origin') || request.nextUrl.origin;
        try {
            return new URL(developmentOrigin).origin;
        } catch {
            return DEFAULT_SITE_ORIGIN;
        }
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
        if (target.origin !== new URL(origin).origin) return null;
        if (target.pathname !== '/' || !isValidReviewId(reviewId)) return null;

        return {
            canonicalTargetUrl: `/?review=${encodeURIComponent(reviewId)}`,
            reviewId,
        };
    } catch {
        return null;
    }
}

function isValidReviewId(reviewId: string | null): reviewId is string {
    return !!reviewId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId);
}

// 6자리 영숫자 코드 생성
function generateShortCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(randomInt(chars.length));
    }
    return code;
}

export async function POST(request: NextRequest) {
    try {
        if (isRateLimited(request)) {
            return NextResponse.json(
                { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { targetUrl } = body;

        if (!targetUrl) {
            return NextResponse.json(
                { error: '대상 URL이 필요합니다.' },
                { status: 400 }
            );
        }

        const allowedTarget = getAllowedShortUrlTarget(targetUrl, request);
        if (!allowedTarget) {
            return NextResponse.json(
                { error: '허용되지 않는 단축 URL 대상입니다.' },
                { status: 400 }
            );
        }

        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json(
                { error: '단축 URL 저장소가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

        const supabase = createSupabaseAdminClient(supabaseUrl, supabaseServiceKey);

        const { data: review, error: reviewError } = await supabase
            .from('reviews')
            .select('id, restaurant_id')
            .eq('id', allowedTarget.reviewId)
            .maybeSingle();

        if (reviewError || !review) {
            return NextResponse.json(
                { error: '존재하지 않는 리뷰입니다.' },
                { status: 404 }
            );
        }

        // 동일한 targetUrl이 이미 존재하는지 확인
        const { data: existing } = await supabase
            .from('short_urls')
            .select('code')
            .eq('target_url', allowedTarget.canonicalTargetUrl)
            .single();

        if (existing) {
            // 이미 존재하면 기존 코드 반환
            const origin = getShortUrlOrigin(request);
            return NextResponse.json({
                shortUrl: `${origin}/s/${existing.code}`,
                code: existing.code,
                isExisting: true,
            });
        }

        // 새 코드 생성 (충돌 방지를 위해 최대 5회 시도)
        let code = '';
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            code = generateShortCode();
            const { data: codeExists } = await supabase
                .from('short_urls')
                .select('id')
                .eq('code', code)
                .single();

            if (!codeExists) break;
            attempts++;
        }

        if (attempts >= maxAttempts) {
            return NextResponse.json(
                { error: '단축 코드 생성에 실패했습니다. 다시 시도해주세요.' },
                { status: 500 }
            );
        }

        // 단축 URL 저장
        const { error: insertError } = await supabase
            .from('short_urls')
            .insert({
                code,
                target_url: allowedTarget.canonicalTargetUrl,
                restaurant_id: review.restaurant_id,
                restaurant_name: null,
            });

        if (insertError) {
            console.error('단축 URL 저장 실패:', insertError);
            return NextResponse.json(
                { error: '단축 URL 저장에 실패했습니다.' },
                { status: 500 }
            );
        }

        const origin = getShortUrlOrigin(request);
        return NextResponse.json({
            shortUrl: `${origin}/s/${code}`,
            code,
            isExisting: false,
        });

    } catch (error) {
        console.error('단축 URL 생성 오류:', error);
        return NextResponse.json(
            { error: '서버 오류가 발생했습니다.' },
            { status: 500 }
        );
    }
}
