import { expect, mock, test } from 'bun:test'
import { NextRequest, NextResponse } from 'next/server'

function loadProxyModule() {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return import(`@/proxy?${nonce}`) as Promise<typeof import('@/proxy')>
}

test('공개 경로는 세션 갱신을 건너뛴다', async () => {
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
