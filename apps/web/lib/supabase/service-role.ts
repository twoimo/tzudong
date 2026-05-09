import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let supabaseAdminClientCache: CacheEntry<SupabaseClient> = null;

export function createSupabaseServiceRoleClient(): SupabaseClient {
  if (supabaseAdminClientCache && supabaseAdminClientCache.expiresAt > Date.now()) {
    return supabaseAdminClientCache.value;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  }

  const client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  supabaseAdminClientCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: client,
  };

  return client;
}
