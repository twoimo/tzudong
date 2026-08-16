import { NextRequest, NextResponse } from 'next/server'

import {
  DEV_ADMIN_BYPASS_COOKIE_NAME,
  DEV_ADMIN_BYPASS_MAX_AGE_SECONDS,
  createDevAdminBypassCookieValue,
  isDevAdminBypassLocalHost,
  resolveDevAdminBootstrapNext,
} from '@/lib/auth/dev-admin-bypass-cookie'
import {
  getE2EAdminRouteBypassExpectedToken,
  isE2EAdminRouteBypassEnvEnabled,
} from '@/lib/e2e-admin-route-bypass'

function forbidden(status = 403) {
  return NextResponse.json({ error: 'Forbidden' }, { status })
}

function isTokenMatch(actual: string, expected: string) {
  if (!actual || !expected) return false
  if (actual.length !== expected.length) return false

  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index)
  }
  return mismatch === 0
}


export async function GET(request: NextRequest) {
  if (!isE2EAdminRouteBypassEnvEnabled()) return forbidden(404)
  if (!isDevAdminBypassLocalHost(request.nextUrl.hostname)) return forbidden()
  if (!isDevAdminBypassLocalHost(request.headers.get('host'))) return forbidden()

  const expectedToken = getE2EAdminRouteBypassExpectedToken()
  const requestToken = request.nextUrl.searchParams.get('token')?.trim() ?? ''
  if (!isTokenMatch(requestToken, expectedToken)) return forbidden(401)

  const nextPath = resolveDevAdminBootstrapNext(request.nextUrl.searchParams.get('next'))
  if (!nextPath) return NextResponse.json({ error: 'Unsafe redirect target' }, { status: 400 })

  const response = NextResponse.redirect(new URL(nextPath, request.nextUrl.origin), 303)
  response.cookies.set(DEV_ADMIN_BYPASS_COOKIE_NAME, await createDevAdminBypassCookieValue(), {
    httpOnly: true,
    maxAge: DEV_ADMIN_BYPASS_MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: false,
  })
  return response
}
