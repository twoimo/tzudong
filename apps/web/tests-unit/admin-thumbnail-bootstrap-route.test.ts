import { afterEach, describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/dev/admin-thumbnail-bootstrap/route'
import { DEV_ADMIN_BYPASS_COOKIE_NAME } from '@/lib/auth/dev-admin-bypass-cookie'
import {
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS,
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
} from '@/lib/e2e-admin-route-bypass'

const originalEnv = { ...process.env }
const token = 'route-bootstrap-token'

function resetEnv() {
    process.env = { ...originalEnv }
}

function enableEnv() {
    process.env.NODE_ENV = 'development'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled] = '1'
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context] = E2E_ADMIN_ROUTE_BYPASS_CONTEXT
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime] = E2E_ADMIN_ROUTE_BYPASS_RUNTIME
    process.env[E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token] = token
}

function request(path: string, host = 'localhost:8080') {
    return new NextRequest(`http://localhost:8080${path}`, { headers: { host } })
}

describe('dev admin thumbnail bootstrap route', () => {
    afterEach(resetEnv)

    test('sets a signed HttpOnly cookie and redirects the normal browser to the thumbnail page', async () => {
        enableEnv()

        const response = await GET(request(`/api/dev/admin-thumbnail-bootstrap?token=${token}&next=%2Fadmin%3Fmodule%3Dyoutube-thumbnail-generator`))

        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toContain('/admin?module=youtube-thumbnail-generator')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.get('set-cookie')).toContain(`${DEV_ADMIN_BYPASS_COOKIE_NAME}=`)
        expect(response.headers.get('set-cookie')).toContain('HttpOnly')
        expect(response.headers.get('set-cookie')?.toLowerCase()).toContain('samesite=lax')
    })

    test('fails closed when env, token, host, or redirect target is unsafe', async () => {
        let response = await GET(request(`/api/dev/admin-thumbnail-bootstrap?token=${token}`))
        expect(response.status).toBe(404)

        enableEnv()
        response = await GET(request('/api/dev/admin-thumbnail-bootstrap?token=wrong-token'))
        expect(response.status).toBe(401)
        expect(response.headers.get('set-cookie')).toBeNull()

        response = await GET(request(`/api/dev/admin-thumbnail-bootstrap?token=${token}`, 'example.com'))
        expect(response.status).toBe(403)

        response = await GET(request(`/api/dev/admin-thumbnail-bootstrap?token=${token}&next=https%3A%2F%2Fevil.test%2Fadmin`))
        expect(response.status).toBe(400)
    })
})
