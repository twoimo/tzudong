import { describe, expect, test } from 'bun:test'

import {
    DEV_ADMIN_BYPASS_COOKIE_NAME,
    createDevAdminBypassCookieValue,
    getDevAdminBypassCookieFromHeader,
    resolveDevAdminBootstrapNext,
    validateDevAdminBypassCookie,
} from '@/lib/auth/dev-admin-bypass-cookie'
import {
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS,
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
} from '@/lib/e2e-admin-route-bypass'
import { LOOPBACK_HOST_CASES } from './fixtures/loopback-host-cases'

const now = Date.UTC(2026, 5, 9, 9, 0, 0)
const enabledEnv = {
    NODE_ENV: 'development',
    [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled]: '1',
    [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context]: E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime]: E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
    [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token]: 'dev-thumbnail-token',
}

describe('dev admin bypass cookie', () => {
    test('accepts only signed localhost thumbnail-dev cookies with enabled e2e env', async () => {
        const cookieValue = await createDevAdminBypassCookieValue({
            env: enabledEnv,
            now,
            nonce: 'unit-test-nonce',
        })

        expect(cookieValue.split('.')).toHaveLength(2)
        expect(getDevAdminBypassCookieFromHeader(`a=1; ${DEV_ADMIN_BYPASS_COOKIE_NAME}=${cookieValue}; z=2`)).toBe(cookieValue)

        await expect(validateDevAdminBypassCookie({ cookieValue, host: 'localhost:8080', env: enabledEnv, now })).resolves.toMatchObject({ ok: true })
        await expect(validateDevAdminBypassCookie({ cookieValue, host: '127.0.0.1:8080', env: enabledEnv, now })).resolves.toMatchObject({ ok: true })
        await expect(validateDevAdminBypassCookie({ cookieValue, host: '[::1]:8080', env: enabledEnv, now })).resolves.toMatchObject({ ok: true })
    })

    test('rejects missing env, production, non-local host, tampering, and expiry', async () => {
        const cookieValue = await createDevAdminBypassCookieValue({
            env: enabledEnv,
            now,
            nonce: 'unit-test-nonce',
        })

        await expect(validateDevAdminBypassCookie({ cookieValue, host: 'localhost:8080', env: {}, now })).resolves.toEqual({ ok: false, reason: 'env_disabled' })
        await expect(validateDevAdminBypassCookie({ cookieValue, host: 'localhost:8080', env: { ...enabledEnv, NODE_ENV: 'production' }, now })).resolves.toEqual({ ok: false, reason: 'env_disabled' })
        await expect(validateDevAdminBypassCookie({ cookieValue, host: 'example.com', env: enabledEnv, now })).resolves.toEqual({ ok: false, reason: 'non_local_host' })
        await expect(validateDevAdminBypassCookie({ cookieValue: `${cookieValue}x`, host: 'localhost:8080', env: enabledEnv, now })).resolves.toEqual({ ok: false, reason: 'bad_signature' })
        await expect(validateDevAdminBypassCookie({ cookieValue, host: 'localhost:8080', env: enabledEnv, now: now + 3_700_000 })).resolves.toEqual({ ok: false, reason: 'expired' })
        await expect(validateDevAdminBypassCookie({ cookieValue: 'not.a.cookie', host: 'localhost:8080', env: enabledEnv, now })).resolves.toEqual({ ok: false, reason: 'malformed_cookie' })
    })

    test('accepts a valid cookie only from loopback Host header values', async () => {
        const cookieValue = await createDevAdminBypassCookieValue({
            env: enabledEnv,
            now,
            nonce: 'unit-test-nonce',
        })

        for (const { host, isLoopback } of LOOPBACK_HOST_CASES) {
            const result = await validateDevAdminBypassCookie({ cookieValue, host, env: enabledEnv, now })
            expect(result.ok, JSON.stringify(host)).toBe(isLoopback)
        }
    })

    test('limits bootstrap next targets', () => {
        expect(resolveDevAdminBootstrapNext(null)).toBe('/admin?module=youtube-thumbnail-generator')
        expect(resolveDevAdminBootstrapNext('/admin?module=youtube-thumbnail-generator')).toBe('/admin?module=youtube-thumbnail-generator')
        expect(resolveDevAdminBootstrapNext('/admin?module=overview')).toBe('/admin?module=overview')
        expect(resolveDevAdminBootstrapNext('/admin/other')).toBeNull()
        expect(resolveDevAdminBootstrapNext('//evil.test/admin')).toBeNull()
        expect(resolveDevAdminBootstrapNext('https://evil.test/admin')).toBeNull()
    })
})
