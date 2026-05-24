import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

function getTrustedRedirectOrigin(requestOrigin: string) {
    if (process.env.NODE_ENV === 'development') {
        return requestOrigin;
    }

    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredSiteUrl) {
        try {
            return new URL(configuredSiteUrl).origin;
        } catch {
            return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
        }
    }

    return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    // "next" 파라미터가 있으면 리다이렉트 URL로 사용
    let next = searchParams.get('next') ?? '/';
    if (!next.startsWith('/')) {
        // 상대 경로가 아닌 경우 기본값 사용
        next = '/';
    }

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}${next}`);
        }
    }

    // 에러 발생 시 홈으로 리다이렉트
    return NextResponse.redirect(`${origin}/`);
}
