import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const isRefreshTokenNotFoundError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'refresh_token_not_found') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('invalid refresh token') || message.includes('refresh token not found');
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
    try {
        const { error } = await supabase.auth.getUser();

        if (error && isRefreshTokenNotFoundError(error)) {
            clearSupabaseAuthCookies(request, supabaseResponse);
        }
    } catch (error) {
        if (isRefreshTokenNotFoundError(error)) {
            clearSupabaseAuthCookies(request, supabaseResponse);
        } else {
            console.error('[supabase middleware] getUser error:', error);
        }
    }

    return supabaseResponse
}
