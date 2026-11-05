import { NextResponse, type NextRequest } from 'next/server';

import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createClientForCookieStore } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreJson = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.size > 0 || !isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'INVALID_LOGOUT_REQUEST' }, 403);
  }
  if ((await request.text()).length > 0) {
    return noStoreJson({ ok: false, error: 'INVALID_LOGOUT_REQUEST' }, 400);
  }

  // This response can arrive after another tab signed in. A Set-Cookie
  // deletion here would erase that newer session before the browser can check
  // ownership. Revoke the request's session; AuthProvider owns guarded local
  // cookie cleanup after this response. Passive SSR clients also keep their
  // refreshed credentials request-local; only code exchange opts into writes.
  const incomingCookies = request.cookies.getAll();
  const supabase = createClientForCookieStore({
    getAll: () => incomingCookies,
    set() {},
  });
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    return noStoreJson({ ok: false, error: 'LOGOUT_FAILED' }, 503);
  }
  return noStoreJson({ ok: true }, 200);
}
