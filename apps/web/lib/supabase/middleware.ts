import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/integrations/supabase/types'
import {
    AUTH_LOGIN_QUERY_PARAM,
    AUTH_LOGIN_QUERY_VALUE,
    AUTH_REDIRECT_NEXT_PARAM,
    AUTH_REDIRECT_REASON_PARAM,
    getSafeAuthNextPath,
    type AuthRedirectReason,
} from '@/lib/auth/auth-redirect'
import {
    getCurrentPrivacyEligibility,
    signOutRejectedPrivacySession,
} from '@/lib/privacy/eligibility'
import { hasSupabaseAuthCookieSessionHint } from '@/lib/supabase-auth-session-hints'



const isSupabaseAuthCookie = (name: string) =>
    name.startsWith('sb-') && (name.includes('auth-token') || name.includes('code-verifier'));

const clearSupabaseAuthCookies = (request: NextRequest, response: NextResponse) => {
    for (const cookie of request.cookies.getAll()) {
        if (!isSupabaseAuthCookie(cookie.name)) continue;

        response.cookies.set(cookie.name, '', {
            path: '/',
            maxAge: 0,
        });
    }
};
const isEligibilityExemptRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    return pathname === '/api/health'
        || pathname === '/api/privacy/onboarding'
        || pathname.startsWith('/api/privacy/onboarding/')
        || pathname === '/auth/callback';
};
const isApiRequest = (request: NextRequest) => request.nextUrl.pathname.startsWith('/api/');

const isProtectedAdminRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    return pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/api/admin' || pathname.startsWith('/api/admin/');
};

const isAdminNavigationRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();
    return (method === 'GET' || method === 'HEAD') && (pathname === '/admin' || pathname.startsWith('/admin/'));
};

const isMyPageRequest = (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    const method = request.method.toUpperCase();

    return (method === 'GET' || method === 'HEAD') && (pathname === '/mypage' || pathname.startsWith('/mypage/'));
};

const getCanonicalSameOriginNextPath = (request: NextRequest) => {
    const { pathname, search } = request.nextUrl;
    const requestedPath = `${pathname}${search}`;

    try {
        decodeURIComponent(requestedPath);
    } catch {
        return '/';
    }

    return getSafeAuthNextPath(requestedPath);
};

const redirectAuthRequiredWithSessionCookies = (
    request: NextRequest,
    sourceResponse: NextResponse,
    reason: AuthRedirectReason,
) => {
    const redirectUrl = new URL('/auth/required', request.url);
    redirectUrl.searchParams.set('reason', reason);
    redirectUrl.searchParams.set('next', getCanonicalSameOriginNextPath(request));
    const redirectResponse = NextResponse.redirect(redirectUrl);
    redirectResponse.headers.set('Cache-Control', 'no-store');

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};

const redirectAdminLoginWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) => {
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set(AUTH_LOGIN_QUERY_PARAM, AUTH_LOGIN_QUERY_VALUE);
    redirectUrl.searchParams.set(AUTH_REDIRECT_REASON_PARAM, 'admin');
    redirectUrl.searchParams.set(AUTH_REDIRECT_NEXT_PARAM, getCanonicalSameOriginNextPath(request));
    const redirectResponse = NextResponse.redirect(redirectUrl);
    redirectResponse.headers.set('Cache-Control', 'no-store');

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};

const redirectAdminHomeWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) => {
    const redirectResponse = NextResponse.redirect(new URL('/', request.url));
    redirectResponse.headers.set('Cache-Control', 'no-store');

    for (const cookie of sourceResponse.cookies.getAll()) {
        redirectResponse.cookies.set(cookie);
    }

    return redirectResponse;
};
const adminJsonResponseWithSessionCookies = (
    sourceResponse: NextResponse,
    error: 'Unauthorized' | 'Forbidden' | 'Service unavailable',
    status: 401 | 403 | 503,
) => {
    const response = NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
    for (const cookie of sourceResponse.cookies.getAll()) {
        response.cookies.set(cookie);
    }
    return response;
};

const adminUnauthorizedResponse = (request: NextRequest, sourceResponse: NextResponse) =>
    isAdminNavigationRequest(request)
        ? redirectAdminLoginWithSessionCookies(request, sourceResponse)
        : adminJsonResponseWithSessionCookies(sourceResponse, 'Unauthorized', 401);

const adminForbiddenResponse = (request: NextRequest, sourceResponse: NextResponse) =>
    isAdminNavigationRequest(request)
        ? redirectAdminHomeWithSessionCookies(request, sourceResponse)
        : adminJsonResponseWithSessionCookies(sourceResponse, 'Forbidden', 403);

const redirectMyPageAuthRequiredWithSessionCookies = (request: NextRequest, sourceResponse: NextResponse) =>
    redirectAuthRequiredWithSessionCookies(request, sourceResponse, 'mypage');
const eligibilityFailureResponse = (request: NextRequest, sourceResponse: NextResponse) => {
    clearSupabaseAuthCookies(request, sourceResponse);

    if (isApiRequest(request)) {
        const response = NextResponse.json(
            { error: 'Forbidden' },
            { status: 403, headers: { 'Cache-Control': 'no-store' } },
        );
        for (const cookie of sourceResponse.cookies.getAll()) {
            response.cookies.set(cookie);
        }
        return response;
    }

    const redirectUrl = new URL('/auth/required', request.url);
    redirectUrl.searchParams.set('reason', 'privacy');
    redirectUrl.searchParams.set('next', getCanonicalSameOriginNextPath(request));

    const response = NextResponse.redirect(redirectUrl);
    response.headers.set('Cache-Control', 'no-store');
    for (const cookie of sourceResponse.cookies.getAll()) {
        response.cookies.set(cookie);
    }
    return response;
};


export async function updateSession(
    request: NextRequest,
    forwardedRequestHeaders: Headers = request.headers,
) {
    const createNextResponse = () => NextResponse.next({
        request: { headers: forwardedRequestHeaders },
    });
    if (isEligibilityExemptRequest(request)) {
        return createNextResponse();
    }

    const hasAuthCookie = hasSupabaseAuthCookieSessionHint(request.headers.get('cookie') ?? undefined);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (!supabaseUrl || !supabaseAnonKey) {
        if (hasAuthCookie) {
            return eligibilityFailureResponse(request, createNextResponse());
        }
        if (isProtectedAdminRequest(request) || isMyPageRequest(request)) {
            return NextResponse.json(
                { error: 'Service unavailable' },
                { status: 503, headers: { 'Cache-Control': 'no-store' } },
            );
        }
        return createNextResponse();
    }

    let supabaseResponse = createNextResponse()

    const supabase = createServerClient<Database>(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = createNextResponse()
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
    } catch {
        authFailed = true;
    }

    if (hasAuthCookie && (authFailed || !authUserId)) {
        await signOutRejectedPrivacySession(supabase);
        return eligibilityFailureResponse(request, supabaseResponse);
    }

    if (authUserId) {
        const eligibility = await getCurrentPrivacyEligibility(supabase);
        if (!eligibility.eligible) {
            await signOutRejectedPrivacySession(supabase);
            return eligibilityFailureResponse(request, supabaseResponse);
        }
    }

    if (isProtectedAdminRequest(request)) {
        if (authFailed || !authUserId) {
            return adminUnauthorizedResponse(request, supabaseResponse);
        }

        let activeSession: boolean | null = null;
        let activeSessionError = false;
        try {
            const { data, error } = await supabase
                .rpc('is_current_auth_session_active' as never)
                .returns<boolean>();
            activeSession = typeof data === 'boolean' ? data : null;
            activeSessionError = Boolean(error) || typeof data !== 'boolean';
        } catch {
            activeSessionError = true;
        }

        if (activeSessionError || activeSession !== true) {
            await signOutRejectedPrivacySession(supabase);
            clearSupabaseAuthCookies(request, supabaseResponse);
            return adminUnauthorizedResponse(request, supabaseResponse);
        }

        const { data: role, error: roleError } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', authUserId)
            .eq('role', 'admin')
            .maybeSingle();

        if (roleError || !role) {
            return adminForbiddenResponse(request, supabaseResponse);
        }

        const { data: accountStatus, error: accountStatusError } = await supabase
            .from('user_account_status')
            .select('account_status')
            .eq('user_id', authUserId)
            .maybeSingle();

        if (accountStatusError || accountStatus?.account_status !== 'active') {
            return adminForbiddenResponse(request, supabaseResponse);
        }
    }

    if (isMyPageRequest(request) && (authFailed || !authUserId)) {
        return redirectMyPageAuthRequiredWithSessionCookies(request, supabaseResponse);
    }

    return supabaseResponse
}
