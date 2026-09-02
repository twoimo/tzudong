import { expect, mock, test } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import {
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS,
    E2E_ADMIN_ROUTE_BYPASS_HEADER,
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
    E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_ENV,
    E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_RUNTIME,
    E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '@/lib/e2e-admin-route-bypass'
import {
    DEV_ADMIN_BYPASS_COOKIE_NAME,
    createDevAdminBypassCookieValue,
} from '@/lib/auth/dev-admin-bypass-cookie'

function loadProxyModule() {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return import(`@/proxy?${nonce}`) as Promise<typeof import('@/proxy')>
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_VERCEL = process.env.VERCEL
const ADMIN_BYPASS_TOKEN = 'test-admin-bypass-token'

function resetAdminBypassEnv() {
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_ENV]

    if (ORIGINAL_NODE_ENV === undefined) {
        delete process.env.NODE_ENV
    } else {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV
    }
    if (ORIGINAL_VERCEL === undefined) {
        delete process.env.VERCEL
    } else {
        process.env.VERCEL = ORIGINAL_VERCEL
    }
}

function enableAdminBypassEnv() {
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] = '1'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context] = E2E_ADMIN_ROUTE_BYPASS_CONTEXT
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] = E2E_ADMIN_ROUTE_BYPASS_RUNTIME
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token] = `  ${ADMIN_BYPASS_TOKEN}  `
}

function adminBypassHeaders(overrides: Record<string, string> = {}) {
    return {
        host: 'localhost:3000',
        [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
        [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: ADMIN_BYPASS_TOKEN,
        ...overrides,
    }
}

test('공개 경로는 세션 갱신을 건너뛴다', async () => {
    resetAdminBypassEnv()
    let updateSessionCalls = 0

    mock.module('@/lib/supabase/middleware', () => ({
        updateSession: async () => {
            updateSessionCalls += 1
            return NextResponse.json({ skipped: false })
        },
    }))

    const { proxy } = await loadProxyModule()

    const homeResponse = await proxy(new NextRequest('http://localhost:3000/'))
    const healthResponse = await proxy(new NextRequest('http://localhost:3000/api/health'))
    const stampResponse = await proxy(new NextRequest('http://localhost:3000/stamp'))

    expect(homeResponse.status).toBe(200)
    expect(healthResponse.status).toBe(200)
    expect(stampResponse.status).toBe(200)
    expect(updateSessionCalls).toBe(0)
})

test('보호 경로는 세션 갱신을 수행한다', async () => {
    resetAdminBypassEnv()
    let updateSessionCalls = 0

    mock.module('@/lib/supabase/middleware', () => ({
        updateSession: async () => {
            updateSessionCalls += 1
            return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
        },
    }))

    const { proxy } = await loadProxyModule()
    const response = await proxy(new NextRequest('http://localhost:3000/mypage'))

    expect(updateSessionCalls).toBe(1)
    expect(response.headers.get('x-auth-checked')).toBe('1')
})
test('internal capability POST allowlist reaches routes without bypassing other mutations', async () => {
    resetAdminBypassEnv()
    let updateSessionCalls = 0

    mock.module('@/lib/supabase/middleware', () => ({
        updateSession: async () => {
            updateSessionCalls += 1
            return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
        },
    }))

    const { proxy } = await loadProxyModule()
    const accountDeletionResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/account-deletion', {
        method: 'POST',
    }))
    const privacyRetentionResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/privacy-retention/', {
        method: 'POST',
    }))
    const accountDeletionNearMissResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/account-deletion-worker', {
        method: 'POST',
    }))
    const privacyRetentionNearMissResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/privacy-retention/replay', {
        method: 'POST',
    }))
    const accountDeletionPatchResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/account-deletion', {
        method: 'PATCH',
        headers: { 'x-account-deletion-worker-capability': 'a'.repeat(32) },
    }))
    const accountDeletionSameOriginPatchResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/account-deletion', {
        method: 'PATCH',
        headers: {
            origin: 'http://localhost:3000',
            'sec-fetch-site': 'same-origin',
            'x-account-deletion-worker-capability': 'a'.repeat(32),
        },
    }))
    const privacyRetentionDeleteResponse = await proxy(new NextRequest('http://localhost:3000/api/internal/privacy-retention', {
        method: 'DELETE',
        headers: { 'x-privacy-retention-capability': 'b'.repeat(32) },
    }))
    const ordinaryMutationResponse = await proxy(new NextRequest('http://localhost:3000/api/account/delete', {
        method: 'POST',
    }))

    expect(accountDeletionResponse.headers.get('x-auth-checked')).toBe('1')
    expect(privacyRetentionResponse.headers.get('x-auth-checked')).toBe('1')
    expect(accountDeletionNearMissResponse.status).toBe(403)
    expect(privacyRetentionNearMissResponse.status).toBe(403)
    expect(accountDeletionPatchResponse.status).toBe(403)
    expect(accountDeletionSameOriginPatchResponse.headers.get('x-auth-checked')).toBe('1')
    expect(privacyRetentionDeleteResponse.status).toBe(403)
    expect(ordinaryMutationResponse.status).toBe(403)
    expect(updateSessionCalls).toBe(3)
})

test('관리자 우회 헤더가 있어도 env가 꺼져 있으면 세션 갱신을 수행한다', async () => {
    resetAdminBypassEnv()
    let updateSessionCalls = 0

    mock.module('@/lib/supabase/middleware', () => ({
        updateSession: async () => {
            updateSessionCalls += 1
            return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
        },
    }))

    const { proxy } = await loadProxyModule()
    const response = await proxy(
        new NextRequest('http://localhost:3000/admin', {
            headers: adminBypassHeaders(),
        }),
    )

    expect(updateSessionCalls).toBe(1)
    expect(response.headers.get('x-auth-checked')).toBe('1')
})

test('관리자 우회 env와 토큰이 있어도 Playwright 컨텍스트가 아니면 세션 갱신을 수행한다', async () => {
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] = '1'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] = E2E_ADMIN_ROUTE_BYPASS_RUNTIME
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token] = `  ${ADMIN_BYPASS_TOKEN}  `

    try {
        let updateSessionCalls = 0

        mock.module('@/lib/supabase/middleware', () => ({
            updateSession: async () => {
                updateSessionCalls += 1
                return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
            },
        }))

        const { proxy } = await loadProxyModule()
        const response = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders(),
            }),
        )

        expect(updateSessionCalls).toBe(1)
        expect(response.headers.get('x-auth-checked')).toBe('1')
    } finally {
        resetAdminBypassEnv()
    }
})

test('관리자 우회는 runtime 마커가 없거나 production이면 세션 갱신을 수행한다', async () => {
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] = '1'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context] = E2E_ADMIN_ROUTE_BYPASS_CONTEXT
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token] = `  ${ADMIN_BYPASS_TOKEN}  `

    try {
        let updateSessionCalls = 0

        mock.module('@/lib/supabase/middleware', () => ({
            updateSession: async () => {
                updateSessionCalls += 1
                return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
            },
        }))

        const { proxy } = await loadProxyModule()
        const missingRuntimeResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders(),
            }),
        )

        process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] = E2E_ADMIN_ROUTE_BYPASS_RUNTIME
        process.env.NODE_ENV = 'production'

        const productionResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders(),
            }),
        )

        expect(missingRuntimeResponse.headers.get('x-auth-checked')).toBe('1')
        expect(productionResponse.headers.get('x-auth-checked')).toBe('1')
        expect(updateSessionCalls).toBe(2)
    } finally {
        resetAdminBypassEnv()
    }
})

test('로컬 production bundle smoke 우회는 명시 플래그와 로컬 호스트에서만 허용된다', async () => {
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '0'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] = '1'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context] = E2E_ADMIN_ROUTE_BYPASS_CONTEXT
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] = E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_RUNTIME
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token] = `  ${ADMIN_BYPASS_TOKEN}  `
    process.env[E2E_ADMIN_ROUTE_BYPASS_PRODUCTION_SMOKE_ENV] = '1'

    try {
        let updateSessionCalls = 0

        mock.module('@/lib/supabase/middleware', () => ({
            updateSession: async () => {
                updateSessionCalls += 1
                return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
            },
        }))

        const { proxy } = await loadProxyModule()
        const allowedResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=storyboard', {
                headers: adminBypassHeaders(),
            }),
        )

        process.env.VERCEL = '1'
        const vercelResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=storyboard', {
                headers: adminBypassHeaders(),
            }),
        )
        process.env.VERCEL = '0'

        const externalHostResponse = await proxy(
            new NextRequest('https://example.com/admin?module=storyboard', {
                headers: adminBypassHeaders({ host: 'example.com' }),
            }),
        )

        expect(allowedResponse.headers.get('x-auth-checked')).toBeNull()
        expect(vercelResponse.headers.get('x-auth-checked')).toBe('1')
        expect(externalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(updateSessionCalls).toBe(2)
    } finally {
        resetAdminBypassEnv()
    }
})

test('Playwright 관리자 우회는 env와 토큰 헤더가 모두 맞는 /admin과 /admin/claims 진입에만 허용된다', async () => {
    enableAdminBypassEnv()

    try {
        let updateSessionCalls = 0

        mock.module('@/lib/supabase/middleware', () => ({
            updateSession: async () => {
                updateSessionCalls += 1
                return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
            },
        }))

        const { proxy } = await loadProxyModule()
        const allowedResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/', {
                headers: adminBypassHeaders(),
            }),
        )
        const allowedQueryResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/?module=overview', {
                headers: adminBypassHeaders(),
            }),
        )
        const allowedWhitespaceHeaderResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: `  ${ADMIN_BYPASS_TOKEN}  `,
                }),
            }),
        )
        const headResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                method: 'HEAD',
                headers: adminBypassHeaders(),
            }),
        )
        const uppercaseHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({ host: 'LOCALHOST:3000' }),
            }),
        )
        const ipv6HostResponse = await proxy(
            new NextRequest('http://[::1]:3000/admin', {
                headers: adminBypassHeaders({ host: '[::1]:3000' }),
            }),
        )
        const bindAddressUrlResponse = await proxy(
            new NextRequest('http://0.0.0.0:8080/admin', {
                headers: adminBypassHeaders({ host: 'localhost:8080' }),
            }),
        )
        const missingTokenResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: '',
                }),
            }),
        )
        const invalidTokenResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: 'wrong-token',
                }),
            }),
        )
        const nonLocalHostResponse = await proxy(
            new NextRequest('https://example.com/admin', {
                headers: adminBypassHeaders(),
            }),
        )
        const hostHeaderResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    host: 'example.com',
                }),
            }),
        )
        const forwardedHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    'x-forwarded-host': 'example.com',
                }),
            }),
        )
        const forwardedLocalHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    'x-forwarded-host': '[::1]:3000',
                }),
            }),
        )
        const deceptiveLocalHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    host: 'localhost.evil.com',
                }),
            }),
        )
        const malformedLocalHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: adminBypassHeaders({
                    host: 'localhost@evil.test',
                }),
            }),
        )
        const bindAddressHostHeaderResponse = await proxy(
            new NextRequest('http://0.0.0.0:8080/admin', {
                headers: adminBypassHeaders({
                    host: '0.0.0.0:8080',
                }),
            }),
        )
        const missingHostResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                headers: {
                    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
                    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: ADMIN_BYPASS_TOKEN,
                },
            }),
        )
        const nonAdminVariantResponse = await proxy(
            new NextRequest('http://localhost:3000/administrator', {
                headers: adminBypassHeaders(),
            }),
        )
        const childRouteResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/evaluations', {
                headers: adminBypassHeaders(),
            }),
        )
        const claimsRouteResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/claims', {
                headers: adminBypassHeaders(),
            }),
        )
        const claimsChildRouteResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/claims/foo', {
                headers: adminBypassHeaders(),
            }),
        )
        const claimsApiResponse = await proxy(
            new NextRequest('http://localhost:3000/api/admin/claims', {
                headers: adminBypassHeaders(),
            }),
        )
        const claimsPreviewApiResponse = await proxy(
            new NextRequest('http://localhost:3000/api/admin/claims/preview', {
                headers: adminBypassHeaders(),
            }),
        )
        const claimsApplyApiResponse = await proxy(
            new NextRequest('http://localhost:3000/api/admin/claims/apply', {
                headers: adminBypassHeaders(),
            }),
        )
        const postResponse = await proxy(
            new NextRequest('http://localhost:3000/admin', {
                method: 'POST',
                headers: adminBypassHeaders(),
            }),
        )

        expect(allowedResponse.headers.get('x-auth-checked')).toBeNull()
        expect(allowedQueryResponse.headers.get('x-auth-checked')).toBeNull()
        expect(allowedWhitespaceHeaderResponse.headers.get('x-auth-checked')).toBeNull()
        expect(headResponse.headers.get('x-auth-checked')).toBeNull()
        expect(uppercaseHostResponse.headers.get('x-auth-checked')).toBeNull()
        expect(ipv6HostResponse.headers.get('x-auth-checked')).toBeNull()
        expect(bindAddressUrlResponse.headers.get('x-auth-checked')).toBeNull()
        expect(forwardedLocalHostResponse.headers.get('x-auth-checked')).toBeNull()
        expect(missingTokenResponse.headers.get('x-auth-checked')).toBe('1')
        expect(invalidTokenResponse.headers.get('x-auth-checked')).toBe('1')
        expect(nonLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(hostHeaderResponse.headers.get('x-auth-checked')).toBe('1')
        expect(forwardedHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(deceptiveLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(malformedLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(bindAddressHostHeaderResponse.headers.get('x-auth-checked')).toBe('1')
        expect(missingHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(nonAdminVariantResponse.headers.get('x-auth-checked')).toBe('1')
        expect(childRouteResponse.headers.get('x-auth-checked')).toBe('1')
        expect(claimsRouteResponse.headers.get('x-auth-checked')).toBeNull()
        expect(claimsChildRouteResponse.headers.get('x-auth-checked')).toBe('1')
        expect(claimsApiResponse.headers.get('x-auth-checked')).toBeNull()
        expect(claimsPreviewApiResponse.headers.get('x-auth-checked')).toBeNull()
        expect(claimsApplyApiResponse.headers.get('x-auth-checked')).toBeNull()
        expect(postResponse.status).toBe(403)
        expect(postResponse.headers.get('x-middleware-next')).toBeNull()
        expect(postResponse.headers.get('x-auth-checked')).toBeNull()
        expect(updateSessionCalls).toBe(12)
    } finally {
        resetAdminBypassEnv()
    }
})

test('개발자 썸네일 bootstrap 쿠키는 일반 브라우저의 썸네일 관리자 진입만 세션 갱신 없이 허용한다', async () => {
    enableAdminBypassEnv()

    try {
        let updateSessionCalls = 0

        mock.module('@/lib/supabase/middleware', () => ({
            updateSession: async () => {
                updateSessionCalls += 1
                return NextResponse.json({ ok: true }, { headers: { 'x-auth-checked': '1' } })
            },
        }))

        const cookieValue = await createDevAdminBypassCookieValue({
            nonce: 'proxy-thumbnail-dev-cookie',
        })
        const cookieHeader = `${DEV_ADMIN_BYPASS_COOKIE_NAME}=${cookieValue}`

        const { proxy } = await loadProxyModule()
        const allowedResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=youtube-thumbnail-generator', {
                headers: { host: 'localhost:3000', cookie: cookieHeader },
            }),
        )
        const allowedHeadResponse = await proxy(
            new NextRequest('http://127.0.0.1:3000/admin?module=youtube-thumbnail-generator', {
                method: 'HEAD',
                headers: { host: '127.0.0.1:3000', cookie: cookieHeader },
            }),
        )
        const wrongModuleResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=overview', {
                headers: { host: 'localhost:3000', cookie: cookieHeader },
            }),
        )
        const childRouteResponse = await proxy(
            new NextRequest('http://localhost:3000/admin/evaluations?module=youtube-thumbnail-generator', {
                headers: { host: 'localhost:3000', cookie: cookieHeader },
            }),
        )
        const postResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=youtube-thumbnail-generator', {
                method: 'POST',
                headers: { host: 'localhost:3000', cookie: cookieHeader },
            }),
        )
        const invalidCookieResponse = await proxy(
            new NextRequest('http://localhost:3000/admin?module=youtube-thumbnail-generator', {
                headers: { host: 'localhost:3000', cookie: `${DEV_ADMIN_BYPASS_COOKIE_NAME}=bad.cookie.value` },
            }),
        )
        const nonLocalHostResponse = await proxy(
            new NextRequest('https://example.com/admin?module=youtube-thumbnail-generator', {
                headers: { host: 'example.com', cookie: cookieHeader },
            }),
        )

        expect(allowedResponse.headers.get('x-auth-checked')).toBeNull()
        expect(allowedHeadResponse.headers.get('x-auth-checked')).toBeNull()
        expect(wrongModuleResponse.headers.get('x-auth-checked')).toBe('1')
        expect(childRouteResponse.headers.get('x-auth-checked')).toBe('1')
        expect(postResponse.status).toBe(403)
        expect(postResponse.headers.get('x-middleware-next')).toBeNull()
        expect(postResponse.headers.get('x-auth-checked')).toBeNull()
        expect(invalidCookieResponse.headers.get('x-auth-checked')).toBe('1')
        expect(nonLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(updateSessionCalls).toBe(4)
    } finally {
        resetAdminBypassEnv()
    }
})
