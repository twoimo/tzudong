import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/integrations/supabase/types';

type CookieStore = {
    getAll(): { name: string; value: string }[];
    set(name: string, value: string, options: CookieOptions): void;
};

export function getSupabaseServerConfig(env: NodeJS.ProcessEnv = process.env) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (!url || !anonKey) {
        throw new Error('Supabase server configuration is required.');
    }

    return { url, anonKey };
}

export function createClientForCookieStore(
    cookieStore: CookieStore,
    env: NodeJS.ProcessEnv = process.env,
) {
    const { url, anonKey } = getSupabaseServerConfig(env);

    return createServerClient<Database>(url, anonKey, {
        cookies: {
            getAll() {
                return cookieStore.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
                try {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options)
                    );
                } catch {
                    // Server Component에서 호출 시 무시
                }
            },
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

export async function createClient() {
    return createClientForCookieStore(await cookies());
}
