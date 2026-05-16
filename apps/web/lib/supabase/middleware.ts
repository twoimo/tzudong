import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const isRefreshTokenNotFoundError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'refresh_token_not_found') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('invalid refresh token') || message.includes('refresh token not found');
};

const isMissingOptionalAdminStatusStoreError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'PGRST205' || code === '42P01') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('user_account_status') && (
        message.includes('could not find the table') ||
        message.includes('does not exist') ||
        message.includes('schema cache')
    );
};

const clearSupabaseAuthCookies = (request: NextRequest, response: NextResponse) => {
    const allCookies = request.cookies.getAll();
    for (const cookie of allCookies) {
        const isSupabaseAuthCookie =
            cookie.name.startsWith('sb-') &&
            (cookie.name.includes('auth-token') || cookie.name.includes('code-verifier'));

        if (!isSupabaseAuthCookie) continue;

        response.cookies.set(cookie.name, '', {
            path: '/',
            maxAge: 0,
        });
    }
};

const isAdminPageRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();

    return (method === 'GET' || method === 'HEAD') && (pathname === '/admin' || pathname.startsWith('/admin/'));
};

const redirectAdminAuthRequiredWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) => {
    const redirectUrl = new URL('/auth/required', request.url);
    redirectUrl.searchParams.set('reason', 'admin');
    redirectUrl.searchParams.set('next', request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // 인증 토큰 갱신
    let authUserId: string | null = null;
    let authFailed = false;

    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        authUserId = user?.id ?? null;
        authFailed = Boolean(error);

        if (error && isRefreshTokenNotFoundError(error)) {
            clearSupabaseAuthCookies(request, supabaseResponse);
        }
    } catch (error) {
        authFailed = true;
        if (isRefreshTokenNotFoundError(error)) {
            clearSupabaseAuthCookies(request, supabaseResponse);
        } else {
            console.error('[supabase middleware] getUser error:', error);
        }
    }

    if (isAdminPageRequest(request)) {
        if (authFailed || !authUserId) {
            return redirectAdminAuthRequiredWithSessionCookies(request, supabaseResponse);
        }

        const { data: role, error: roleError } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', authUserId)
            .eq('role', 'admin')
            .maybeSingle();

        if (roleError || !role) {
            return redirectAdminAuthRequiredWithSessionCookies(request, supabaseResponse);
        }

        const { data: accountStatus, error: accountStatusError } = await supabase
            .from('user_account_status')
            .select('account_status')
            .eq('user_id', authUserId)
            .maybeSingle();

        if (accountStatus?.account_status === 'disabled') {
            return redirectAdminAuthRequiredWithSessionCookies(request, supabaseResponse);
        }

        if (accountStatusError && !isMissingOptionalAdminStatusStoreError(accountStatusError)) {
            return redirectAdminAuthRequiredWithSessionCookies(request, supabaseResponse);
        }
    }

    return supabaseResponse
}
