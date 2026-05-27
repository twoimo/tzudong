import { expect, mock, test } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'
import {
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS,
    E2E_ADMIN_ROUTE_BYPASS_HEADER,
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
    E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '@/lib/e2e-admin-route-bypass'

function loadProxyModule() {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return import(`@/proxy?${nonce}`) as Promise<typeof import('@/proxy')>
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ADMIN_BYPASS_TOKEN = 'test-admin-bypass-token'

function resetAdminBypassEnv() {
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime]
    delete process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token]

    if (ORIGINAL_NODE_ENV === undefined) {
        delete process.env.NODE_ENV
    } else {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV
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

    expect(homeResponse.status).toBe(200)
    expect(healthResponse.status).toBe(200)
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

test('Playwright 관리자 우회는 env와 토큰 헤더가 모두 맞는 /admin 진입에만 허용된다', async () => {
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
        expect(forwardedLocalHostResponse.headers.get('x-auth-checked')).toBeNull()
        expect(missingTokenResponse.headers.get('x-auth-checked')).toBe('1')
        expect(invalidTokenResponse.headers.get('x-auth-checked')).toBe('1')
        expect(nonLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(hostHeaderResponse.headers.get('x-auth-checked')).toBe('1')
        expect(forwardedHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(deceptiveLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(malformedLocalHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(missingHostResponse.headers.get('x-auth-checked')).toBe('1')
        expect(nonAdminVariantResponse.headers.get('x-auth-checked')).toBe('1')
        expect(childRouteResponse.headers.get('x-auth-checked')).toBe('1')
        expect(postResponse.headers.get('x-auth-checked')).toBe('1')
        expect(updateSessionCalls).toBe(11)
    } finally {
        resetAdminBypassEnv()
    }
})
