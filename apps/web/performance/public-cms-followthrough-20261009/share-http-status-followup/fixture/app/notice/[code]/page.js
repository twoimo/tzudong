import { jsx as _jsx } from "react/jsx-runtime";
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { ShareRedirectNotice } from '@/components/share/ShareRedirectNotice';
import { isValidShortUrlCode, resolveShortUrlRead } from '@/lib/share/short-url-read';
// 환경변수에서 Supabase URL과 Anon Key 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
function isSafeRedirectTarget(targetUrl) {
    try {
        const trimmedTargetUrl = targetUrl.trim();
        const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
        if (trimmedTargetUrl.startsWith('//'))
            return false;
        if (!configuredOrigin && !trimmedTargetUrl.startsWith('/'))
            return false;
        const origin = configuredOrigin || 'http://localhost';
        const target = new URL(trimmedTargetUrl, origin);
        return (target.origin === new URL(origin).origin &&
            target.pathname === '/' &&
            isValidReviewId(target.searchParams.get('review')));
    }
    catch {
        return false;
    }
}
function isValidReviewId(reviewId) {
    return !!reviewId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId);
}
export default async function ShortUrlRedirectPage({ params }) {
    const { code } = await params;
    if (!isValidShortUrlCode(code)) {
        return _jsx(ShareRedirectNotice, { kind: "not-found" });
    }
    let lookup;
    try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        lookup = await supabase
            .from('short_urls')
            .select('target_url')
            .eq('code', code)
            .abortSignal(AbortSignal.timeout(10_000))
            .maybeSingle();
    }
    catch {
        return _jsx(ShareRedirectNotice, { kind: "unavailable", code: code });
    }
    const result = resolveShortUrlRead(lookup.data, lookup.error, isSafeRedirectTarget);
    if (result.kind === 'redirect') {
        // Keep Next's redirect outside the expected lookup-failure boundary.
        redirect(result.target);
    }
    return _jsx(ShareRedirectNotice, { kind: result.kind, code: code });
}
// 메타데이터 생성
export async function generateMetadata() {
    return {
        title: '리다이렉트 중 - 쯔동여지도',
        robots: 'noindex',
    };
}
