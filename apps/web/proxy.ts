import { type NextRequest, NextResponse } from 'next/server'
import {
    E2E_ADMIN_ROUTE_BYPASS_HEADER,
    E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
    getE2EAdminRouteBypassExpectedToken,
    isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass'
import {
    getDevAdminBypassCookieFromHeader,
    validateDevAdminBypassCookie,
} from '@/lib/auth/dev-admin-bypass-cookie'
import { classifyPublicEligibilitySessionRoute } from '@/lib/auth/public-eligibility-session'
import { isHomePrivacyOnboardingRequest } from '@/lib/auth/auth-redirect'
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation'
import { resolveConfiguredSupabaseOrigin } from '@/lib/profile-avatar-url'
import { hasSupabaseAuthCookieSessionHint } from '@/lib/supabase-auth-session-hints'

const DEV_ADMIN_BYPASS_MODULES = new Set([
    'youtube-thumbnail-generator',
    'storyboard',
])
const DEV_ADMIN_BYPASS_API_PREFIXES = [
    '/api/admin/youtube-thumbnail-generator',
    '/api/admin/storyboard',
]
const INTERNAL_CAPABILITY_PROXY_PATHS = new Set([
    '/api/internal/account-deletion',
    '/api/internal/privacy-retention',
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
        (normalizedPathname === '/admin' || normalizedPathname === '/admin/claims')
    )
}

function isPlaywrightRestaurantClaimApiBypassRequest(request: NextRequest) {
    const { hostname, pathname } = request.nextUrl
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'
    const expectedToken = getE2EAdminRouteBypassExpectedToken()
    const requestToken = request.headers.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim()

    return (
        (
            normalizedPathname === '/api/admin/claims'
            || normalizedPathname === '/api/admin/claims/preview'
            || normalizedPathname === '/api/admin/claims/apply'
        ) &&
        isLocalPlaywrightRequestUrlHost(hostname) &&
        isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true }) &&
        isLocalPlaywrightHostHeader(request.headers.get('x-forwarded-host')) &&
        isE2EAdminRouteBypassEnvEnabled() &&
        request.headers.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1' &&
        requestToken === expectedToken
    )
}

function isDevAdminThumbnailBootstrapRequest(request: NextRequest) {
    const { hostname, pathname } = request.nextUrl
    const method = request.method.toUpperCase()
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'

    return (
        (method === 'GET' || method === 'HEAD') &&
        normalizedPathname === '/api/dev/admin-thumbnail-bootstrap' &&
        isLocalPlaywrightRequestUrlHost(hostname) &&
        isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true }) &&
        isE2EAdminRouteBypassEnvEnabled()
    )
}

function isE2EAdminThumbnailApiBypassRequest(request: NextRequest) {
    const { hostname, pathname } = request.nextUrl
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'
    const expectedToken = getE2EAdminRouteBypassExpectedToken()
    const requestToken = request.headers.get(E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER)?.trim()

    return (
        normalizedPathname.startsWith('/api/admin/youtube-thumbnail-generator') &&
        isLocalPlaywrightRequestUrlHost(hostname) &&
        isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true }) &&
        isLocalPlaywrightHostHeader(request.headers.get('x-forwarded-host')) &&
        isE2EAdminRouteBypassEnvEnabled() &&
        request.headers.get(E2E_ADMIN_ROUTE_BYPASS_HEADER) === '1' &&
        requestToken === expectedToken
    )
}

async function isDevAdminThumbnailApiCookieBypassRequest(request: NextRequest) {
    const { hostname, pathname } = request.nextUrl
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'

    if (!DEV_ADMIN_BYPASS_API_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) return false
    if (!isLocalPlaywrightRequestUrlHost(hostname)) return false
    if (!isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true })) return false

    const cookieValue = getDevAdminBypassCookieFromHeader(request.headers.get('cookie'))
    const validation = await validateDevAdminBypassCookie({
        cookieValue,
        host: request.headers.get('host'),
    })
    return validation.ok
}

async function isDevAdminThumbnailBypassRequest(request: NextRequest) {
    const { hostname, pathname, searchParams } = request.nextUrl
    const method = request.method.toUpperCase()
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'

    if ((method !== 'GET' && method !== 'HEAD') || normalizedPathname !== '/admin') {
        return false
    }
    if (!DEV_ADMIN_BYPASS_MODULES.has(searchParams.get('module') ?? '')) return false
    if (!isLocalPlaywrightHost(normalizeHostName(hostname))) return false
    if (!isLocalPlaywrightHostHeader(request.headers.get('host'), { required: true })) return false

    const cookieValue = getDevAdminBypassCookieFromHeader(request.headers.get('cookie'))
    const validation = await validateDevAdminBypassCookie({
        cookieValue,
        host: request.headers.get('host'),
    })
    return validation.ok
}
function isInternalCapabilityProxyPath(request: NextRequest) {
    return INTERNAL_CAPABILITY_PROXY_PATHS.has(request.nextUrl.pathname.replace(/\/+$/, '') || '/')
}

function isInternalCapabilityProxyRequest(request: NextRequest) {
    return request.method.toUpperCase() === 'POST' && isInternalCapabilityProxyPath(request)
}

function isTrustedProxyMutation(request: NextRequest) {
    if (!isInternalCapabilityProxyPath(request) || request.method.toUpperCase() === 'POST') {
        return isTrustedSameOriginMutation(request)
    }

    const headers = new Headers(request.headers)
    headers.delete('x-account-deletion-worker-capability')
    headers.delete('x-privacy-retention-capability')
    return isTrustedSameOriginMutation(new Request(request.url, { method: request.method, headers }))
}


async function shouldSkipSession(request: NextRequest) {
    const { pathname } = request.nextUrl
    const method = request.method
    const routeClass = classifyPublicEligibilitySessionRoute({ pathname, method })
    const hasSessionHint = hasSupabaseAuthCookieSessionHint(request.headers.get('cookie') ?? undefined)
    if (
        (method === 'GET' || method === 'HEAD')
        && isHomePrivacyOnboardingRequest({
            pathname,
            search: request.nextUrl.search,
        })
    ) {
        return true
    }

    if (routeClass === 'loop-safe' || (!hasSessionHint && routeClass === 'credentialless-public')) {
        return true
    }
    if (isPlaywrightAdminBypassRequest(request)) {
        return true
    }

    if (isPlaywrightRestaurantClaimApiBypassRequest(request)) {
        return true
    }

    if (await isDevAdminThumbnailBypassRequest(request)) {
        return true
    }

    if (isDevAdminThumbnailBootstrapRequest(request)) {
        return true
    }

    if (isE2EAdminThumbnailApiBypassRequest(request)) {
        return true
    }

    if (await isDevAdminThumbnailApiCookieBypassRequest(request)) {
        return true
    }

    return false
}

const SUPABASE_IMAGE_PUBLIC_PATHS = [
    '/storage/v1/object/public/profile-avatars/',
    '/storage/v1/object/public/review-photos/',
] as const

const TRUSTED_IMAGE_SOURCES = [
    'https://lh3.googleusercontent.com/a/',
    'https://maps.googleapis.com/maps/vt',
    'https://maps.gstatic.com/mapfiles/',
    'https://map.pstatic.net/',
    'https://ssl.pstatic.net/',
    'https://nrbe.pstatic.net/',
    'https://nrbe.map.naver.net/',
    'https://static.naver.net/',
    'https://img.youtube.com/vi/',
    'https://i.ytimg.com/vi/',
] as const

function buildImageSources() {
    const configuredSupabaseOrigin = resolveConfiguredSupabaseOrigin()
    const configuredStorageSources = configuredSupabaseOrigin
        ? SUPABASE_IMAGE_PUBLIC_PATHS.map((path) => `${configuredSupabaseOrigin}${path}`)
        : []

    // `data:` is limited to source-controlled CSS imagery, and `blob:` to local upload previews.
    return ["'self'", 'data:', 'blob:', ...TRUSTED_IMAGE_SOURCES, ...configuredStorageSources].join(' ')
}

function buildContentSecurityPolicy(nonce: string) {
    const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
    const developmentConnectSources = process.env.NODE_ENV === 'development' ? ' http: ws:' : ''
    const loopbackGrafanaFrameSrc =
        process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1'
            ? ' http://127.0.0.1:3001'
            : ''
    const directives = [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptSource} https://maps.googleapis.com https://oapi.map.naver.com`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        `img-src ${buildImageSources()}`,
        "font-src 'self' data:",
        `connect-src 'self'${developmentConnectSources} https://api.openai.com https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://*.gstatic.com https://*.naver.com https://*.naver.net https://*.pstatic.net`,
        "media-src 'self' blob: https://*.supabase.co",
        "worker-src 'self' blob:",
        `frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com${loopbackGrafanaFrameSrc}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "manifest-src 'self'",
        ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
    ]
    return directives.join('; ')
}

function buildCspRequestHeaders(request: NextRequest) {
    const nonce = btoa(crypto.randomUUID())
    const policy = buildContentSecurityPolicy(nonce)
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)
    requestHeaders.set('Content-Security-Policy', policy)
    return { policy, requestHeaders }
}

function applyContentSecurityPolicy(response: NextResponse, policy: string) {
    response.headers.set('Content-Security-Policy', policy)
    return response
}

/**
 * Keeps public privacy/auth/onboarding paths loop-safe. Protected requests are
 * routed through updateSession, which requires live self eligibility before release.
 */
export async function proxy(request: NextRequest) {
    const { policy, requestHeaders } = buildCspRequestHeaders(request)

    if (!isInternalCapabilityProxyRequest(request) && !isTrustedProxyMutation(request)) {
        return applyContentSecurityPolicy(
            NextResponse.json(
                { error: 'Forbidden' },
                { status: 403, headers: { 'Cache-Control': 'no-store' } },
            ),
            policy,
        )
    }

    if (await shouldSkipSession(request)) {
        return applyContentSecurityPolicy(
            NextResponse.next({ request: { headers: requestHeaders } }),
            policy,
        )
    }

    const { updateSession } = await import('@/lib/supabase/middleware')
    return applyContentSecurityPolicy(
        await updateSession(request, requestHeaders),
        policy,
    )
}

export const config = {
    matcher: [
        '/',
        '/((?!$|_next/static|_next/image|favicon.ico|fonts/|images/|scripts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|otf|ttf|woff|woff2)$).*)',
    ],
}
