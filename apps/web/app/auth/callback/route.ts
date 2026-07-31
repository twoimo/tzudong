import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSafeAuthNextPath } from '@/lib/auth/auth-redirect';

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

function getTrustedRedirectOrigin(requestOrigin: string) {
    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configuredSiteUrl) {
        try {
            return new URL(configuredSiteUrl).origin;
        } catch {
            return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
        }
    }

    if (process.env.NODE_ENV !== 'production') {
        try {
            return new URL(requestOrigin).origin;
        } catch {
            return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
        }
    }

    return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
}


function isPrivacyProfileStatusAllowed(status: unknown) {
    return status === "eligible" || status === "guardian_verified";
}

const isPrivacyProfileCompleteForUser = async (supabase: Awaited<ReturnType<typeof createClient>>, userId: string) => {
    const { data, error } = await (supabase
        .from('privacy_age_profiles' as never)
        .select('status')
        .eq('owner', userId)
        .maybeSingle() as unknown as Promise<{ data: { status: string | null } | null; error: unknown }>);

    if (error) return false;

    const status = data?.status ?? null;
    return isPrivacyProfileStatusAllowed(status);
};

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = getSafeAuthNextPath(searchParams.get('next'));

    if (code) {
        const supabase = await createClient();
        try {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (!error) {
                const { data: { user }, error: userError } = await supabase.auth.getUser();

                if (!userError && user && await isPrivacyProfileCompleteForUser(supabase, user.id)) {
                    return NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}${next}`);
                }
            }

            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        }
    }

    // 에러 발생 시 홈으로 리다이렉트
    return NextResponse.redirect(`${getTrustedRedirectOrigin(origin)}/`);
}
