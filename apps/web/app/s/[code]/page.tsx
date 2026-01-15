import { redirect, notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

// 환경변수에서 Supabase URL과 Anon Key 가져오기
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

    // 대상 URL로 리다이렉트
    redirect(data.target_url);
}

// 메타데이터 생성
export async function generateMetadata({ params }: PageProps) {
    return {
        title: '쯔동여지도 - 리다이렉트 중...',
        robots: 'noindex',
    };
}
