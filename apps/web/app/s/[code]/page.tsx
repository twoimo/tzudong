import { redirect, notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// 환경변수에서 Supabase URL과 Anon Key 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function isSafeRedirectTarget(targetUrl: string) {
    try {
        const trimmedTargetUrl = targetUrl.trim();
        const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;

        if (trimmedTargetUrl.startsWith('//')) return false;
        if (!configuredOrigin && !trimmedTargetUrl.startsWith('/')) return false;

        const origin = configuredOrigin || 'http://localhost';
        const target = new URL(trimmedTargetUrl, origin);

        return (
            target.origin === new URL(origin).origin &&
            target.pathname === '/' &&
            isValidReviewId(target.searchParams.get('review'))
        );
    } catch {
        return false;
    }
}

function isValidReviewId(reviewId: string | null): reviewId is string {
    return !!reviewId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId);
}

interface PageProps {
    params: Promise<{ code: string }>;
}

export default async function ShortUrlRedirectPage({ params }: PageProps) {
    const { code } = await params;

    if (!code || code.length !== 6) {
        notFound();
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 단축 URL 조회
    const { data, error } = await supabase
        .from('short_urls')
        .select('target_url')
        .eq('code', code)
        .single();

    if (error || !data?.target_url) {
        notFound();
    }

    if (!isSafeRedirectTarget(data.target_url)) {
        redirect('/');
    }

    // 대상 URL로 리다이렉트
    redirect(data.target_url);
}

// 메타데이터 생성
export async function generateMetadata() {
    return {
        title: '쯔동여지도 - 리다이렉트 중...',
        robots: 'noindex',
    };
}
