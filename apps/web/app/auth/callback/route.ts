import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
            const forwardedHost = request.headers.get('x-forwarded-host');
            const isLocalEnv = process.env.NODE_ENV === 'development';
            if (isLocalEnv) {
                // 로컬 환경에서는 로드 밸런서가 없으므로 origin 사용
                return NextResponse.redirect(`${origin}${next}`);
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`);
            } else {
                return NextResponse.redirect(`${origin}${next}`);
            }
        }
    }

    // 에러 발생 시 홈으로 리다이렉트
    return NextResponse.redirect(`${origin}/`);
}
