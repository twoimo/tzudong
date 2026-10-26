import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/integrations/supabase/types';
import { getAuthCookieContract, readServerAuthCookies } from '../auth/session-cookies';

type CookieStore = {
    getAll(): { name: string; value: string }[];
    set(name: string, value: string, options: CookieOptions): void;
};
const consumedVerifiers = new WeakMap<object, Set<string>>();
export function getConsumedPkceCookieNames(client: object) { return [...(consumedVerifiers.get(client) ?? [])]; }

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
    options: { allowPkceCookieWrites?: boolean } = {},
) {
    const { url, anonKey } = getSupabaseServerConfig(env);
    const requestCookies = new Map(readServerAuthCookies(cookieStore.getAll(), url)
        .map(cookie => [cookie.name, cookie.value]));
    const removedVerifiers = new Set<string>();
    const verifier = `${getAuthCookieContract(url).key}-code-verifier`;
    const isVerifier = (name: string) => name === verifier || name.startsWith(`${verifier}-`) || name.startsWith(`${verifier}.`);

    const client = createServerClient<Database>(url, anonKey, {
        cookieOptions: { name: getAuthCookieContract(url).key },
        cookies: {
            getAll() {
                return [...requestCookies].map(([name, value]) => ({ name, value }));
            },
            setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
                for (const { name, value, options: cookieOptions } of cookiesToSet) {
                    if (cookieOptions.maxAge === 0 || !value) requestCookies.delete(name);
                    else requestCookies.set(name, value);
                    if (cookieOptions.maxAge === 0 && isVerifier(name)) removedVerifiers.add(name);
                }
                // The response may arrive after a newer browser commit. Keep
                // credentials request-local even for OAuth code exchange;
                // only the browser cookie adapter publishes a session.
                if (options.allowPkceCookieWrites) {
                    for (const cookie of cookiesToSet) {
                        if (isVerifier(cookie.name)) {
                            cookieStore.set(cookie.name, cookie.value, cookie.options);
                        }
                    }
                }
            },
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
    consumedVerifiers.set(client, removedVerifiers);
    return client;
}

export async function createClient() {
    return createClientForCookieStore(await cookies(), process.env);
}
