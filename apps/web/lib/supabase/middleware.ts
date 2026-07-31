import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
    AUTH_LOGIN_QUERY_PARAM,
    AUTH_LOGIN_QUERY_VALUE,
    AUTH_REDIRECT_NEXT_PARAM,
    AUTH_REDIRECT_REASON_PARAM,
    type AuthRedirectReason,
} from '@/lib/auth/auth-redirect'

const isRefreshTokenNotFoundError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'refresh_token_not_found') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('invalid refresh token') || message.includes('refresh token not found');
};

const PRIVACY_PROFILE_ALLOWED_STATUSES = ['eligible', 'guardian_verified'] as const;
const isPrivacyProfileStatusAllowed = (status: unknown) =>
    typeof status === 'string' && PRIVACY_PROFILE_ALLOWED_STATUSES.includes(status as (typeof PRIVACY_PROFILE_ALLOWED_STATUSES)[number]);

const isApiRequest = (request: NextRequest) =>
    request.nextUrl.pathname.startsWith('/api/');

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

const isMyPageRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();

    return (method === 'GET' || method === 'HEAD') && (pathname === '/mypage' || pathname.startsWith('/mypage/'));
};

const getRequestedPathWithSearch = (request: NextRequest) => {
    const { pathname, search } = request.nextUrl;
    return `${pathname}${search}`;
};

const redirectAuthRequiredWithSessionCookies = (
    request: NextRequest,
    sourceResponse: NextResponse,
    reason: AuthRedirectReason,
) => {
    const redirectUrl = new URL('/auth/required', request.url);
    redirectUrl.searchParams.set('reason', reason);
    redirectUrl.searchParams.set('next', getRequestedPathWithSearch(request));
    const redirectResponse = NextResponse.redirect(redirectUrl);

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};
const buildNoStoreForbiddenResponse = (sourceResponse: NextResponse) => {
    const response = NextResponse.json({ error: 'forbidden' }, {
        status: 403,
        headers: {
            'Cache-Control': 'no-store',
        },
    });

    for (const cookie of sourceResponse.cookies.getAll()) {
        response.cookies.set(cookie);
    }

    return response;
};

const redirectAdminLoginWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) => {
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set(AUTH_LOGIN_QUERY_PARAM, AUTH_LOGIN_QUERY_VALUE);
    redirectUrl.searchParams.set(AUTH_REDIRECT_REASON_PARAM, 'admin');
    redirectUrl.searchParams.set(AUTH_REDIRECT_NEXT_PARAM, getRequestedPathWithSearch(request));
    const redirectResponse = NextResponse.redirect(redirectUrl);

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};

const redirectAdminHomeWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) => {
    const redirectResponse = NextResponse.redirect(new URL('/', request.url));

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};

const redirectMyPageAuthRequiredWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) =>
    redirectAuthRequiredWithSessionCookies(request, sourceResponse, 'mypage');

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
        }
    }

    if (!authFailed && authUserId) {
        try {
            const { data, error } = await (supabase
                .from('privacy_age_profiles' as never)
                .select('status')
                .eq('owner', authUserId)
                .maybeSingle() as unknown as Promise<{ data: { status: string | null } | null; error: unknown }>);

            const isPrivacyProfileComplete = data !== null && isPrivacyProfileStatusAllowed(data.status);

            if (error || !isPrivacyProfileComplete) {
                clearSupabaseAuthCookies(request, supabaseResponse);

                if (isApiRequest(request)) {
                    return buildNoStoreForbiddenResponse(supabaseResponse);
                }

                return redirectAuthRequiredWithSessionCookies(request, supabaseResponse, 'review');
            }
        } catch {
            clearSupabaseAuthCookies(request, supabaseResponse);

            if (isApiRequest(request)) {
                return buildNoStoreForbiddenResponse(supabaseResponse);
            }

            return redirectAuthRequiredWithSessionCookies(request, supabaseResponse, 'review');
        }
    }


    if (isAdminPageRequest(request)) {
        if (authFailed || !authUserId) {
            return redirectAdminLoginWithSessionCookies(request, supabaseResponse);
        }

        const { data: role, error: roleError } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', authUserId)
            .eq('role', 'admin')
            .maybeSingle();

        if (roleError || !role) {
            return redirectAdminHomeWithSessionCookies(request, supabaseResponse);
        }

        const { data: accountStatus, error: accountStatusError } = await supabase
            .from('user_account_status')
            .select('account_status')
            .eq('user_id', authUserId)
            .maybeSingle();

        if (accountStatus?.account_status === 'disabled') {
            return redirectAdminHomeWithSessionCookies(request, supabaseResponse);
        }

        if (accountStatusError && !isMissingOptionalAdminStatusStoreError(accountStatusError)) {
            return redirectAdminHomeWithSessionCookies(request, supabaseResponse);
        }
    }

    if (isMyPageRequest(request) && (authFailed || !authUserId)) {
        return redirectMyPageAuthRequiredWithSessionCookies(request, supabaseResponse);
    }

    return supabaseResponse
}
