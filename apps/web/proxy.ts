import { type NextRequest, NextResponse } from 'next/server'
import {
    E2E_ADMIN_ROUTE_BYPASS_HEADER,
    E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
    getE2EAdminRouteBypassExpectedToken,
    isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass'

const PUBLIC_API_PREFIXES = [
    '/api/health',
    '/api/shorten',
]

const PUBLIC_PAGE_PATHS = new Set([
    '/',
    '/home-frame',
    '/stamp',
])

function normalizeHostName(value: string) {
    const firstValue = value.split(',')[0]?.trim().toLowerCase() ?? ''

    if (firstValue.startsWith('[')) {
        const closingBracketIndex = firstValue.indexOf(']')
        return closingBracketIndex > 1 ? firstValue.slice(1, closingBracketIndex) : firstValue
    }

    if (firstValue === '::1') return firstValue
    if (firstValue.includes(':') && firstValue.split(':').length > 2) return firstValue

    return firstValue.split(':')[0] ?? ''
}

function isLocalPlaywrightHost(hostname: string) {
    const normalizedHostName = normalizeHostName(hostname)

    return normalizedHostName === 'localhost' || normalizedHostName === '127.0.0.1' || normalizedHostName === '::1'
}

function isLocalPlaywrightRequestUrlHost(hostname: string) {
    const normalizedHostName = normalizeHostName(hostname)

    return normalizedHostName === '0.0.0.0' || isLocalPlaywrightHost(normalizedHostName)
}

function isLocalPlaywrightHostHeader(
    value: string | null,
    options: { required?: boolean } = {},
) {
    if (!value) {
        return !options.required
    }

    return isLocalPlaywrightHost(normalizeHostName(value))
}

function isPlaywrightAdminBypassRequest(request: NextRequest) {
    const { hostname, pathname } = request.nextUrl
    const method = request.method.toUpperCase()
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'
    const expectedToken = getE2EAdminRouteBypassExpectedToken()
    const requestToken = request.headers.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim()

    // Test-only admin entry bypass. It is intentionally limited to local
    // Playwright page requests with a per-run token. Keep every predicate below
    // narrow: all other admin routes and non-admin path variants must continue
    // through Supabase session validation, even with similar headers present.
    return (
        (method === 'GET' || method === 'HEAD') &&
        isLocalPlaywrightRequestUrlHost(hostname) &&
        isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true }) &&
        isLocalPlaywrightHostHeader(request.headers.get('x-forwarded-host')) &&
        isE2EAdminRouteBypassEnvEnabled() &&
        request.headers.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1' &&
        requestToken === expectedToken &&
        normalizedPathname === '/admin'
    )
}

function shouldSkipSession(request: NextRequest) {
    const { pathname } = request.nextUrl
    const method = request.method.toUpperCase()

    if (isPlaywrightAdminBypassRequest(request)) {
        return true
    }

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
        '/',
        '/((?!$|api/health|api/shorten|_next/static|_next/image|favicon.ico|fonts/|images/|scripts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|otf|ttf|woff|woff2)$).*)',
    ],
}
