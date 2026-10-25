// 이 파일은 자동으로 생성되었습니다. 직접 수정하지 마세요.
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { getAuthCookieContract, migrateBrowserAuthCookies, withBrowserAuthCookieLock } from '../../lib/auth/session-cookies'
import { createBrowserRefreshGuard } from '../../lib/auth/browser-refresh-guard'
import { advanceBrowserAuthRevision } from '../../lib/auth/browser-commit-state'
import { isChunkLike } from '@supabase/ssr'

let browserClient: SupabaseClient<Database> | null = null
let browserCommitGuard: ReturnType<typeof createBrowserRefreshGuard> | null = null

function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase browser client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  const refreshGuard = createBrowserRefreshGuard(supabaseUrl)
  browserCommitGuard = refreshGuard
  const completingOAuth = typeof window !== 'undefined' && window.location.pathname === '/auth/complete'
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    isSingleton: true,
    global: { fetch: refreshGuard.fetch },
    cookieOptions: { name: getAuthCookieContract(supabaseUrl).key },
    cookies: {
      async getAll() {
        if (typeof document === 'undefined') return []
        return withBrowserAuthCookieLock(supabaseUrl, () => {
          migrateBrowserAuthCookies(supabaseUrl)
          return parseCookieHeader(document.cookie)
        })
      },
      async setAll(cookies) {
        if (typeof document === 'undefined') return
        await withBrowserAuthCookieLock(supabaseUrl, () => {
          migrateBrowserAuthCookies(supabaseUrl)
          const committed = refreshGuard.prepareCommit(cookies)
          if (cookies.some(cookie => isChunkLike(cookie.name, getAuthCookieContract(supabaseUrl).key))) {
            advanceBrowserAuthRevision(getAuthCookieContract(supabaseUrl))
          }
          for (const { name, value, options } of cookies) {
            document.cookie = serializeCookieHeader(name, value, options)
          }
          const stored = parseCookieHeader(document.cookie)
          for (const { name, value, options } of cookies) {
            const actual = stored.find(cookie => cookie.name === name)
            if (options.maxAge === 0 ? actual !== undefined : actual?.value !== value) {
              // A blocked or partial batch must not be published as a saved
              // session. Do not roll back over a concurrent HTTP cookie commit.
              throw new Error('AUTH_COOKIE_WRITE_FAILED')
            }
          }
          committed()
        })
      },
    },
    auth: {
      persistSession: true,
      autoRefreshToken: !completingOAuth,
      detectSessionInUrl: !completingOAuth,
    },
    realtime: {
      params: {
        eventsPerSecond: 2,
      },
    },
  })
}

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createSupabaseBrowserClient()
  }

  return browserClient
}

// OAuth code exchange validates on the server, but publication shares this
// browser adapter with SDK login/refresh/logout. HTTP responses never commit it.
export async function commitSupabaseBrowserSession(
  tokens: { access_token: string; refresh_token: string },
  expected: string,
  ownsRequest: () => boolean,
  cleanup?: () => void,
) {
  const client = getSupabaseBrowserClient()
  if (!browserCommitGuard || !ownsRequest()) throw new Error('AUTH_CALLBACK_SUPERSEDED')
  browserCommitGuard.registerCommit(tokens.refresh_token, expected, ownsRequest, cleanup)
  return client.auth.setSession(tokens)
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseBrowserClient()
    const value = client[prop as keyof SupabaseClient<Database>]

    return typeof value === 'function' ? value.bind(client) : value
  },
})
