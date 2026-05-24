import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

function getTrustedRedirectOrigin(requestOrigin: string) {
    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredSiteUrl) {
        try {
            return new URL(configuredSiteUrl).origin;
        } catch {
            return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
        }
    }

    if (process.env.NODE_ENV !== 'production') {
        try {
            return new URL(requestOrigin).origin;
        } catch {
            return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
        }
    }

    return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
}


function getSafeNextPath(value: string | null) {
    const next = value?.trim() || '/';
    if (next.length > 160) return '/';
    if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';

    const [pathname, query = ''] = next.split('?', 2);
    const safePathPattern = /^\/(?:mypage(?:\/[A-Za-z0-9_-]+)*|submissions(?:\/[A-Za-z0-9_-]+)*|user(?:\/[A-Za-z0-9_-]+)*|)$/;
    if (!safePathPattern.test(pathname)) return '/';
    if (query && !/^[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/.test(query)) return '/';

    return query ? `${pathname}?${query}` : pathname;
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = getSafeNextPath(searchParams.get('next'));

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}${next}`);
        }
    }

    // 에러 발생 시 홈으로 리다이렉트
    return NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}/`);
}
