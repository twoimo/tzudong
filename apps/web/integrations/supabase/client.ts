// 이 파일은 자동으로 생성되었습니다. 직접 수정하지 마세요.
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

let browserClient: SupabaseClient<Database> | null = null

function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase browser client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (!browserClient) {
    browserClient = createSupabaseBrowserClient()
  }

  return browserClient
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    const client = getSupabaseBrowserClient()
    const value = client[prop as keyof SupabaseClient<Database>]

    return typeof value === 'function' ? value.bind(client) : value
  },
})
