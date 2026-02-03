// 이 파일은 자동으로 생성되었습니다. 직접 수정하지 마세요.
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)