import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC_API_PREFIXES = [
    '/api/health',
    '/api/naver-',
    '/api/youtube-meta',
    '/api/shorten',
]

const PUBLIC_PAGE_PATHS = new Set([
    '/',
])

function shouldSkipSession(request: NextRequest) {
    const { pathname } = request.nextUrl
    const method = request.method.toUpperCase()

    if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        return true
    }

    if ((method === 'GET' || method === 'HEAD') && PUBLIC_PAGE_PATHS.has(pathname)) {
        return true
    }

    return false
}

/**
 * [PERF] 최적화된 프록시
 * - API 라우트와 정적 자산은 세션 업데이트를 건너뜀
 * - 인증이 필요 없는 공개 라우트도 빠르게 통과
 */
export async function proxy(request: NextRequest) {
    if (shouldSkipSession(request)) {
        return NextResponse.next()
    }

    const { updateSession } = await import('@/lib/supabase/middleware')
    return await updateSession(request)
}

export const config = {
    matcher: [
        '/((?!$|api/health|api/naver-|api/youtube-meta|api/shorten|_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|otf|ttf|woff|woff2)$).*)',
    ],
}
