import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * [PERF] 최적화된 프록시
 * - API 라우트와 정적 자산은 세션 업데이트를 건너뜀
 * - 인증이 필요 없는 공개 라우트도 빠르게 통과
 */
export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    // [PERF] API 라우트 중 인증이 불필요한 공개 API는 세션 갱신 스킵
    // 이렇게 하면 공개 API 응답 시간이 ~50ms 개선됨
    if (
        pathname.startsWith('/api/naver-') ||
        pathname.startsWith('/api/youtube-meta') ||
        pathname.startsWith('/api/shorten')
    ) {
        return NextResponse.next()
    }

    return await updateSession(request)
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|otf|ttf|woff|woff2)$).*)',
    ],
}
